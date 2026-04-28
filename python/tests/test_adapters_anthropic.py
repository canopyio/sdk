"""Tests for `canopy.anthropic` adapter — both sync and async clients."""

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
        if request.url.path == "/api/sign":
            return httpx.Response(
                sign_status,
                json=sign_body
                or {
                    "signature": "0xsig",
                    "tx_hash": "0xhash",
                    "agent_id": "agt_test",
                    "cost_usd": "$0.05",
                    "transaction_id": "tx_1",
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


class TestAnthropicTools:
    def test_returns_messages_tool_shape(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        tools = canopy.anthropic.tools()
        assert len(tools) == 4
        names = [t["name"] for t in tools]
        assert names == [
            "canopy_pay",
            "canopy_discover_services",
            "canopy_approve",
            "canopy_deny",
        ]
        for t in tools:
            assert "input_schema" in t
            assert "parameters" not in t
            assert "execute" not in t
            assert t["input_schema"]["type"] == "object"


class TestAnthropicDispatch:
    def test_empty_input(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        assert canopy.anthropic.dispatch(None) == []
        assert canopy.anthropic.dispatch([]) == []

    def test_dispatches_tool_use_block(self) -> None:
        captured: dict[str, Any] = {}
        canopy = _new_canopy(_capture_transport(captured))
        blocks = canopy.anthropic.dispatch(
            [
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "canopy_pay",
                    "input": {"to": "0x" + "1" * 40, "amountUsd": 0.05},
                }
            ]
        )
        assert len(blocks) == 1
        assert blocks[0]["type"] == "tool_result"
        assert blocks[0]["tool_use_id"] == "tu_1"
        parsed = json.loads(blocks[0]["content"])
        assert parsed["status"] == "allowed"

    def test_propagates_pending_approval_rich_fields(self) -> None:
        captured: dict[str, Any] = {}
        canopy = _new_canopy(
            _capture_transport(
                captured,
                sign_status=202,
                sign_body={
                    "status": "pending_approval",
                    "reason": "over threshold",
                    "approval_request_id": "ar_y2",
                    "transaction_id": "tx_pending_2",
                    "recipient_name": "Alchemy",
                    "amount_usd": 7.5,
                    "agent_name": "Trader",
                    "expires_at": "2026-04-29T12:00:00.000Z",
                    "chat_approval_enabled": True,
                },
            )
        )
        blocks = canopy.anthropic.dispatch(
            [
                {
                    "type": "tool_use",
                    "id": "tu_2",
                    "name": "canopy_pay",
                    "input": {"to": "0x" + "2" * 40, "amountUsd": 7.5},
                }
            ]
        )
        parsed = json.loads(blocks[0]["content"])
        assert parsed["status"] == "pending_approval"
        assert parsed["approval_id"] == "ar_y2"
        assert parsed["recipient_name"] == "Alchemy"
        assert parsed["amount_usd"] == 7.5
        assert parsed["agent_name"] == "Trader"
        assert parsed["chat_approval_enabled"] is True

    def test_skips_text_blocks(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        blocks = canopy.anthropic.dispatch(
            [{"type": "text"}, {"type": "thinking"}]
        )
        assert blocks == []

    def test_skips_non_canopy_tool_use(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        blocks = canopy.anthropic.dispatch(
            [
                {
                    "type": "tool_use",
                    "id": "tu_x",
                    "name": "user_owned_tool",
                    "input": {},
                }
            ]
        )
        assert blocks == []


class TestAsyncAnthropic:
    async def test_async_dispatch_pending_approval(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/api/sign"
            return httpx.Response(
                202,
                json={
                    "status": "pending_approval",
                    "reason": "over",
                    "approval_request_id": "ar_async_anth",
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
        blocks = await canopy.anthropic.dispatch(
            [
                {
                    "type": "tool_use",
                    "id": "tu_async",
                    "name": "canopy_pay",
                    "input": {"to": "0x" + "1" * 40, "amountUsd": 7.5},
                }
            ]
        )
        parsed = json.loads(blocks[0]["content"])
        assert parsed["status"] == "pending_approval"
        assert parsed["approval_id"] == "ar_async_anth"
