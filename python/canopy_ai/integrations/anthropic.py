from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from canopy_ai.client import Canopy


def anthropic_tools(canopy: "Canopy") -> list[dict[str, Any]]:
    """
    Anthropic Messages API tool definitions for Canopy. Bind them to your
    ``client.messages.create`` call with
    ``tools=canopy.get_tools(framework="anthropic")``.

    Each entry has the ``{name, description, input_schema}`` shape Anthropic
    expects, plus an ``execute`` callable so the caller can dispatch tool_use
    blocks without re-importing Canopy.
    """

    def execute(args: dict[str, Any]) -> Any:
        return canopy.pay(to=args["to"], amount_usd=args["amountUsd"])

    return [
        {
            "name": "canopy_pay",
            "description": (
                "Send a USD payment from the org treasury. "
                "Subject to the agent's spending policy. "
                "May return pending_approval if the amount exceeds the approval threshold."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "to": {
                        "type": "string",
                        "description": (
                            "Recipient: either an `0x…` address, or an entity-registry "
                            "slug like `agentic.market/anthropic`."
                        ),
                    },
                    "amountUsd": {
                        "type": "number",
                        "description": "Amount in US dollars (e.g. 0.05 for 5 cents).",
                    },
                },
                "required": ["to", "amountUsd"],
            },
            "execute": execute,
        }
    ]
