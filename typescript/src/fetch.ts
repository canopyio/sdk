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
import type { CanopyFetchOptions } from "./types.js";

/**
 * x402 payment requirements returned in a 402 response body.
 * See https://x402.org for the spec.
 */
interface X402Requirements {
  x402Version?: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description?: string;
    mimeType?: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    asset: string;
    extra?: Record<string, unknown>;
  }>;
}

interface SignResponseBody {
  x_payment_header?: string;
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

/**
 * fetch() wrapper that auto-handles HTTP 402 via canopy-app's `/api/sign`.
 *
 * Three policy outcomes the server can return:
 *   - 200 allowed → SDK retries with X-PAYMENT (existing happy path)
 *   - 202 pending_approval → SDK either throws CanopyApprovalRequiredError
 *     (default) or, with `{ waitForApproval: true | <ms> }`, polls the
 *     status endpoint, recovers the X-PAYMENT header on approve, and retries
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

  let reqs: X402Requirements;
  try {
    reqs = (await first.clone().json()) as X402Requirements;
  } catch {
    return first;
  }

  const offer = reqs.accepts?.find(
    (a) => a.scheme === "exact" && a.network === "base",
  );
  if (!offer) return first;

  const { status: signStatus, body: signBody } = await transport.request<SignResponseBody>({
    method: "POST",
    path: "/api/sign",
    body: {
      agent_id: agentId,
      type: "x402",
      chain_id: 8453,
      recipient_address: offer.payTo,
      payload: { x402: offer, x402Version: reqs.x402Version ?? 1 },
    },
    expectStatuses: [200, 202],
  });

  let xPaymentHeader: string | null = null;

  if (signStatus === 202) {
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
      typeof opts.waitForApproval === "number"
        ? opts.waitForApproval
        : 5 * 60 * 1000;
    const decided = await waitForApproval(transport, approvalId, { timeoutMs });

    if (decided.status === "denied") {
      throw new CanopyApprovalDeniedError(approvalId, transactionId);
    }
    if (decided.status === "expired") {
      throw new CanopyApprovalExpiredError(approvalId, transactionId);
    }
    // approved
    if (decided.xPaymentHeader) {
      xPaymentHeader = decided.xPaymentHeader;
    } else {
      // Status race: poll once more for a populated header.
      const refreshed = await getApprovalStatus(transport, approvalId);
      xPaymentHeader = refreshed.xPaymentHeader ?? null;
    }
  } else {
    xPaymentHeader = signBody.x_payment_header ?? null;
  }

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
