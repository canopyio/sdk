"""Tests for `canopy.openai` adapter — both sync and async clients."""

import json
from typing import Any

import httpx

from canopy_ai import AsyncCanopy, Canopy
from canopy_ai.transport import Transport


def _capture_transport(
    captured: dict[str, Any],
    sign_status: int = 200,
    sign_body: dict[str, Any] | None = None,
) -> Transport:
    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content) if request.content else None
        if request.url.path == "/api/sign":
            return httpx.Response(
                sign_status,
                json=sign_body
                or {
                    "signature": "0xsig",
                    "tx_hash": "0xhash",
                    "agent_id": "agt_test",
                    "cost_usd": "$0.10",
                    "transaction_id": "tx_1",
                },
            )
        if request.url.path.startswith("/api/approvals/") and request.url.path.endswith(
            "/decide-by-agent"
        ):
            return httpx.Response(
                200,
                json={
                    "decision": "approved",
                    "transaction_id": "tx_99",
                    "tx_hash": "0xapproved",
                    "signature": "0xsig",
                },
            )
        return httpx.Response(200, json={})

    return Transport(
        "https://www.trycanopy.ai",
        "ak_test_x",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def _new_canopy(transport: Transport) -> Canopy:
    canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
    canopy._transport = transport  # noqa: SLF001
    return canopy


class TestOpenAITools:
    def test_returns_chat_completions_tool_shape(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        tools = canopy.openai.tools()
        assert len(tools) == 4
        names = [t["function"]["name"] for t in tools]
        assert names == [
            "canopy_pay",
            "canopy_discover_services",
            "canopy_approve",
            "canopy_deny",
        ]
        for t in tools:
            assert t["type"] == "function"
            assert "execute" not in t
            assert "execute" not in t["function"]
            assert t["function"]["parameters"]["type"] == "object"


class TestOpenAIDispatch:
    def test_empty_input(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        assert canopy.openai.dispatch(None) == []
        assert canopy.openai.dispatch([]) == []

    def test_dispatches_canopy_pay(self) -> None:
        captured: dict[str, Any] = {}
        canopy = _new_canopy(_capture_transport(captured))
        messages = canopy.openai.dispatch(
            [
                {
                    "id": "call_1",
                    "function": {
                        "name": "canopy_pay",
                        "arguments": json.dumps(
                            {"to": "0x" + "1" * 40, "amountUsd": 0.1}
                        ),
                    },
                }
            ]
        )
        assert len(messages) == 1
        assert messages[0]["role"] == "tool"
        assert messages[0]["tool_call_id"] == "call_1"
        parsed = json.loads(messages[0]["content"])
        assert parsed["status"] == "allowed"
        assert parsed["tx_hash"] == "0xhash"

    def test_propagates_pending_approval_rich_fields(self) -> None:
        captured: dict[str, Any] = {}
        canopy = _new_canopy(
            _capture_transport(
                captured,
                sign_status=202,
                sign_body={
                    "status": "pending_approval",
                    "reason": "Amount $7.50 exceeds approval threshold of $5",
                    "approval_request_id": "ar_x9",
                    "transaction_id": "tx_pending_1",
                    "recipient_name": "Alchemy",
                    "recipient_address": "0x" + "2" * 40,
                    "amount_usd": 7.5,
                    "agent_name": "Trader",
                    "expires_at": "2026-04-29T12:00:00.000Z",
                    "chat_approval_enabled": True,
                },
            )
        )
        messages = canopy.openai.dispatch(
            [
                {
                    "id": "call_2",
                    "function": {
                        "name": "canopy_pay",
                        "arguments": json.dumps(
                            {"to": "0x" + "2" * 40, "amountUsd": 7.5}
                        ),
                    },
                }
            ]
        )
        parsed = json.loads(messages[0]["content"])
        assert parsed["status"] == "pending_approval"
        assert parsed["approval_id"] == "ar_x9"
        assert parsed["recipient_name"] == "Alchemy"
        assert parsed["amount_usd"] == 7.5
        assert parsed["agent_name"] == "Trader"
        assert parsed["chat_approval_enabled"] is True

    def test_chat_native_approve(self) -> None:
        captured: dict[str, Any] = {}
        canopy = _new_canopy(_capture_transport(captured))
        messages = canopy.openai.dispatch(
            [
                {
                    "id": "call_3",
                    "function": {
                        "name": "canopy_approve",
                        "arguments": json.dumps({"approval_id": "ar_x9"}),
                    },
                }
            ]
        )
        parsed = json.loads(messages[0]["content"])
        assert parsed["decision"] == "approved"
        assert parsed["tx_hash"] == "0xapproved"

    def test_skips_unknown_tools(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        messages = canopy.openai.dispatch(
            [
                {
                    "id": "call_other",
                    "function": {"name": "user_owned_tool", "arguments": "{}"},
                }
            ]
        )
        assert messages == []


class TestAsyncOpenAI:
    async def test_async_tools_match_sync(self) -> None:
        canopy = AsyncCanopy(api_key="ak_test_x", agent_id="agt_test")
        tools = canopy.openai.tools()
        assert [t["function"]["name"] for t in tools] == [
            "canopy_pay",
            "canopy_discover_services",
            "canopy_approve",
            "canopy_deny",
        ]

    async def test_async_dispatch_pending_approval(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/api/sign"
            return httpx.Response(
                202,
                json={
                    "status": "pending_approval",
                    "reason": "over",
                    "approval_request_id": "ar_async",
                    "transaction_id": "tx_async",
                    "recipient_name": "Alchemy",
                    "amount_usd": 7.5,
                    "agent_name": "Trader",
                    "expires_at": "2026-04-29T12:00:00.000Z",
                    "chat_approval_enabled": True,
                },
            )

        canopy = AsyncCanopy(
            api_key="ak_test_x",
            agent_id="agt_test",
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        messages = await canopy.openai.dispatch(
            [
                {
                    "id": "call_a",
                    "function": {
                        "name": "canopy_pay",
                        "arguments": json.dumps(
                            {"to": "0x" + "1" * 40, "amountUsd": 7.5}
                        ),
                    },
                }
            ]
        )
        parsed = json.loads(messages[0]["content"])
        assert parsed["status"] == "pending_approval"
        assert parsed["approval_id"] == "ar_async"
        assert parsed["recipient_name"] == "Alchemy"
