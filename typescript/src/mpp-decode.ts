/**
 * Decode and validate MPP (Machine Payments Protocol) 402 challenges.
 *
 * MPP servers emit `WWW-Authenticate: Payment id="…", realm="…", method="…",
 * intent="…", request="<base64>", expires="…"[, digest="…", opaque="…"]`.
 * We parse the auth-params, base64-decode the `request`, and surface a
 * structured `MppChallenge` for the SDK's fetch wrapper to forward to
 * `/api/sign`.
 *
 * Reference: https://mpp.dev/protocol/http-402, fixture at
 * `sdk/shared/fixtures/mpp_tempo_charge_402.json`.
 */

export interface MppRequest {
  amount: string;
  currency: `0x${string}`;
  recipient: `0x${string}`;
  methodDetails: {
    chainId: number;
    memo?: `0x${string}`;
    splits?: ReadonlyArray<{ amount: string; recipient: `0x${string}`; memo?: string }>;
    supportedModes?: ReadonlyArray<"pull" | "push">;
    feePayer?: boolean;
    [k: string]: unknown;
  };
}

export interface MppChallenge {
  id: string;
  realm: string;
  method: string;
  intent: string;
  expires: string;
  request: MppRequest;
  digest?: string;
  opaque?: string;
}

function fromBase64Utf8(s: string): string {
  // Accept both base64 and base64url. Convert URL-safe chars and re-pad.
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf8");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Parse `WWW-Authenticate: <scheme> <params>` for `scheme = "Payment"`.
 * Returns the auth-params as a flat object, or null when the header isn't
 * a Payment challenge.
 *
 * Handles RFC-7235 quoted-string values; values are matched lazily so a
 * quote inside a value (e.g. an embedded comma) doesn't fool the regex.
 * For our use mppx and parallelmpp.dev both produce base64url tokens with
 * no embedded special chars, so the regex is safe.
 */
function parsePaymentAuthParams(headerValue: string): Record<string, string> | null {
  const match = headerValue.match(/^Payment\s+(.+)$/i);
  if (!match?.[1]) return null;
  const params: Record<string, string> = {};
  // Match `name="value"` pairs separated by commas. Greedy `[^"]*` is fine
  // because mppx never produces values with embedded `"`.
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(match[1])) !== null) {
    const [, key, value] = m;
    if (key !== undefined && value !== undefined) {
      params[key] = value;
    }
  }
  return params;
}

/**
 * Read the WWW-Authenticate header from a 402 response and parse it as an
 * MPP challenge. Returns null if the header is missing, isn't a Payment
 * scheme, or fails minimal shape validation.
 *
 * `Headers` may carry multiple WWW-Authenticate values separated by commas
 * (RFC 9110 §11.6.1). We only handle a single Payment challenge per
 * response — sufficient for current MPP servers; revisit if multi-method
 * advertisements show up in practice.
 */
export function parseMppChallenge(headers: Headers): MppChallenge | null {
  const raw = headers.get("www-authenticate");
  if (!raw) return null;
  const params = parsePaymentAuthParams(raw);
  if (!params) return null;
  for (const k of ["id", "realm", "method", "intent", "request", "expires"] as const) {
    if (typeof params[k] !== "string") return null;
  }
  let request: unknown;
  try {
    request = JSON.parse(fromBase64Utf8(params.request!));
  } catch {
    return null;
  }
  if (!isMppRequest(request)) return null;
  return {
    id: params.id!,
    realm: params.realm!,
    method: params.method!,
    intent: params.intent!,
    expires: params.expires!,
    request,
    ...(params.digest && { digest: params.digest }),
    ...(params.opaque && { opaque: params.opaque }),
  };
}

function isMppRequest(v: unknown): v is MppRequest {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (typeof r.amount !== "string" || !/^\d+$/.test(r.amount)) return false;
  if (typeof r.currency !== "string") return false;
  if (typeof r.recipient !== "string") return false;
  const md = r.methodDetails;
  if (!md || typeof md !== "object") return false;
  if (typeof (md as Record<string, unknown>).chainId !== "number") return false;
  return true;
}
