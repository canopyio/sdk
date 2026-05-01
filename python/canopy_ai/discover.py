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
            "category": s.get("category", ""),
            "logo_url": s.get("logoUrl"),
            "docs_url": s.get("docsUrl"),
            "payment_methods": [
                {
                    "realm": pm.get("realm", ""),
                    "base_url": pm.get("baseUrl", ""),
                    "protocol": pm.get("protocol", ""),
                }
                for pm in (s.get("paymentMethods") or [])
            ],
            "endpoints": [
                {
                    "method": ep.get("method", ""),
                    "path": ep.get("path", ""),
                    "description": ep.get("description"),
                    "price_atomic": ep.get("priceAtomic"),
                    "currency": ep.get("currency"),
                    "pricing_model": ep.get("pricingModel"),
                    "protocol": ep.get("protocol"),
                }
                for ep in (s.get("endpoints") or [])
            ],
            "preferred_base_url": s.get("preferredBaseUrl"),
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
