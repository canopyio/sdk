/**
 * Decode and validate the X-PAYMENT header returned by the Canopy backend.
 *
 * The header is base64(JSON({ x402Version, scheme, network, payload: {
 * signature, authorization: { from, to, value, validAfter, validBefore,
 * nonce } } })) per the x402 spec. We decode it client-side as a
 * defense-in-depth check before retrying the resource server: a bug or
 * misuse in the backend that returns a header for the wrong offer (or an
 * expired one) is caught here rather than silently approving an unintended
 * payment.
 */

interface XPaymentEnvelope {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

function fromBase64Utf8(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "base64").toString("utf8");
  // Browser fallback
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

export function decodeXPaymentHeader(header: string): XPaymentEnvelope | null {
  try {
    const parsed = JSON.parse(fromBase64Utf8(header));
    if (
      typeof parsed?.payload?.authorization?.to !== "string" ||
      typeof parsed?.payload?.authorization?.validBefore !== "string"
    ) {
      return null;
    }
    return parsed as XPaymentEnvelope;
  } catch {
    return null;
  }
}

export function verifyXPaymentMatchesOffer(
  header: string,
  offer: { payTo: string },
): { ok: true } | { ok: false; reason: string } {
  const envelope = decodeXPaymentHeader(header);
  if (!envelope) return { ok: false, reason: "X-PAYMENT header is not a valid envelope" };

  const auth = envelope.payload.authorization;
  if (auth.to.toLowerCase() !== offer.payTo.toLowerCase()) {
    return { ok: false, reason: "X-PAYMENT recipient does not match the 402 offer" };
  }

  const validBefore = Number(auth.validBefore);
  if (!Number.isFinite(validBefore) || validBefore <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "X-PAYMENT is expired" };
  }

  return { ok: true };
}
