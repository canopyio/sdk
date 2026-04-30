import httpx
import pytest

from canopy_ai import Canopy
from canopy_ai.errors import CanopyApiError, CanopyConfigError
from canopy_ai.transport import Transport


def _client_returning(status: int, body: dict[str, object]) -> httpx.Client:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


class TestConfigErrorDashboardUrls:
    def test_missing_api_key_points_to_settings(self) -> None:
        with pytest.raises(CanopyConfigError) as exc:
            Canopy(api_key="")
        assert exc.value.dashboard_url == "https://trycanopy.ai/dashboard/settings"
        assert "https://trycanopy.ai/dashboard/settings" in str(exc.value)

    def test_missing_agent_id_points_to_agents(self) -> None:
        canopy = Canopy(api_key="ak_test_x")
        with pytest.raises(CanopyConfigError) as exc:
            canopy.pay(to="0x" + "0" * 40, amount_usd=1.0)
        assert exc.value.dashboard_url == "https://trycanopy.ai/dashboard/agents"

    def test_custom_base_url_is_respected(self) -> None:
        with pytest.raises(CanopyConfigError) as exc:
            Canopy(api_key="", base_url="http://localhost:3000")
        assert exc.value.dashboard_url == "http://localhost:3000/dashboard/settings"


class TestApiErrorDashboardUrls:
    def test_401_points_to_settings(self) -> None:
        t = Transport(
            "https://trycanopy.ai",
            "ak_test_x",
            client=_client_returning(401, {"error": "invalid api key"}),
        )
        with pytest.raises(CanopyApiError) as exc:
            t.request("GET", "/api/ping")
        assert exc.value.status == 401
        assert exc.value.dashboard_url == "https://trycanopy.ai/dashboard/settings"

    def test_403_outside_expect_statuses_points_to_settings(self) -> None:
        t = Transport(
            "https://trycanopy.ai",
            "ak_test_x",
            client=_client_returning(403, {"error": "forbidden"}),
        )
        with pytest.raises(CanopyApiError) as exc:
            t.request("GET", "/api/resolve")
        assert exc.value.dashboard_url == "https://trycanopy.ai/dashboard/settings"

    def test_404_on_agents_path_points_to_agents(self) -> None:
        t = Transport(
            "https://trycanopy.ai",
            "ak_test_x",
            client=_client_returning(404, {"error": "agent not found"}),
        )
        with pytest.raises(CanopyApiError) as exc:
            t.request("GET", "/api/agents/agt_missing/budget")
        assert exc.value.dashboard_url == "https://trycanopy.ai/dashboard/agents"

    def test_500_has_no_dashboard_url(self) -> None:
        t = Transport(
            "https://trycanopy.ai",
            "ak_test_x",
            client=_client_returning(500, {"error": "boom"}),
        )
        with pytest.raises(CanopyApiError) as exc:
            t.request("GET", "/api/ping")
        assert exc.value.dashboard_url is None

    def test_message_includes_deep_link(self) -> None:
        t = Transport(
            "https://trycanopy.ai",
            "ak_test_x",
            client=_client_returning(401, {"error": "expired"}),
        )
        with pytest.raises(CanopyApiError) as exc:
            t.request("GET", "/api/ping")
        msg = str(exc.value)
        assert "expired" in msg
        assert "https://trycanopy.ai/dashboard/settings" in msg
