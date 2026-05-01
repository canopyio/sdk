from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from canopy_ai.approval import (
    get_approval_status,
    wait_for_approval as _wait_for_approval,
)
from canopy_ai.balances import get_treasury_balances
from canopy_ai.errors import (
    CanopyApprovalDeniedError,
    CanopyApprovalExpiredError,
    CanopyApprovalRequiredError,
    CanopyConfigError,
    CanopyError,
)
from canopy_ai.mpp_decode import MppChallenge, parse_mpp_challenge
from canopy_ai.transport import Transport
from canopy_ai.x402_decode import verify_x_payment_matches_offer


# USDC and USDC.e on every chain we currently support are 6-decimal. If a
# future asset uses different precision the candidate-amount logic needs a
# per-chain decimals lookup — until then this captures the shared convention.
_STABLECOIN_DECIMALS = 6
_EIP155_RE = re.compile(r"^eip155:(\d+)$")


def _chain_id_for_x402_network(network: str) -> int | None:
    """Normalize a 402 offer's ``network`` field to an EVM chain ID.
    Accepts both legacy (``"base"``) and CAIP-2 (``"eip155:8453"``) forms.
    """
    if network == "base":
        return 8453
    m = _EIP155_RE.match(network)
    return int(m.group(1)) if m else None


def _atomic_to_usd(amount: str) -> float | None:
    if not amount.isdigit():
        return None
    return int(amount) / float(10**_STABLECOIN_DECIMALS)


@dataclass
class _Candidate:
    source: Literal["mpp", "x402"]
    chain_id: int
    amount_usd: float
    mpp_challenge: MppChallenge | None = None
    x402_offer: dict[str, Any] | None = None
    x402_reqs: dict[str, Any] | None = None


def _enumerate_candidates(first: httpx.Response) -> list[_Candidate]:
    """
    Walk both 402 envelopes and emit a flat candidate list in the server's
    preference order: MPP first when present, then each x402 ``accepts[]``
    entry.
    """
    candidates: list[_Candidate] = []

    mpp = parse_mpp_challenge(first.headers)
    if mpp and mpp["method"] == "tempo" and mpp["intent"] == "charge":
        amount_usd = _atomic_to_usd(mpp["request"]["amount"])
        if amount_usd is not None:
            candidates.append(
                _Candidate(
                    source="mpp",
                    chain_id=mpp["request"]["methodDetails"]["chainId"],
                    amount_usd=amount_usd,
                    mpp_challenge=mpp,
                )
            )

    try:
        reqs = first.json()
    except (ValueError, json.JSONDecodeError):
        return candidates

    if isinstance(reqs, dict):
        accepts = reqs.get("accepts")
        if isinstance(accepts, list):
            for offer in accepts:
                if not isinstance(offer, dict):
                    continue
                if offer.get("scheme") != "exact":
                    continue
                network = offer.get("network")
                if not isinstance(network, str):
                    continue
                chain_id = _chain_id_for_x402_network(network)
                if chain_id is None:
                    continue
                atomic = offer.get("amount") or offer.get("maxAmountRequired")
                if not isinstance(atomic, str):
                    continue
                amount_usd = _atomic_to_usd(atomic)
                if amount_usd is None:
                    continue
                candidates.append(
                    _Candidate(
                        source="x402",
                        chain_id=chain_id,
                        amount_usd=amount_usd,
                        x402_offer=offer,
                        x402_reqs=reqs,
                    )
                )

    return candidates


def _choose_candidate(
    transport: Transport,
    candidates: list[_Candidate],
) -> _Candidate | None:
    """
    Pick the first candidate the treasury can fund. Skips the balance
    round-trip when there's only one candidate so existing single-rail
    fixtures don't have to stub /api/balances/by-chain.
    """
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    balances = get_treasury_balances(transport)
    if balances is None:
        return candidates[0]
    balance_map: dict[int, float] = {}
    for b in balances:
        try:
            balance_map[int(b["chainId"])] = float(b.get("usdcBalance", "0") or 0)
        except (TypeError, ValueError):
            continue
    for c in candidates:
        have = balance_map.get(c.chain_id, 0.0)
        if have >= c.amount_usd:
            return c
    # Nothing has enough — try the first and let /api/sign reject honestly.
    return candidates[0]


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
    with the appropriate payment header.

    Recognizes two 402 envelopes:
      - MPP: ``WWW-Authenticate: Payment id="…", method="tempo", request="…"``
        — signed Tempo native tx, retried with ``Authorization: Payment <…>``.
      - x402: body ``{ accepts: [{ scheme: "exact", network: "base"|
        "eip155:8453", … }] }`` — signed EIP-3009 authorization, retried
        with ``X-PAYMENT: <…>``.

    Three policy outcomes the server can return for either rail:
      - 200 allowed → SDK retries with the appropriate payment header
      - 202 pending_approval → if ``wait_for_approval`` is False (default), raise
        ``CanopyApprovalRequiredError``; if True or an int (ms), poll the status
        endpoint, recover the header on approve, and retry
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

    candidates = _enumerate_candidates(first)
    chosen = _choose_candidate(transport, candidates)
    if chosen is None:
        return first

    if chosen.source == "mpp":
        return _retry_with_mpp(
            transport,
            agent_id,
            client,
            method,
            url,
            req_headers,
            content,
            chosen.mpp_challenge,  # type: ignore[arg-type]
            wait_for_approval=wait_for_approval,
        )
    return _retry_with_x402(
        transport,
        agent_id,
        client,
        method,
        url,
        req_headers,
        content,
        chosen.x402_offer,  # type: ignore[arg-type]
        chosen.x402_reqs,  # type: ignore[arg-type]
        wait_for_approval=wait_for_approval,
    )


