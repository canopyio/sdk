"""Sanity tests for AsyncCanopy. Mirror the sync test surface — the heavy
parity testing happens via fixture replay (test_async_fixtures.py)."""

from typing import Any

import httpx
import pytest

from canopy_ai import AsyncCanopy
from canopy_ai.errors import CanopyApiError, CanopyConfigError


def _client(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class TestConfig:
    def test_missing_api_key_points_to_settings(self) -> None:
        with pytest.raises(CanopyConfigError) as exc:
            AsyncCanopy(api_key="")
        assert exc.value.dashboard_url == "https://trycanopy.ai/dashboard/settings"

    async def test_missing_agent_id_on_pay(self) -> None:
        canopy = AsyncCanopy(api_key="ak_test_x")
        with pytest.raises(CanopyConfigError):
            await canopy.pay(to="0x" + "0" * 40, amount_usd=1.0)


class TestPay:
    async def test_allowed(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert str(request.url) == "https://trycanopy.ai/api/sign"
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

        canopy = AsyncCanopy(
            api_key="ak_test_x", agent_id="agt_test", http_client=_client(handler)
        )
        result = await canopy.pay(to="0x" + "1" * 40, amount_usd=0.1)
        assert result["status"] == "allowed"
        assert result["tx_hash"] == "0xhash"


class TestBudgetAndPing:
    async def test_budget(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "agent_id": "agt_test",
                    "cap_usd": 5,
                    "spent_usd": 1.5,
                    "remaining_usd": 3.5,
                    "period_hours": 24,
                    "period_resets_at": None,
                },
            )

        canopy = AsyncCanopy(
            api_key="ak_test_x", agent_id="agt_test", http_client=_client(handler)
        )
        result = await canopy.budget()
        assert result["cap_usd"] == 5
        assert result["remaining_usd"] == 3.5

    async def test_ping(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "ok": True,
                    "agent": {
                        "id": "agt_test",
                        "name": "Trader",
                        "status": "active",
                        "policy_id": None,
                        "policy_name": None,
                    },
                    "org": {"name": "Acme", "treasury_address": "0xfeed"},
                },
            )

        canopy = AsyncCanopy(
            api_key="ak_test_x", agent_id="agt_test", http_client=_client(handler)
        )
        result = await canopy.ping()
        assert result["agent"]["id"] == "agt_test"
        assert result["org"]["name"] == "Acme"


class TestApiError:
    async def test_401_carries_dashboard_url(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"error": "invalid"})

        canopy = AsyncCanopy(
            api_key="ak_bad", agent_id="agt_test", http_client=_client(handler)
        )
        with pytest.raises(CanopyApiError) as exc:
            await canopy.ping()
        assert exc.value.status == 401
        assert exc.value.dashboard_url == "https://trycanopy.ai/dashboard/settings"


class TestFetchX402:
    async def test_402_retries_with_x_payment_header(self) -> None:
        call_count = {"i": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            i = call_count["i"]
            call_count["i"] += 1
            if i == 0:
                # First GET → 402
                assert str(request.url) == "https://paywalled.example.com/api/data"
                return httpx.Response(
                    402,
                    json={
                        "x402Version": 1,
                        "accepts": [
                            {
                                "scheme": "exact",
                                "network": "base",
                                "maxAmountRequired": "100000",
                                "resource": "https://paywalled.example.com/api/data",
                                "payTo": "0x2222222222222222222222222222222222222222",
                                "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                                "maxTimeoutSeconds": 60,
                            }
                        ],
                    },
                )
            if i == 1:
                # POST /api/sign with type=x402
                assert "/api/sign" in str(request.url)
                return httpx.Response(
                    200,
                    json={
                        "signature": "0xfeedbeef",
                        "x_payment_header": "eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiYmFzZSIsInBheWxvYWQiOnsic2lnbmF0dXJlIjoiMHhmZWVkYmVlZiIsImF1dGhvcml6YXRpb24iOnsiZnJvbSI6IjB4MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInRvIjoiMHgyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyIiwidmFsdWUiOiIxMDAwMDAiLCJ2YWxpZEFmdGVyIjoiMCIsInZhbGlkQmVmb3JlIjoiOTk5OTk5OTk5OSIsIm5vbmNlIjoiMHgwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwIn19fQ==",
                        "transaction_id": "tx_x402",
                    },
                )
            # Retry GET with X-PAYMENT
            assert request.headers.get("x-payment") == "eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiYmFzZSIsInBheWxvYWQiOnsic2lnbmF0dXJlIjoiMHhmZWVkYmVlZiIsImF1dGhvcml6YXRpb24iOnsiZnJvbSI6IjB4MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInRvIjoiMHgyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyIiwidmFsdWUiOiIxMDAwMDAiLCJ2YWxpZEFmdGVyIjoiMCIsInZhbGlkQmVmb3JlIjoiOTk5OTk5OTk5OSIsIm5vbmNlIjoiMHgwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwIn19fQ=="
            return httpx.Response(200, json={"data": "premium"})

        canopy = AsyncCanopy(
            api_key="ak_test_x", agent_id="agt_test", http_client=_client(handler)
        )
        res = await canopy.fetch("https://paywalled.example.com/api/data")
        assert res.status_code == 200
        assert res.json() == {"data": "premium"}
        assert call_count["i"] == 3
