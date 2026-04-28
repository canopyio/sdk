"""Async Canopy client.

Mirrors the synchronous :class:`canopy_ai.Canopy` API one-for-one but uses
``httpx.AsyncClient`` under the hood, so it integrates with frameworks that
expect ``await`` (LangGraph, FastAPI handlers, asyncio agent loops).

The wire format and return shapes are identical to the sync client — both
classes are tested against the same shared fixtures.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from typing import Any
from urllib.parse import quote

import httpx

from canopy_ai.dashboard_urls import agents_url, api_keys_url
from canopy_ai.encoding import (
    USDC_BASE,
    encode_erc20_transfer,
    is_entity_slug,
    usd_to_usdc_units,
)
from canopy_ai.errors import (
    CanopyApiError,
    CanopyApprovalTimeoutError,
    CanopyConfigError,
    CanopyError,
    CanopyNetworkError,
)
from canopy_ai.discover import build_query as _build_discover_query
from canopy_ai.discover import map_response as _map_discover_response
from canopy_ai.types import (
    ApprovalStatus,
    BudgetSnapshot,
    DecideApprovalResult,
    DiscoverArgs,
    DiscoveredService,
    PayResult,
    PingResult,
)

_DEFAULT_BASE_URL = "https://www.trycanopy.ai"
_DEFAULT_CHAIN_ID = 8453


class AsyncCanopy:
    """Async client. ``await canopy.pay(...)`` / ``await canopy.fetch(...)``."""

    def __init__(
        self,
        *,
        api_key: str,
        agent_id: str | None = None,
        base_url: str | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        resolved_base = (base_url or _DEFAULT_BASE_URL).rstrip("/")
        if not api_key:
            url = api_keys_url(resolved_base)
            raise CanopyConfigError(
                f"api_key is required. Create one at {url}",
                dashboard_url=url,
            )
        self.agent_id = agent_id
        self._base_url = resolved_base
        self._api_key = api_key
        self._client = http_client or httpx.AsyncClient(timeout=30.0)

    # ------------------------------------------------------------------ pay

    async def pay(
        self,
        *,
        to: str,
        amount_usd: float,
        chain_id: int | None = None,
        idempotency_key: str | None = None,
    ) -> PayResult:
        return await self._sign_or_preview(
            to=to,
            amount_usd=amount_usd,
            chain_id=chain_id,
            idempotency_key=idempotency_key,
            dry_run=False,
        )

    async def preview(
        self,
        *,
        to: str,
        amount_usd: float,
        chain_id: int | None = None,
        idempotency_key: str | None = None,
    ) -> PayResult:
        return await self._sign_or_preview(
            to=to,
            amount_usd=amount_usd,
            chain_id=chain_id,
            idempotency_key=idempotency_key,
            dry_run=True,
        )

    async def _sign_or_preview(
        self,
        *,
        to: str,
        amount_usd: float,
        chain_id: int | None,
        idempotency_key: str | None,
        dry_run: bool,
    ) -> PayResult:
        if not self.agent_id:
            url = agents_url(self._base_url)
            raise CanopyConfigError(
                "agent_id is required for pay()/preview(). "
                f"Pass it to the Canopy constructor. Create or find an agent at {url}",
                dashboard_url=url,
            )

        recipient = (
            await self._resolve_entity(to) if is_entity_slug(to) else to
        )
        amount_units = usd_to_usdc_units(amount_usd)
        chain = chain_id if chain_id is not None else _DEFAULT_CHAIN_ID

        body: dict[str, Any] = {
            "agent_id": self.agent_id,
            "type": "raw_transaction",
            "chain_id": chain,
            "recipient_address": recipient,
            "amount_usd": amount_usd,
            "payload": {
                "transaction": {
                    "to": USDC_BASE,
                    "data": "0x" + encode_erc20_transfer(recipient, amount_units)[2:],
                }
            },
        }
        if dry_run:
            body["dry_run"] = True

        headers = {}
        if idempotency_key:
            headers["idempotency-key"] = idempotency_key

        status, res_body = await self._request(
            "POST",
            "/api/sign",
            json=body,
            headers=headers or None,
            expect_statuses=[200, 202, 403],
        )
        return _map_sign_response(status, res_body)

    # -------------------------------------------------------------- approvals

    async def get_approval_status(self, approval_id: str) -> ApprovalStatus:
        _, body = await self._request(
            "GET", f"/api/approvals/{approval_id}/status", expect_statuses=[200]
        )
        assert isinstance(body, dict)
        return {
            "status": body["status"],
            "decided_at": body.get("decided_at"),
            "expires_at": body["expires_at"],
            "transaction_id": body["transaction_id"],
            "x_payment_header": body.get("x_payment_header"),
        }

    async def wait_for_approval(
        self,
        approval_id: str,
        *,
        timeout_ms: int = 5 * 60 * 1000,
        poll_interval_ms: int = 2000,
    ) -> ApprovalStatus:
        deadline = time.monotonic() + timeout_ms / 1000
        while True:
            status = await self.get_approval_status(approval_id)
            if status["status"] != "pending":
                return status
            if time.monotonic() >= deadline:
                raise CanopyApprovalTimeoutError(approval_id, timeout_ms)
            await asyncio.sleep(poll_interval_ms / 1000)

    async def approve(self, approval_id: str) -> DecideApprovalResult:
        return await self._decide(approval_id, "approved")

    async def deny(self, approval_id: str) -> DecideApprovalResult:
        return await self._decide(approval_id, "denied")

    async def _decide(
        self, approval_id: str, decision: str
    ) -> DecideApprovalResult:
        from canopy_ai.errors import CanopyChatApprovalDisabledError

        status, body = await self._request(
            "POST",
            f"/api/approvals/{approval_id}/decide-by-agent",
            json={"decision": decision},
            expect_statuses=[200, 403],
        )
        assert isinstance(body, dict)
        if status == 403 and body.get("error") == "chat_approval_disabled":
            raise CanopyChatApprovalDisabledError(approval_id, body.get("message"))
        return {
            "decision": body["decision"],
            "transaction_id": body.get("transaction_id"),
            "tx_hash": body.get("tx_hash"),
            "signature": body.get("signature"),
        }

    # ---------------------------------------------------------------- budget

    async def budget(self) -> BudgetSnapshot:
        if not self.agent_id:
            url = agents_url(self._base_url)
            raise CanopyConfigError(
                "agent_id is required for budget(). "
                f"Pass it to the Canopy constructor. Create or find an agent at {url}",
                dashboard_url=url,
            )
        _, body = await self._request(
            "GET",
            f"/api/agents/{quote(self.agent_id, safe='')}/budget",
            expect_statuses=[200],
        )
        assert isinstance(body, dict)
        return {
            "agent_id": body["agent_id"],
            "cap_usd": body.get("cap_usd"),
            "spent_usd": float(body.get("spent_usd", 0)),
            "remaining_usd": body.get("remaining_usd"),
            "period_hours": int(body.get("period_hours", 24)),
            "period_resets_at": body.get("period_resets_at"),
        }

    # -------------------------------------------------------------- discover

    async def discover(self, **kwargs: Any) -> list[DiscoveredService]:
        """List paid services the agent can call. See sync `Canopy.discover()`."""
        args: DiscoverArgs = kwargs  # type: ignore[assignment]
        qs = _build_discover_query(self.agent_id, args)
        path = f"/api/services?{qs}" if qs else "/api/services"
        _, body = await self._request("GET", path, expect_statuses=[200])
        return _map_discover_response(body)

    # ------------------------------------------------------------------ ping

    async def ping(self) -> PingResult:
        if not self.agent_id:
            url = agents_url(self._base_url)
            raise CanopyConfigError(
                "agent_id is required for ping(). "
                f"Pass it to the Canopy constructor. Create or find an agent at {url}",
                dashboard_url=url,
            )
        start = time.monotonic()
        _, body = await self._request(
            "POST",
            "/api/ping",
            json={"agent_id": self.agent_id},
            expect_statuses=[200],
        )
        latency_ms = int((time.monotonic() - start) * 1000)
        return _map_ping_response(body, latency_ms)

    # ----------------------------------------------------------------- fetch

    async def fetch(
        self,
        url: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        content: Any = None,
        wait_for_approval: bool | int = False,
    ) -> httpx.Response:
        """Like httpx.request, but transparently handles HTTP 402 via x402.

        On a pending_approval policy outcome:
          - default: raises :class:`CanopyApprovalRequiredError`
          - ``wait_for_approval=True`` or an int (ms): polls the approval
            status, recovers the X-PAYMENT header on approve, retries the URL
        """
        from canopy_ai.errors import (
            CanopyApprovalDeniedError,
            CanopyApprovalExpiredError,
            CanopyApprovalRequiredError,
        )

        req_headers = dict(headers or {})
        first = await self._client.request(
            method, url, headers=req_headers, content=content
        )
        if first.status_code != 402:
            return first
        if not self.agent_id:
            raise CanopyConfigError(
                "fetch() requires an agent_id in the AsyncCanopy constructor"
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

        sign_status, sign_body = await self._request(
            "POST",
            "/api/sign",
            json={
                "agent_id": self.agent_id,
                "type": "x402",
                "chain_id": 8453,
                "recipient_address": offer["payTo"],
                "payload": {"x402": offer, "x402Version": reqs.get("x402Version", 1)},
            },
            expect_statuses=[200, 202],
        )
        assert isinstance(sign_body, dict)

        x_payment_header: Any = None

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
                wait_for_approval
                if isinstance(wait_for_approval, int) and wait_for_approval > 0
                else 5 * 60 * 1000
            )
            decided = await self.wait_for_approval(approval_id, timeout_ms=timeout_ms)
            if decided["status"] == "denied":
                raise CanopyApprovalDeniedError(approval_id, transaction_id)
            if decided["status"] == "expired":
                raise CanopyApprovalExpiredError(approval_id, transaction_id)
            x_payment_header = decided.get("x_payment_header")
            if not x_payment_header:
                refreshed = await self.get_approval_status(approval_id)
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
        return await self._client.request(
            method, url, headers=retry_headers, content=content
        )

    # ---------------------------------------------------------------- helpers

    async def _resolve_entity(self, slug: str) -> str:
        _, body = await self._request(
            "GET",
            f"/api/resolve?slug={quote(slug, safe='')}",
            expect_statuses=[200],
        )
        assert isinstance(body, dict)
        addr = body.get("address")
        if not isinstance(addr, str):
            raise CanopyError(f"resolve returned no address for {slug!r}")
        return addr

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        headers: dict[str, str] | None = None,
        expect_statuses: list[int] | None = None,
    ) -> tuple[int, Any]:
        from canopy_ai.transport import USER_AGENT

        url = self._base_url + path
        all_headers = {
            "authorization": f"Bearer {self._api_key}",
            "user-agent": USER_AGENT,
        }
        if headers:
            all_headers.update(headers)
        if json is not None:
            all_headers["content-type"] = "application/json"

        try:
            res = await self._client.request(method, url, json=json, headers=all_headers)
        except httpx.HTTPError as err:
            raise CanopyNetworkError(f"Network request to {url} failed", err) from err

        content_type = res.headers.get("content-type", "")
        body: Any
        if "application/json" in content_type:
            try:
                body = res.json()
            except ValueError:
                body = None
        else:
            body = res.text or None

        allowed = expect_statuses or [200]
        if res.status_code not in allowed:
            api_message = (
                body.get("error") if isinstance(body, dict) and "error" in body else None
            )
            dashboard = self._dashboard_url_for(res.status_code, path)
            base_msg = api_message or f"Canopy API returned {res.status_code}"
            msg = f"{base_msg}. See {dashboard}" if dashboard else base_msg
            raise CanopyApiError(res.status_code, msg, body, dashboard_url=dashboard)

        return res.status_code, body

    def _dashboard_url_for(self, status: int, path: str) -> str | None:
        if status in (401, 403):
            return api_keys_url(self._base_url)
        if status == 404 and "/agents" in path:
            return agents_url(self._base_url)
        return None


def _parse_cost_usd(raw: Any) -> float | None:
    if not raw:
        return None
    try:
        return float(str(raw).lstrip("$"))
    except ValueError:
        return None


def _map_sign_response(status: int, body: Any) -> PayResult:
    assert isinstance(body, dict)
    if status == 200:
        result: PayResult = {
            "status": "allowed",
            "tx_hash": body.get("tx_hash"),
            "signature": body.get("signature"),
            "transaction_id": body.get("transaction_id"),
            "cost_usd": _parse_cost_usd(body.get("cost_usd")),
        }
        if body.get("idempotent"):
            result["idempotent"] = True  # type: ignore[typeddict-unknown-key]
        if body.get("dry_run"):
            result["dry_run"] = True  # type: ignore[typeddict-unknown-key]
        return result
    if status == 202:
        return {
            "status": "pending_approval",
            "approval_id": body.get("approval_request_id", ""),
            "transaction_id": body["transaction_id"],
            "reason": body.get("reason", "Approval required"),
            "recipient_name": body.get("recipient_name"),
            "recipient_address": body.get("recipient_address"),
            "amount_usd": body.get("amount_usd"),
            "agent_name": body.get("agent_name"),
            "expires_at": body.get("expires_at"),
            "chat_approval_enabled": body.get("chat_approval_enabled", True),
        }
    return {
        "status": "denied",
        "reason": body.get("reason") or body.get("error") or "Policy denied",
        "transaction_id": body["transaction_id"],
    }


def _map_ping_response(body: Any, latency_ms: int) -> PingResult:
    assert isinstance(body, dict)
    raw_agent = body.get("agent")
    agent_obj: dict[str, Any] = raw_agent if isinstance(raw_agent, dict) else {}
    raw_org = body.get("org")
    org_obj: dict[str, Any] = raw_org if isinstance(raw_org, dict) else {}
    return {
        "ok": True,
        "agent": {
            "id": agent_obj.get("id") or body.get("agent_id") or "",
            "name": agent_obj.get("name") if "name" in agent_obj else body.get("agent_name"),
            "status": agent_obj.get("status") or body.get("status") or "unknown",
            "policy_id": agent_obj.get("policy_id"),
            "policy_name": agent_obj.get("policy_name"),
        },
        "org": {
            "name": org_obj.get("name"),
            "treasury_address": org_obj.get("treasury_address") or "",
        },
        "latency_ms": latency_ms,
    }
