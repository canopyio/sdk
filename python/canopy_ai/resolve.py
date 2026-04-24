from urllib.parse import quote

from canopy_ai.errors import CanopyApiError
from canopy_ai.transport import Transport


def resolve_entity(transport: Transport, slug: str) -> str:
    """Resolves a registry slug (e.g. agentic.market/anthropic) to an address."""
    _, body = transport.request(
        "GET",
        f"/api/resolve?entity={quote(slug, safe='')}",
        expect_statuses=[200],
    )
    if not isinstance(body, dict) or not body.get("address"):
        raise CanopyApiError(200, f'Entity "{slug}" has no resolved address', body)
    return str(body["address"])
