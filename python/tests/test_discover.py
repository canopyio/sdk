from typing import Any

import httpx
import pytest

from canopy_ai import AsyncCanopy, Canopy


def _client_returning(handler: Any) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _async_client_returning(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


SAMPLE_BODY = {
    "services": [
        {
            "slug": "orderbook",
            "name": "Orderbook Feed",
            "description": "Live order book.",
            "category": "data",
            "logoUrl": None,
            "docsUrl": None,
            "paymentMethods": [
                {
                    "realm": "orderbook.example",
                    "baseUrl": "https://orderbook.example",
                    "protocol": "x402",
                }
            ],
            "endpoints": [
                {
                    "method": "GET",
                    "path": "/v1",
                    "description": None,
                    "priceAtomic": "10000",
                    "currency": "USDC",
                    "pricingModel": "fixed",
                    "protocol": "x402",
                }
            ],
            "preferredBaseUrl": "https://orderbook.example",
            "policyAllowed": True,
        }
    ],
    "count": 1,
}


class TestSyncDiscover:
    def test_returns_parsed_services(self) -> None:
        captured: dict[str, Any] = {}

        def handler(req: httpx.Request) -> httpx.Response:
            captured["url"] = str(req.url)
            return httpx.Response(200, json=SAMPLE_BODY)

        canopy = Canopy(
            api_key="ak_test_x",
            agent_id="agt_test",
            http_client=_client_returning(handler),
        )
        result = canopy.discover(category="data", query="orderbook")
        assert len(result) == 1
        assert result[0]["name"] == "Orderbook Feed"
        assert result[0]["preferred_base_url"] == "https://orderbook.example"
        assert result[0]["payment_methods"][0]["protocol"] == "x402"
        assert result[0]["policy_allowed"] is True
        assert "category=data" in captured["url"]
        assert "q=orderbook" in captured["url"]
        assert "agent_id=agt_test" in captured["url"]

    def test_works_without_agent_id(self) -> None:
        captured: dict[str, Any] = {}

        def handler(req: httpx.Request) -> httpx.Response:
            captured["url"] = str(req.url)
            return httpx.Response(200, json={"services": [], "count": 0})

        canopy = Canopy(api_key="ak_test_x", http_client=_client_returning(handler))
        result = canopy.discover()
        assert result == []
        assert "agent_id=" not in captured["url"]

    def test_forwards_flags(self) -> None:
        captured: dict[str, Any] = {}

        def handler(req: httpx.Request) -> httpx.Response:
            captured["url"] = str(req.url)
            return httpx.Response(200, json={"services": [], "count": 0})

        canopy = Canopy(
            api_key="ak_test_x",
            agent_id="agt_test",
            http_client=_client_returning(handler),
        )
        canopy.discover(include_blocked=True, include_unverified=True, limit=5)
        assert "include_blocked=true" in captured["url"]
        assert "include_unverified=true" in captured["url"]
        assert "limit=5" in captured["url"]

    def test_multiple_categories(self) -> None:
        captured: dict[str, Any] = {}

        def handler(req: httpx.Request) -> httpx.Response:
            captured["url"] = str(req.url)
            return httpx.Response(200, json={"services": [], "count": 0})

        canopy = Canopy(api_key="ak_test_x", http_client=_client_returning(handler))
        canopy.discover(category=["data", "api"])
        assert "category=data" in captured["url"]
        assert "category=api" in captured["url"]


class TestAsyncDiscover:
    @pytest.mark.asyncio
    async def test_returns_parsed_services(self) -> None:
        def handler(_req: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=SAMPLE_BODY)

        canopy = AsyncCanopy(
            api_key="ak_test_x",
            agent_id="agt_test",
            http_client=_async_client_returning(handler),
        )
        result = await canopy.discover(category="data")
        assert len(result) == 1
        assert result[0]["name"] == "Orderbook Feed"
