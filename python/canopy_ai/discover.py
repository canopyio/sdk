"""Service discovery: GET /api/services.

The shape-translation logic lives here; the sync and async clients each call
their own request method around it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

if TYPE_CHECKING:
    from canopy_ai.transport import Transport
    from canopy_ai.types import DiscoverArgs, DiscoveredService


def build_query(agent_id: str | None, args: "DiscoverArgs") -> str:
    """Render a /api/services query string from discover args + agent id."""
    pairs: list[tuple[str, str]] = []
    cats = args.get("category")
    if cats is not None:
        if isinstance(cats, str):
            pairs.append(("category", cats))
        else:
            pairs.extend(("category", c) for c in cats)
    if (q := args.get("query")):
        pairs.append(("q", q))
    if args.get("include_unverified"):
        pairs.append(("include_unverified", "true"))
    if args.get("include_blocked"):
        pairs.append(("include_blocked", "true"))
    if (limit := args.get("limit")) is not None:
        pairs.append(("limit", str(limit)))
    if agent_id:
        pairs.append(("agent_id", agent_id))
    return urlencode(pairs)


def map_response(body: Any) -> list["DiscoveredService"]:
    """Convert the JSON response body's services into snake_case TypedDicts."""
    assert isinstance(body, dict), "discover response must be an object"
    services = body.get("services") or []
    return [
        {
            "slug": s.get("slug", ""),
            "name": s.get("name", ""),
            "description": s.get("description"),
            "url": s.get("url"),
            "category": s.get("category", ""),
            "payment_protocol": s.get("paymentProtocol"),
            "typical_amount_usd": s.get("typicalAmountUsd"),
            "pay_to": s.get("payTo", ""),
            "policy_allowed": bool(s.get("policyAllowed", True)),
        }
        for s in services
    ]


def discover(
    transport: "Transport",
    agent_id: str | None,
    args: "DiscoverArgs",
) -> list["DiscoveredService"]:
    qs = build_query(agent_id, args)
    path = f"/api/services?{qs}" if qs else "/api/services"
    _, body = transport.request("GET", path, expect_statuses=[200])
    return map_response(body)
