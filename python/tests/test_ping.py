from typing import Any

import httpx
import pytest

from canopy_ai import Canopy
from canopy_ai.errors import CanopyApiError, CanopyConfigError


def _client(handler: Any) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


class TestPing:
    def test_requires_agent_id(self) -> None:
        canopy = Canopy(api_key="ak_test_x")
        with pytest.raises(CanopyConfigError) as exc:
            canopy.ping()
        assert exc.value.dashboard_url == "https://trycanopy.ai/dashboard/agents"

    def test_returns_structured_response(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert str(request.url) == "https://trycanopy.ai/api/ping"
            return httpx.Response(
                200,
                json={
                    "ok": True,
                    "agent": {
                        "id": "agt_test",
                        "name": "Trader",
                        "status": "active",
                        "policy_id": "pol_1",
                        "policy_name": "trading.default",
                    },
                    "org": {"name": "Acme", "treasury_address": "0xfeed"},
                },
            )

        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test", http_client=_client(handler))
        result = canopy.ping()
        assert result["ok"] is True
        assert result["agent"]["id"] == "agt_test"
        assert result["agent"]["policy_name"] == "trading.default"
        assert result["org"]["name"] == "Acme"
        assert result["latency_ms"] >= 0

    def test_falls_back_to_flat_fields(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "ok": True,
                    "agent_id": "agt_test",
                    "agent_name": "Trader",
                    "status": "active",
                },
            )

        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test", http_client=_client(handler))
        result = canopy.ping()
        assert result["agent"]["id"] == "agt_test"
        assert result["agent"]["name"] == "Trader"
        assert result["agent"]["status"] == "active"
        assert result["agent"]["policy_name"] is None

    def test_propagates_api_error_on_bad_key(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"error": "invalid key"})

        canopy = Canopy(api_key="ak_bad", agent_id="agt_test", http_client=_client(handler))
        with pytest.raises(CanopyApiError) as exc:
            canopy.ping()
        assert exc.value.status == 401
        assert exc.value.dashboard_url == "https://trycanopy.ai/dashboard/settings"
