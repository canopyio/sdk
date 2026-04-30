import type { Transport } from "./transport.js";
import {
  CanopyApprovalDeniedError,
  CanopyApprovalExpiredError,
  CanopyApprovalRequiredError,
  CanopyConfigError,
  CanopyError,
} from "./errors.js";
import { getApprovalStatus, waitForApproval } from "./approval.js";
import { verifyXPaymentMatchesOffer } from "./x402-decode.js";
import { parseMppChallenge, type MppChallenge } from "./mpp-decode.js";
import { getTreasuryBalances } from "./balances.js";
import type { CanopyFetchOptions } from "./types.js";

/**
 * USDC and USDC.e on every chain we currently support are 6-decimal. If a
 * future asset uses different precision the candidate-amount logic will
 * need a per-chain decimals lookup — until then this constant captures the
 * shared convention.
 */
const STABLECOIN_DECIMALS = 6;

/**
 * x402 payment requirements returned in a 402 response body.
 * See https://x402.org for the spec.
 */
interface X402Requirements {
  x402Version?: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired?: string;
    /** mppx-style x402 envelopes use `amount` instead of `maxAmountRequired`. */
    amount?: string;
    resource?: string;
    description?: string;
    mimeType?: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    asset: string;
    extra?: Record<string, unknown>;
  }>;
}

interface SignResponseBody {
  /** Set when the server allowed an x402 payment. */
  x_payment_header?: string;
  /** Set when the server allowed an MPP payment. Carries the credential
   * (base64url-JSON of the signed-Tempo-tx envelope) for the
   * `Authorization: Payment` retry header. */
  mpp_payment_header?: string;
  transaction_id: string;
  error?: string;
  // pending_approval enrichment
  status?: string;
  reason?: string;
  approval_request_id?: string;
  recipient_name?: string | null;
  recipient_address?: string | null;
  amount_usd?: number | null;
  agent_name?: string | null;
  expires_at?: string | null;
  chat_approval_enabled?: boolean;
}

type X402Offer = X402Requirements["accepts"][number];

/**
 * Normalize a 402 offer's `network` field to an EVM chain ID.
 * Accepts both legacy ("base") and CAIP-2 ("eip155:8453") forms.
 */
function chainIdForX402Network(network: string): number | null {
  if (network === "base") return 8453;
  const m = network.match(/^eip155:(\d+)$/);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

/**
 * Convert a stringified atomic-units amount to a USD float using the shared
 * stablecoin decimals constant. Returns null for malformed amounts.
 */
function atomicToUsd(amount: string): number | null {
  if (!/^\d+$/.test(amount)) return null;
  const v = BigInt(amount);
  const denom = BigInt(10) ** BigInt(STABLECOIN_DECIMALS);
  return Number(v / denom) + Number(v % denom) / Number(denom);
}

/**
 * One unified candidate for routing — a single payment offer derived from
 * either envelope kind. Candidates are emitted in the server's preference
 * order (MPP first when present, then x402 `accepts[]`).
 */
interface Candidate {
  source: "mpp" | "x402";
  chainId: number;
  amountUsd: number;
  mppChallenge?: MppChallenge;
  x402Offer?: X402Offer;
  x402Reqs?: X402Requirements;
}

/**
 * Enumerate every candidate offer from a 402, in preference order. MPP
 * comes first because servers that emit both envelopes are signaling MPP
 * as the preferred rail.
 */
async function enumerateCandidates(
  first: Response,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  const mpp = parseMppChallenge(first.headers);
  if (mpp && mpp.method === "tempo" && mpp.intent === "charge") {
    const amountUsd = atomicToUsd(mpp.request.amount);
    if (amountUsd != null) {
      candidates.push({
        source: "mpp",
        chainId: mpp.request.methodDetails.chainId,
        amountUsd,
        mppChallenge: mpp,
      });
    }
  }

  let reqs: X402Requirements | null = null;
  try {
    reqs = (await first.clone().json()) as X402Requirements;
  } catch {
    reqs = null;
  }
  if (reqs?.accepts) {
    for (const offer of reqs.accepts) {
      if (offer.scheme !== "exact") continue;
      const chainId = chainIdForX402Network(offer.network);
      if (chainId == null) continue;
      const atomic = offer.amount ?? offer.maxAmountRequired;
      if (!atomic) continue;
      const amountUsd = atomicToUsd(atomic);
      if (amountUsd == null) continue;
      candidates.push({
        source: "x402",
        chainId,
        amountUsd,
        x402Offer: offer,
        x402Reqs: reqs,
      });
    }
  }

  return candidates;
}

/**
 * Pick the first candidate whose chain has enough USDC to cover the offer.
 * Skips the balance round-trip when there's only one candidate — there's
 * nothing to choose between, and the existing fixtures (single-candidate
 * happy paths) shouldn't have to stub a balance call.
 */
async function chooseCandidate(
  transport: Transport,
  candidates: Candidate[],
): Promise<Candidate | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const balances = await getTreasuryBalances(transport);
  if (!balances) {
    // Couldn't read balances — fall back to first candidate. The /api/sign
    // call will surface a clear "policy denied" or signing error if the
    // treasury can't actually cover it.
    return candidates[0]!;
  }
  const balanceMap = new Map(
    balances.map((b) => [b.chainId, parseFloat(b.usdcBalance) || 0]),
  );
  for (const c of candidates) {
    const have = balanceMap.get(c.chainId) ?? 0;
    if (have >= c.amountUsd) return c;
  }
  // No chain has enough — try the first one anyway and let /api/sign reject.
  // This is honest: the treasury balance might be ahead of what we cached.
  return candidates[0]!;
}

