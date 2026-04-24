import type { Transport } from "./transport.js";
import { CanopyConfigError, CanopyError } from "./errors.js";

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

/**
 * fetch() wrapper that auto-handles HTTP 402 by delegating signing to
 * canopy-app's `/api/sign` (type="eip3009") and retrying with the
 * `X-PAYMENT` header.
 *
 * NOTE: the full x402 → EIP-3009 typed-data construction requires contract
 * metadata (USDC domain separator on each network) and nonce generation.
 * The server-side is the natural place for that; the SDK just forwards the
 * 402 body in a `payload.x402` envelope and expects the server to return
 * the fully-encoded `X-PAYMENT` base64 string. Server support lands with
 * the SDK rollout.
 */
export async function canopyFetch(
  transport: Transport,
  agentId: string | undefined,
  url: string,
  init?: RequestInit,
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

  const { body: signBody } = await transport.request<{
    x_payment_header?: string;
    transaction_id: string;
    error?: string;
  }>({
    method: "POST",
    path: "/api/sign",
    body: {
      agent_id: agentId,
      type: "x402",
      chain_id: 8453,
      recipient_address: offer.payTo,
      payload: { x402: offer, x402Version: reqs.x402Version ?? 1 },
    },
    expectStatuses: [200],
  });

  if (!signBody.x_payment_header) {
    throw new CanopyError("x402 signing returned no X-PAYMENT header");
  }

  const retryHeaders = new Headers(init?.headers ?? {});
  retryHeaders.set("X-PAYMENT", signBody.x_payment_header);
  return fetch(url, { ...init, headers: retryHeaders });
}
