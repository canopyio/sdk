import time
from typing import Any

import httpx

from canopy_ai.approval import (
    approve as _approve,
    deny as _deny,
    get_approval_status,
    wait_for_approval,
)
from canopy_ai.dashboard_urls import agents_url, api_keys_url
from canopy_ai.discover import discover as discover_impl
from canopy_ai.encoding import USDC_BASE, encode_erc20_transfer, is_entity_slug, usd_to_usdc_units
from canopy_ai.errors import CanopyConfigError
from canopy_ai.fetch import canopy_fetch
from canopy_ai.resolve import resolve_entity
from canopy_ai.transport import Transport
from canopy_ai.types import (
    ApprovalStatus,
    BudgetSnapshot,
    CanopyTool,
    DecideApprovalResult,
    DiscoverArgs,
    DiscoveredService,
    PayResult,
    PingResult,
)

_DEFAULT_BASE_URL = "https://www.trycanopy.ai"
_DEFAULT_CHAIN_ID = 8453


class Canopy:
    def __init__(
        self,
        *,
        api_key: str,
        agent_id: str | None = None,
        base_url: str | None = None,
        http_client: httpx.Client | None = None,
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
        self._transport = Transport(self._base_url, api_key, client=http_client)

    def pay(
        self,
        *,
        to: str,
        amount_usd: float,
        chain_id: int | None = None,
        idempotency_key: str | None = None,
    ) -> PayResult:
        return self._sign_or_preview(
            to=to,
            amount_usd=amount_usd,
            chain_id=chain_id,
            idempotency_key=idempotency_key,
            dry_run=False,
        )

    def preview(
        self,
        *,
        to: str,
        amount_usd: float,
        chain_id: int | None = None,
        idempotency_key: str | None = None,
    ) -> PayResult:
        return self._sign_or_preview(
            to=to,
            amount_usd=amount_usd,
            chain_id=chain_id,
            idempotency_key=idempotency_key,
            dry_run=True,
        )

    def _sign_or_preview(
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
            resolve_entity(self._transport, to) if is_entity_slug(to) else to
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

        status, res_body = self._transport.request(
            "POST",
            "/api/sign",
            json=body,
            headers=headers or None,
            expect_statuses=[200, 202, 403],
        )
        return self._map_sign_response(status, res_body)

    @staticmethod
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
        # 403
        return {
            "status": "denied",
            "reason": body.get("reason") or body.get("error") or "Policy denied",
            "transaction_id": body["transaction_id"],
        }

    def get_approval_status(self, approval_id: str) -> ApprovalStatus:
        return get_approval_status(self._transport, approval_id)

    def wait_for_approval(
        self,
        approval_id: str,
        *,
        timeout_ms: int = 5 * 60 * 1000,
        poll_interval_ms: int = 2000,
    ) -> ApprovalStatus:
        return wait_for_approval(
            self._transport,
            approval_id,
            timeout_ms=timeout_ms,
            poll_interval_ms=poll_interval_ms,
        )

    def approve(self, approval_id: str) -> DecideApprovalResult:
        """
        Mark a pending approval as approved. Call this when the user
        explicitly approves a transaction in chat (e.g. they replied "yes",
        "approve"). The org's policy must have ``chat_approval_enabled = True``
        (default True), or :class:`CanopyChatApprovalDisabledError` is raised.
        """
        return _approve(self._transport, approval_id)

    def deny(self, approval_id: str) -> DecideApprovalResult:
        """
        Mark a pending approval as denied. Call this when the user explicitly
        denies a transaction in chat (e.g. they replied "no", "cancel").
        """
        return _deny(self._transport, approval_id)

    def fetch(
        self,
        url: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        content: Any = None,
        wait_for_approval: bool | int = False,
    ) -> httpx.Response:
        return canopy_fetch(
            self._transport,
            self.agent_id,
            url,
            method=method,
            headers=headers,
            content=content,
            http_client=self._transport.client,
            wait_for_approval=wait_for_approval,
        )

    def get_tools(self) -> list[CanopyTool]:
        """
        Returns the SDK's canonical tool list (`canopy_pay`,
        `canopy_discover_services`) as
        ``[{name, description, parameters: JSONSchema, execute}]``. Works
        directly with LangChain, MCP, and most agent frameworks. For OpenAI /
        Anthropic, see the README for the one-line wrap recipe.
        """
        from canopy_ai.integrations import get_tools

        return get_tools(self)

    def discover(self, **kwargs: Any) -> list[DiscoveredService]:
        """
        Discover paid services the agent can call. Filter by category, query,
        protocol, etc. By default, only services on the agent's policy
        allowlist are returned (when an allowlist is set).
        """
        args: DiscoverArgs = kwargs  # type: ignore[assignment]
        return discover_impl(self._transport, self.agent_id, args)

    def budget(self) -> BudgetSnapshot:
        """
        Pre-flight cap snapshot for the current agent. Useful for LLM
        planning: "I have $4.30 left this window — defer the expensive call."
        Returns ``cap_usd: None`` and ``remaining_usd: None`` when no policy
        is bound to the agent.
        """
        if not self.agent_id:
            url = agents_url(self._base_url)
            raise CanopyConfigError(
                "agent_id is required for budget(). "
                f"Pass it to the Canopy constructor. Create or find an agent at {url}",
                dashboard_url=url,
            )
        from urllib.parse import quote

        _, body = self._transport.request(
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

    def ping(self) -> PingResult:
        """
        Verify the API key + agent are configured correctly. Use on app
        startup as a fail-fast health check. The dashboard reacts in real
        time when this lands, so it's also the moment the developer sees
        their agent flip from "Never connected" to "Connected".
        """
        if not self.agent_id:
            url = agents_url(self._base_url)
            raise CanopyConfigError(
                "agent_id is required for ping(). "
                f"Pass it to the Canopy constructor. Create or find an agent at {url}",
                dashboard_url=url,
            )
        start = time.monotonic()
        _, body = self._transport.request(
            "POST",
            "/api/ping",
            json={"agent_id": self.agent_id},
            expect_statuses=[200],
        )
        latency_ms = int((time.monotonic() - start) * 1000)
        return _map_ping_response(body, latency_ms)


def _parse_cost_usd(raw: Any) -> float | None:
    if not raw:
        return None
    try:
        return float(str(raw).lstrip("$"))
    except ValueError:
        return None


def _map_ping_response(body: Any, latency_ms: int) -> PingResult:
    """Map /api/ping JSON to a PingResult. Prefers the structured
    ``agent`` / ``org`` fields; falls back to the legacy flat fields so this
    SDK still works against older canopy-app deployments."""
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
