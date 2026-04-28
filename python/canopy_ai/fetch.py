import base64
import json
from typing import Any

import httpx

from canopy_ai.approval import (
    get_approval_status,
    wait_for_approval as _wait_for_approval,
)
from canopy_ai.errors import (
    CanopyApprovalDeniedError,
    CanopyApprovalExpiredError,
    CanopyApprovalRequiredError,
    CanopyConfigError,
    CanopyError,
)
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
    wait_for_approval: bool | int = False,
) -> httpx.Response:
    """
    Send an HTTP request; if the server answers 402, sign via Canopy and retry
    with the X-PAYMENT header.

    Three policy outcomes the server can return:
      - 200 allowed → SDK retries with X-PAYMENT (existing happy path)
      - 202 pending_approval → if `wait_for_approval` is False (default), raise
        CanopyApprovalRequiredError; if True or an int (ms), poll the status
        endpoint, recover the X-PAYMENT header on approve, and retry
      - 403 denied → raised via the transport
    """
    client = http_client or httpx.Client()
    req_headers = dict(headers or {})

    first = client.request(method, url, headers=req_headers, content=content)
    if first.status_code != 402:
        return first
    if not agent_id:
        raise CanopyConfigError(
            "canopy.fetch() requires an agent_id in the Canopy constructor"
        )

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

    sign_status, sign_body = transport.request(
        "POST",
        "/api/sign",
        json={
            "agent_id": agent_id,
            "type": "x402",
            "chain_id": 8453,
            "recipient_address": offer["payTo"],
            "payload": {"x402": offer, "x402Version": reqs.get("x402Version", 1)},
        },
        expect_statuses=[200, 202],
    )
    assert isinstance(sign_body, dict)

    x_payment_header: str | None = None

    if sign_status == 202:
        approval_id = sign_body.get("approval_request_id")
        transaction_id = sign_body.get("transaction_id")
        if not approval_id or not transaction_id:
            raise CanopyError("Sign returned 202 without approval_request_id")

        if not wait_for_approval:
            raise CanopyApprovalRequiredError(
                sign_body.get("reason", "Approval required"),
                approval_id=approval_id,
                transaction_id=transaction_id,
                recipient_name=sign_body.get("recipient_name"),
                amount_usd=sign_body.get("amount_usd"),
                agent_name=sign_body.get("agent_name"),
                expires_at=sign_body.get("expires_at"),
                chat_approval_enabled=sign_body.get("chat_approval_enabled", True),
            )

        timeout_ms = (
            wait_for_approval if isinstance(wait_for_approval, int) and wait_for_approval > 0
            else 5 * 60 * 1000
        )
        decided = _wait_for_approval(transport, approval_id, timeout_ms=timeout_ms)
        if decided["status"] == "denied":
            raise CanopyApprovalDeniedError(approval_id, transaction_id)
        if decided["status"] == "expired":
            raise CanopyApprovalExpiredError(approval_id, transaction_id)
        # approved
        x_payment_header = decided.get("x_payment_header")
        if not x_payment_header:
            refreshed = get_approval_status(transport, approval_id)
            x_payment_header = refreshed.get("x_payment_header")
    else:
        x_payment_header = sign_body.get("x_payment_header")

    if not x_payment_header:
        raise CanopyError("x402 signing returned no X-PAYMENT header")

    if not isinstance(x_payment_header, str):
        x_payment_header = base64.b64encode(
            json.dumps(x_payment_header).encode()
        ).decode()

    retry_headers = dict(req_headers)
    retry_headers["X-PAYMENT"] = x_payment_header
    return client.request(method, url, headers=retry_headers, content=content)
