"""Dashboard deep-link helpers for error messages.

The Canopy API and dashboard share the same origin in production
(``https://www.trycanopy.ai``); the dashboard sits under ``/dashboard``.
Helpers here derive deep-links from the configured ``base_url`` so error
messages can point developers to the page that fixes the problem.
"""

from urllib.parse import quote


def _dashboard_base(api_base_url: str) -> str:
    return api_base_url.rstrip("/") + "/dashboard"


def api_keys_url(api_base_url: str) -> str:
    return _dashboard_base(api_base_url) + "/settings"


def agents_url(api_base_url: str) -> str:
    return _dashboard_base(api_base_url) + "/agents"


def agent_url(api_base_url: str, agent_id: str) -> str:
    return _dashboard_base(api_base_url) + "/agents/" + quote(agent_id, safe="")


def activity_url(api_base_url: str) -> str:
    return _dashboard_base(api_base_url) + "/activity"
