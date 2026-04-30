import type { Transport } from "./transport.js";

/**
 * Per-chain USDC balance snapshot returned by `/api/balances/by-chain`.
 * Matches the wire shape exactly — string balances are kept as strings
 * to avoid float-precision drift on the SDK side.
 */
export interface ChainBalance {
  chainId: number;
  chainName: string;
  usdcBalance: string;
}

interface BalancesByChainResponse {
  balances: ChainBalance[];
}

/**
 * Fetch the org treasury's per-chain USDC balance. Used by `canopy.fetch()`
 * when a 402 advertises ≥2 candidate rails to pick the funded one.
 *
 * Returns null on failure (e.g. treasury not provisioned, transient RPC
 * outage on every chain). Callers fall back to "first match" when the
 * helper returns null — better to attempt the payment and let `/api/sign`
 * surface a clear error than to wedge the request on a balance lookup.
 */
export async function getTreasuryBalances(
  transport: Transport,
): Promise<ChainBalance[] | null> {
  try {
    const { body } = await transport.request<BalancesByChainResponse>({
      method: "GET",
      path: "/api/balances/by-chain",
      expectStatuses: [200],
    });
    return body.balances ?? null;
  } catch {
    return null;
  }
}
