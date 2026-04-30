"""
Per-chain treasury balance helper for the SDK's multi-chain routing path.

``canopy.fetch()`` calls this only when a 402 advertises ≥2 candidate rails
to pick the funded one. Single-candidate flows skip the round-trip and
just attempt the offer.
"""

from __future__ import annotations

from typing import TypedDict

from canopy_ai.transport import Transport


class ChainBalance(TypedDict):
    chainId: int
    chainName: str
    usdcBalance: str


def get_treasury_balances(transport: Transport) -> list[ChainBalance] | None:
    """
    Fetch the org treasury's per-chain USDC balance via
    ``/api/balances/by-chain``. Returns None on failure (treasury not
    provisioned, every chain RPC down, …) so callers fall back to the
    server's preference order — better to attempt the payment and let
    ``/api/sign`` surface a clear error than to wedge the request.
    """
    try:
        _, body = transport.request(
            "GET",
            "/api/balances/by-chain",
            expect_statuses=[200],
        )
    except Exception:
        return None
    if not isinstance(body, dict):
        return None
    balances = body.get("balances")
    if not isinstance(balances, list):
        return None
    return balances
