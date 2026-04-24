from typing import Any, Literal

import httpx

from canopy_ai.approval import get_approval_status, wait_for_approval
from canopy_ai.encoding import USDC_BASE, encode_erc20_transfer, is_entity_slug, usd_to_usdc_units
from canopy_ai.errors import CanopyConfigError
from canopy_ai.fetch import canopy_fetch
from canopy_ai.resolve import resolve_entity
from canopy_ai.transport import Transport
from canopy_ai.types import ApprovalStatus, PayResult

_DEFAULT_BASE_URL = "https://www.trycanopy.ai"
_DEFAULT_CHAIN_ID = 8453

ToolFramework = Literal["openai", "anthropic", "vercel", "langchain"]


class Canopy:
    def __init__(
        self,
        *,
        api_key: str,
        agent_id: str | None = None,
        base_url: str | None = None,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key:
            raise CanopyConfigError("api_key is required")
        self.agent_id = agent_id
        self._base_url = (base_url or _DEFAULT_BASE_URL).rstrip("/")
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
            raise CanopyConfigError(
                "agent_id is required for pay()/preview(). "
                "Pass it to the Canopy constructor."
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

    def fetch(
        self,
        url: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        content: Any = None,
    ) -> httpx.Response:
        return canopy_fetch(
            self._transport,
            self.agent_id,
            url,
            method=method,
            headers=headers,
            content=content,
        )

    def get_tools(self, *, framework: ToolFramework) -> Any:
        from canopy_ai.integrations import get_tools_for

        return get_tools_for(self, framework)


def _parse_cost_usd(raw: Any) -> float | None:
    if not raw:
        return None
    try:
        return float(str(raw).lstrip("$"))
    except ValueError:
        return None
