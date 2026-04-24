import base64
import json
from typing import Any

import httpx

from canopy_ai.errors import CanopyConfigError, CanopyError
from canopy_ai.transport import Transport


def canopy_fetch(
    transport: Transport,
    agent_id: str | None,
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    content: Any = None,
    http_client: httpx.Client | None = None,
) -> httpx.Response:
    """
    Send an HTTP request; if the server answers 402, sign via Canopy and retry
    with the X-PAYMENT header.

    See canopyFetch in the TS SDK for the full design note.
    """
    client = http_client or httpx.Client()
    req_headers = dict(headers or {})

    first = client.request(method, url, headers=req_headers, content=content)
    if first.status_code != 402:
        return first
    if not agent_id:
        raise CanopyConfigError("canopy.fetch() requires an agent_id in the Canopy constructor")

    try:
        reqs = first.json()
    except ValueError:
        return first

    accepts = reqs.get("accepts") if isinstance(reqs, dict) else None
    if not isinstance(accepts, list):
        return first
    offer = next(
        (a for a in accepts if a.get("scheme") == "exact" and a.get("network") == "base"),
        None,
    )
    if not offer:
        return first

    _, sign_body = transport.request(
        "POST",
        "/api/sign",
        json={
            "agent_id": agent_id,
            "type": "x402",
            "chain_id": 8453,
            "recipient_address": offer["payTo"],
            "payload": {"x402": offer, "x402Version": reqs.get("x402Version", 1)},
        },
        expect_statuses=[200],
    )
    if not isinstance(sign_body, dict) or not sign_body.get("x_payment_header"):
        raise CanopyError("x402 signing returned no X-PAYMENT header")

    # If the server already returned a pre-encoded X-PAYMENT header, use it
    # directly. Otherwise expect a JSON payload we base64-encode ourselves.
    header_val = sign_body["x_payment_header"]
    if not isinstance(header_val, str):
        header_val = base64.b64encode(json.dumps(header_val).encode()).decode()

    retry_headers = dict(req_headers)
    retry_headers["X-PAYMENT"] = header_val
    return client.request(method, url, headers=retry_headers, content=content)
