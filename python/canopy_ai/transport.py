import sys
from typing import Any

import httpx

from canopy_ai.dashboard_urls import agents_url, api_keys_url
from canopy_ai.errors import CanopyApiError, CanopyNetworkError

SDK_VERSION = "0.0.1"
USER_AGENT = (
    f"canopy-ai/{SDK_VERSION} "
    f"python/{sys.version_info.major}.{sys.version_info.minor}"
)


class Transport:
    """
    Thin wrapper around httpx. Callers pass a list of statuses they can
    handle (e.g. [200, 202, 403]); anything outside that set becomes a
    CanopyApiError. Network failures become CanopyNetworkError.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._client = client or httpx.Client(timeout=30.0)

    @property
    def client(self) -> httpx.Client:
        """The underlying httpx client. Shared with canopy.fetch() so x402
        retries reuse the same connection pool (and the same test mocks)."""
        return self._client

    def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        headers: dict[str, str] | None = None,
        expect_statuses: list[int] | None = None,
    ) -> tuple[int, Any]:
        url = self._base_url + path
        all_headers = {
            "authorization": f"Bearer {self._api_key}",
            "user-agent": USER_AGENT,
        }
        if headers:
            all_headers.update(headers)
        if json is not None:
            all_headers["content-type"] = "application/json"

        try:
            res = self._client.request(method, url, json=json, headers=all_headers)
        except httpx.HTTPError as err:
            raise CanopyNetworkError(f"Network request to {url} failed", err) from err

        content_type = res.headers.get("content-type", "")
        body: Any
        if "application/json" in content_type:
            try:
                body = res.json()
            except ValueError:
                body = None
        else:
            body = res.text or None

        allowed = expect_statuses or [200]
        if res.status_code not in allowed:
            api_message = (
                body.get("error") if isinstance(body, dict) and "error" in body else None
            )
            dashboard = self._dashboard_url_for(res.status_code, path)
            base_message = api_message or f"Canopy API returned {res.status_code}"
            message = f"{base_message}. See {dashboard}" if dashboard else base_message
            raise CanopyApiError(
                res.status_code, message, body, dashboard_url=dashboard
            )

        return res.status_code, body

    def _dashboard_url_for(self, status: int, path: str) -> str | None:
        if status in (401, 403):
            return api_keys_url(self._base_url)
        if status == 404 and "/agents" in path:
            return agents_url(self._base_url)
        return None
