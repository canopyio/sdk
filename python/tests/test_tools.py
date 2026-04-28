import json
from typing import Any

import httpx

from canopy_ai import Canopy
from canopy_ai.transport import Transport


def _capture_client(captured: dict[str, Any]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = (
            json.loads(request.content) if request.content else None
        )
        captured["path"] = request.url.path
        captured["query"] = dict(request.url.params)
        if request.url.path.startswith("/api/services"):
            return httpx.Response(200, json={"services": [], "count": 0})
        return httpx.Response(
            200,
            json={
                "signature": "0xsig",
                "tx_hash": "0xhash",
                "agent_id": "agt_test",
                "cost_usd": "$0.10",
                "transaction_id": "tx_1",
            },
        )

    return httpx.Client(transport=httpx.MockTransport(handler))


def _new_canopy(captured: dict[str, Any]) -> Canopy:
    canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
    canopy._transport = Transport(  # noqa: SLF001
        "https://www.trycanopy.ai", "ak_test_x", client=_capture_client(captured)
    )
    return canopy


class TestCanonicalTools:
    def test_returns_canonical_pay_and_discover(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        tools = canopy.get_tools()
        assert len(tools) == 2
        names = [t["name"] for t in tools]
        assert names == ["canopy_pay", "canopy_discover_services"]
        for t in tools:
            assert isinstance(t["name"], str)
            assert isinstance(t["description"], str)
            assert t["parameters"]["type"] == "object"
            assert callable(t["execute"])

    def test_pay_required_args(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        [pay, _] = canopy.get_tools()
        assert pay["parameters"]["required"] == ["to", "amountUsd"]

    def test_pay_execute_hits_api_sign(self) -> None:
        captured: dict[str, Any] = {}
        canopy = _new_canopy(captured)
        [pay, _] = canopy.get_tools()
        pay["execute"]({"to": "0x" + "1" * 40, "amountUsd": 0.1})
        assert captured["path"] == "/api/sign"
        assert captured["body"]["agent_id"] == "agt_test"
        assert captured["body"]["amount_usd"] == 0.1

    def test_discover_execute_hits_api_services(self) -> None:
        captured: dict[str, Any] = {}
        canopy = _new_canopy(captured)
        tools = canopy.get_tools()
        discover_tool = next(t for t in tools if t["name"] == "canopy_discover_services")
        result = discover_tool["execute"]({"category": "data", "query": "orderbook"})
        assert captured["path"] == "/api/services"
        assert captured["query"]["category"] == "data"
        assert captured["query"]["q"] == "orderbook"
        assert captured["query"]["agent_id"] == "agt_test"
        assert result == []


class TestFrameworkWrapRecipes:
    """The README shows one-line wraps for OpenAI / Anthropic. Verify those
    transforms still produce the right shape from canonical tools."""

    def test_openai_wrap(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        tools = canopy.get_tools()
        openai_tools = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["parameters"],
                },
            }
            for t in tools
        ]
        assert openai_tools[0]["type"] == "function"
        assert openai_tools[0]["function"]["name"] == "canopy_pay"
        assert "execute" not in openai_tools[0]["function"]

    def test_anthropic_wrap(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        tools = canopy.get_tools()
        anthropic_tools = [
            {
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["parameters"],
            }
            for t in tools
        ]
        assert anthropic_tools[0]["name"] == "canopy_pay"
        assert anthropic_tools[0]["input_schema"]["type"] == "object"
        assert "parameters" not in anthropic_tools[0]
        assert "execute" not in anthropic_tools[0]
