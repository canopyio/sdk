/** USDC contract on Base mainnet (chain 8453). */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;

/** `transfer(address,uint256)` function selector. */
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";

/**
 * Builds the `data` field for an ERC-20 `transfer(to, amount)` call.
 * Returns hex string with 0x prefix.
 */
export function encodeErc20Transfer(to: string, amount: bigint): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
    throw new Error(`Invalid address: ${to}`);
  }
  const addressPadded = to.slice(2).toLowerCase().padStart(64, "0");
  const amountPadded = amount.toString(16).padStart(64, "0");
  return `${ERC20_TRANSFER_SELECTOR}${addressPadded}${amountPadded}` as `0x${string}`;
}

/**
 * Converts a USD amount (decimal float) into USDC base units.
 * $0.10 → 100_000n (since USDC has 6 decimals).
 *
 * Uses string-based math to avoid IEEE-754 rounding on large values.
 */
export function usdToUsdcUnits(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(`Invalid USD amount: ${usd}`);
  }
  const [whole, fraction = ""] = usd.toFixed(USDC_DECIMALS).split(".");
  const fractionPadded = fraction.padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  return BigInt(whole + fractionPadded);
}

/** Scans for entity-registry slugs. Anything not matching this is treated as a 0x address. */
export function isEntitySlug(to: string): boolean {
  return !/^0x[0-9a-fA-F]{40}$/.test(to);
}
