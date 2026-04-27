from typing import Any

import httpx
import pytest

from canopy_ai import Canopy
from canopy_ai.errors import CanopyConfigError


def _client(handler: Any) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


class TestBudget:
    def test_requires_agent_id(self) -> None:
        canopy = Canopy(api_key="ak_test_x")
        with pytest.raises(CanopyConfigError) as exc:
            canopy.budget()
        assert exc.value.dashboard_url == "https://www.trycanopy.ai/dashboard/agents"

    def test_returns_budget_snapshot(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert str(request.url) == "https://www.trycanopy.ai/api/agents/agt_test/budget"
            return httpx.Response(
                200,
                json={
                    "agent_id": "agt_test",
                    "cap_usd": 5,
                    "spent_usd": 1.25,
                    "remaining_usd": 3.75,
                    "period_hours": 24,
                    "period_resets_at": "2026-04-28T12:00:00.000Z",
                },
            )

        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test", http_client=_client(handler))
        result = canopy.budget()
        assert result["cap_usd"] == 5
        assert result["spent_usd"] == 1.25
        assert result["remaining_usd"] == 3.75
        assert result["period_hours"] == 24
        assert result["period_resets_at"] == "2026-04-28T12:00:00.000Z"

    def test_no_policy_returns_null_caps(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "agent_id": "agt_test",
                    "cap_usd": None,
                    "spent_usd": 0,
                    "remaining_usd": None,
                    "period_hours": 24,
                    "period_resets_at": None,
                },
            )

        canopy = Canopy(api_key="ak_test_x", agent_id="agt_test", http_client=_client(handler))
        result = canopy.budget()
        assert result["cap_usd"] is None
        assert result["remaining_usd"] is None
        assert result["period_resets_at"] is None