/**
 * fetch() wrapper that auto-handles HTTP 402 via canopy-app's `/api/sign`.
 *
 * Recognizes two 402 envelopes:
 *
 *   1. **MPP** — `WWW-Authenticate: Payment id="…", method="…", request="…"`
 *      header, signed via Tempo native tx. Tried first because the header
 *      check is cheaper than parsing the body.
 *   2. **x402** — body `{ accepts: [{ scheme: "exact", network: "base"|
 *      "eip155:8453", … }] }`, settled via EIP-3009 `transferWithAuthorization`.
 *
 * If neither envelope matches, the original 402 is returned unchanged so the
 * caller can decide what to do.
 *
 * Three policy outcomes the server can return:
 *   - 200 allowed → SDK retries with the appropriate payment header
 *   - 202 pending_approval → SDK either throws CanopyApprovalRequiredError
 *     (default) or, with `{ waitForApproval: true | <ms> }`, polls the
 *     status endpoint, recovers the header on approve, and retries
 *   - 403 denied → throws via the transport
 */
export async function canopyFetch(
  transport: Transport,
  agentId: string | undefined,
  url: string,
  init?: RequestInit,
  opts: CanopyFetchOptions = {},
): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 402) return first;
  if (!agentId) {
    throw new CanopyConfigError("canopy.fetch() requires an agentId in the Canopy constructor");
  }

  const candidates = await enumerateCandidates(first);
  const chosen = await chooseCandidate(transport, candidates);
  if (!chosen) return first;

  if (chosen.source === "mpp") {
    return handleMppPayment(transport, agentId, url, init, opts, chosen.mppChallenge!);
  }
  return handleX402Payment(
    transport,
    agentId,
    url,
    init,
    opts,
    chosen.x402Offer!,
    chosen.x402Reqs!,
  );
}

async function handleX402Payment(
  transport: Transport,
  agentId: string,
  url: string,
  init: RequestInit | undefined,
  opts: CanopyFetchOptions,
  offer: X402Offer,
  reqs: X402Requirements,
): Promise<Response> {
  const chainId = chainIdForX402Network(offer.network) ?? 8453;
  const { status: signStatus, body: signBody } = await transport.request<SignResponseBody>({
    method: "POST",
    path: "/api/sign",
    body: {
      agent_id: agentId,
      type: "x402",
      chain_id: chainId,
      recipient_address: offer.payTo,
      payload: { x402: offer, x402Version: reqs.x402Version ?? 1 },
    },
    expectStatuses: [200, 202],
  });

  const xPaymentHeader = await resolvePaymentHeader(
    transport,
    signStatus,
    signBody,
    "x_payment_header",
    opts,
  );
  if (!xPaymentHeader) {
    throw new CanopyError("x402 signing returned no X-PAYMENT header");
  }

  const verified = verifyXPaymentMatchesOffer(xPaymentHeader, offer);
  if (!verified.ok) {
    throw new CanopyError(verified.reason);
  }

  const retryHeaders = new Headers(init?.headers ?? {});
  retryHeaders.set("X-PAYMENT", xPaymentHeader);
  return fetch(url, { ...init, headers: retryHeaders });
}

