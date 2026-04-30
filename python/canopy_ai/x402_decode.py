"""
Decode and validate the X-PAYMENT header returned by the Canopy backend.

The header is base64(JSON({ x402Version, scheme, network, payload: {
signature, authorization: { from, to, value, validAfter, validBefore,
nonce } } })) per the x402 spec. We decode it client-side as a defense-
in-depth check before retrying the resource server: a bug or misuse in
the backend that returns a header for the wrong offer (or an expired
one) is caught here rather than silently approving an unintended
payment.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any


def decode_x_payment_header(header: str) -> dict[str, Any] | None:
    try:
        decoded = base64.b64decode(header.encode("ascii"), validate=False)
        parsed = json.loads(decoded.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None

    if not isinstance(parsed, dict):
        return None
    payload = parsed.get("payload")
    if not isinstance(payload, dict):
        return None
    auth = payload.get("authorization")
    if not isinstance(auth, dict):
        return None
    if not isinstance(auth.get("to"), str) or not isinstance(auth.get("validBefore"), str):
        return None
    return parsed


def verify_x_payment_matches_offer(header: str, offer: dict[str, Any]) -> tuple[bool, str | None]:
    envelope = decode_x_payment_header(header)
    if envelope is None:
        return False, "X-PAYMENT header is not a valid envelope"

    auth = envelope["payload"]["authorization"]
    pay_to = offer.get("payTo")
    if not isinstance(pay_to, str):
        return False, "Offer is missing payTo"

    if auth["to"].lower() != pay_to.lower():
        return False, "X-PAYMENT recipient does not match the 402 offer"

    try:
        valid_before = int(auth["validBefore"])
    except (TypeError, ValueError):
        return False, "X-PAYMENT validBefore is malformed"

    if valid_before <= int(time.time()):
        return False, "X-PAYMENT is expired"

    return True, None
