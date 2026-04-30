"""
Decode and validate MPP (Machine Payments Protocol) 402 challenges.

MPP servers emit ``WWW-Authenticate: Payment id="…", realm="…", method="…",
intent="…", request="<base64>", expires="…"[, digest="…", opaque="…"]``.
We parse the auth-params, base64-decode the ``request``, and surface a
structured ``MppChallenge`` for the SDK's fetch wrapper to forward to
``/api/sign``.

Reference: https://mpp.dev/protocol/http-402, fixture at
``sdk/shared/fixtures/mpp_tempo_charge_402.json`` (as captured from
parallelmpp.dev).
"""

from __future__ import annotations

import base64
import json
import re
from typing import Any, TypedDict

from typing_extensions import NotRequired


class MppRequest(TypedDict):
    amount: str
    currency: str
    recipient: str
    methodDetails: dict[str, Any]


class MppChallenge(TypedDict):
    id: str
    realm: str
    method: str
    intent: str
    expires: str
    request: MppRequest
    digest: NotRequired[str]
    opaque: NotRequired[str]


_AUTH_PARAM_RE = re.compile(r'(\w+)\s*=\s*"([^"]*)"')


def _from_base64_utf8(s: str) -> str:
    """Accept both base64 and base64url. Convert URL-safe chars and re-pad."""
    padded = s.replace("-", "+").replace("_", "/")
    # Re-pad to a multiple of 4 since base64url usually omits padding.
    pad = (-len(padded)) % 4
    return base64.b64decode(padded + ("=" * pad)).decode("utf-8")


def _parse_payment_auth_params(header_value: str) -> dict[str, str] | None:
    """
    Parse ``Payment id="…", method="…", request="…", …`` into a flat dict.
    Returns None when the header isn't a Payment scheme.

    Greedy ``[^"]*`` is fine for our values — mppx and parallelmpp.dev
    produce base64url tokens with no embedded ``"``.
    """
    m = re.match(r"^Payment\s+(.+)$", header_value, re.IGNORECASE)
    if not m:
        return None
    body = m.group(1)
    out: dict[str, str] = {}
    for pair in _AUTH_PARAM_RE.finditer(body):
        out[pair.group(1)] = pair.group(2)
    return out


def parse_mpp_challenge(headers: Any) -> MppChallenge | None:
    """
    Read the WWW-Authenticate header from a 402 response and parse it as an
    MPP challenge. Returns None if the header is missing, isn't a Payment
    scheme, or fails minimal shape validation.

    ``headers`` is anything supporting case-insensitive ``.get(name)``
    (httpx ``Response.headers``, dict-like, etc.).
    """
    raw = None
    if hasattr(headers, "get"):
        raw = headers.get("www-authenticate") or headers.get("WWW-Authenticate")
    if not raw:
        return None
    params = _parse_payment_auth_params(raw)
    if not params:
        return None
    for k in ("id", "realm", "method", "intent", "request", "expires"):
        if not isinstance(params.get(k), str):
            return None
    try:
        request = json.loads(_from_base64_utf8(params["request"]))
    except (ValueError, json.JSONDecodeError):
        return None
    if not _is_mpp_request(request):
        return None
    challenge: MppChallenge = {
        "id": params["id"],
        "realm": params["realm"],
        "method": params["method"],
        "intent": params["intent"],
        "expires": params["expires"],
        "request": request,
    }
    if isinstance(params.get("digest"), str):
        challenge["digest"] = params["digest"]
    if isinstance(params.get("opaque"), str):
        challenge["opaque"] = params["opaque"]
    return challenge


def _is_mpp_request(v: Any) -> bool:
    if not isinstance(v, dict):
        return False
    amount = v.get("amount")
    if not isinstance(amount, str) or not amount.isdigit():
        return False
    if not isinstance(v.get("currency"), str):
        return False
    if not isinstance(v.get("recipient"), str):
        return False
    md = v.get("methodDetails")
    if not isinstance(md, dict):
        return False
    if not isinstance(md.get("chainId"), int):
        return False
    return True