def _retry_with_x402(
    transport: Transport,
    agent_id: str,
    client: httpx.Client,
    method: str,
    url: str,
    req_headers: dict[str, str],
    content: Any,
    offer: dict[str, Any],
    reqs: dict[str, Any],
    *,
    wait_for_approval: bool | int,
) -> httpx.Response:
    network = offer.get("network", "base")
    chain_id = _chain_id_for_x402_network(network) or 8453
    sign_status, sign_body = transport.request(
        "POST",
        "/api/sign",
        json={
            "agent_id": agent_id,
            "type": "x402",
            "chain_id": chain_id,
            "recipient_address": offer["payTo"],
            "payload": {"x402": offer, "x402Version": reqs.get("x402Version", 1), "resource_url": url},
        },
        expect_statuses=[200, 202],
    )
    assert isinstance(sign_body, dict)

    x_payment_header = _resolve_payment_header(
        transport,
        sign_status,
        sign_body,
        "x_payment_header",
        wait_for_approval=wait_for_approval,
    )
    if not x_payment_header:
        raise CanopyError("x402 signing returned no X-PAYMENT header")

    if not isinstance(x_payment_header, str):
        x_payment_header = base64.b64encode(
            json.dumps(x_payment_header).encode()
        ).decode()

    ok, reason = verify_x_payment_matches_offer(x_payment_header, offer)
    if not ok:
        raise CanopyError(reason or "X-PAYMENT verification failed")

    retry_headers = dict(req_headers)
    retry_headers["X-PAYMENT"] = x_payment_header
    return client.request(method, url, headers=retry_headers, content=content)


def _retry_with_mpp(
    transport: Transport,
    agent_id: str,
    client: httpx.Client,
    method: str,
    url: str,
    req_headers: dict[str, str],
    content: Any,
    challenge: MppChallenge,
    *,
    wait_for_approval: bool | int,
) -> httpx.Response:
    sign_status, sign_body = transport.request(
        "POST",
        "/api/sign",
        json={
            "agent_id": agent_id,
            "type": "mpp",
            "chain_id": challenge["request"]["methodDetails"]["chainId"],
            "recipient_address": challenge["request"]["recipient"],
            "payload": {"mpp_challenge": challenge, "resource_url": url},
        },
        expect_statuses=[200, 202],
    )
    assert isinstance(sign_body, dict)

    payment_header = _resolve_payment_header(
        transport,
        sign_status,
        sign_body,
        "mpp_payment_header",
        wait_for_approval=wait_for_approval,
    )
    if not payment_header:
        raise CanopyError("MPP signing returned no Payment header")

    retry_headers = dict(req_headers)
    retry_headers["Authorization"] = f"Payment {payment_header}"
    return client.request(method, url, headers=retry_headers, content=content)


def _resolve_payment_header(
    transport: Transport,
    sign_status: int,
    sign_body: dict[str, Any],
    header_field: Literal["x_payment_header", "mpp_payment_header"],
    *,
    wait_for_approval: bool | int,
) -> str | None:
    """Shared 200-allowed / 202-pending_approval / approval-poll logic for
    both x402 and MPP. Returns the payment header value or None."""
    if sign_status == 200:
        return sign_body.get(header_field)

    # 202 pending_approval
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
        wait_for_approval
        if isinstance(wait_for_approval, int) and wait_for_approval > 0
        else 5 * 60 * 1000
    )
    decided = _wait_for_approval(transport, approval_id, timeout_ms=timeout_ms)
    if decided["status"] == "denied":
        raise CanopyApprovalDeniedError(approval_id, transaction_id)
    if decided["status"] == "expired":
        raise CanopyApprovalExpiredError(approval_id, transaction_id)
    # approved — pick the matching header for this rail.
    pick = decided.get(header_field)
    if pick:
        return pick
    refreshed = get_approval_status(transport, approval_id)
    return refreshed.get(header_field)
