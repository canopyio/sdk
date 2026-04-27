import json
from typing import Any

import httpx
import pytest

from canopy_ai import Canopy
from canopy_ai.transport import Transport


def _capture_client(captured: dict[str, Any]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content) if request.content else None
        captured["path"] = request.url.path
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
    # Swap in a controllable transport so adapter executors hit our handler.
    canopy._transport = Transport(  # noqa: SLF001
        "https://www.trycanopy.ai", "ak_test_x", client=_capture_client(captured)
    )
    return canopy


class TestOpenAIAdapter:
    def test_shape(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        tools = canopy.get_tools(framework="openai")
        assert len(tools) == 1
        assert tools[0]["function"]["name"] == "canopy_pay"
        assert tools[0]["function"]["parameters"]["required"] == ["to", "amountUsd"]

    def test_execute_calls_sign(self) -> None:
        captured: dict[str, Any] = {}
        canopy = _new_canopy(captured)
        [tool] = canopy.get_tools(framework="openai")
        tool["execute"]({"to": "0x" + "1" * 40, "amountUsd": 0.1})
        assert captured["body"]["agent_id"] == "agt_test"
        assert captured["body"]["amount_usd"] == 0.1
        assert captured["body"]["type"] == "raw_transaction"


class TestAnthropicAdapter:
    def test_shape(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        tools = canopy.get_tools(framework="anthropic")
        assert len(tools) == 1
        assert tools[0]["name"] == "canopy_pay"
        assert tools[0]["input_schema"]["required"] == ["to", "amountUsd"]

    def test_execute_calls_sign(self) -> None:
        captured: dict[str, Any] = {}
        canopy = _new_canopy(captured)
        [tool] = canopy.get_tools(framework="anthropic")
        result = tool["execute"]({"to": "0x" + "2" * 40, "amountUsd": 0.25})
        assert result["status"] == "allowed"
        assert captured["body"]["amount_usd"] == 0.25


class TestLangChainAdapter:
    def test_shape(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        tools = canopy.get_tools(framework="langchain")
        assert len(tools) == 1
        assert tools[0]["name"] == "canopy_pay"
        assert tools[0]["schema"]["required"] == ["to", "amountUsd"]

    def test_func_returns_json(self) -> None:
        captured: dict[str, Any] = {}
        canopy = _new_canopy(captured)
        [tool] = canopy.get_tools(framework="langchain")
        out = tool["func"]({"to": "0x" + "3" * 40, "amountUsd": 1.0})
        assert isinstance(out, str)
        parsed = json.loads(out)
        assert parsed["status"] == "allowed"
        assert parsed["tx_hash"] == "0xhash"


class TestVercelAdapter:
    def test_python_raises(self) -> None:
        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test")
        with pytest.raises(NotImplementedError):
            canopy.get_tools(framework="vercel")