async function handleMppPayment(
  transport: Transport,
  agentId: string,
  url: string,
  init: RequestInit | undefined,
  opts: CanopyFetchOptions,
  challenge: MppChallenge,
): Promise<Response> {
  // Candidate enumeration upstream filters to method=tempo / intent=charge,
  // so this assertion is defensive — anything else is a programmer bug.
  if (challenge.method !== "tempo" || challenge.intent !== "charge") {
    throw new CanopyError(
      `Unsupported MPP challenge: method=${challenge.method} intent=${challenge.intent}`,
    );
  }

  const { status: signStatus, body: signBody } = await transport.request<SignResponseBody>({
    method: "POST",
    path: "/api/sign",
    body: {
      agent_id: agentId,
      type: "mpp",
      // chain_id and recipient_address are server-derived from the challenge;
      // sending them is optional but keeps the wire shape parallel to x402.
      chain_id: challenge.request.methodDetails.chainId,
      recipient_address: challenge.request.recipient,
      payload: { mpp_challenge: challenge },
    },
    expectStatuses: [200, 202],
  });

  const paymentHeader = await resolvePaymentHeader(
    transport,
    signStatus,
    signBody,
    "mpp_payment_header",
    opts,
  );
  if (!paymentHeader) {
    throw new CanopyError("MPP signing returned no Payment header");
  }

  const retryHeaders = new Headers(init?.headers ?? {});
  retryHeaders.set("Authorization", `Payment ${paymentHeader}`);
  return fetch(url, { ...init, headers: retryHeaders });
}

/**
 * Shared 200-allowed / 202-pending_approval / approval-poll logic for both
 * x402 and MPP. Returns the payment header value (or null on 200 with no
 * header field — caller decides whether that's an error).
 *
 * `headerField` is the response key to read the header from (the two paths
 * differ only by that key).
 */
async function resolvePaymentHeader(
  transport: Transport,
  signStatus: number,
  signBody: SignResponseBody,
  headerField: "x_payment_header" | "mpp_payment_header",
  opts: CanopyFetchOptions,
): Promise<string | null> {
  if (signStatus === 200) {
    return signBody[headerField] ?? null;
  }

  // 202 pending_approval
  const approvalId = signBody.approval_request_id;
  const transactionId = signBody.transaction_id;
  if (!approvalId) {
    throw new CanopyError("Sign returned 202 without approval_request_id");
  }

  if (!opts.waitForApproval) {
    throw new CanopyApprovalRequiredError({
      message: signBody.reason ?? "Approval required",
      approvalId,
      transactionId,
      recipientName: signBody.recipient_name ?? null,
      amountUsd: signBody.amount_usd ?? null,
      agentName: signBody.agent_name ?? null,
      expiresAt: signBody.expires_at ?? null,
      chatApprovalEnabled: signBody.chat_approval_enabled ?? true,
    });
  }

  const timeoutMs =
    typeof opts.waitForApproval === "number" ? opts.waitForApproval : 5 * 60 * 1000;
  const decided = await waitForApproval(transport, approvalId, { timeoutMs });

  if (decided.status === "denied") {
    throw new CanopyApprovalDeniedError(approvalId, transactionId);
  }
  if (decided.status === "expired") {
    throw new CanopyApprovalExpiredError(approvalId, transactionId);
  }
  // approved — pick the header that matches the rail this caller is on.
  // The approval-execution path writes one or the other (not both), so the
  // non-matching field is always null and ignoring it is correct.
  const pick = (s: typeof decided) =>
    headerField === "mpp_payment_header" ? s.mppPaymentHeader : s.xPaymentHeader;
  const fromDecide = pick(decided);
  if (fromDecide) return fromDecide;
  // Status race: poll once more for a populated header.
  const refreshed = await getApprovalStatus(transport, approvalId);
  return pick(refreshed);
}
