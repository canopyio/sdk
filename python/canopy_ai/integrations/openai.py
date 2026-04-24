from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from canopy_ai.client import Canopy


def openai_tools(canopy: "Canopy") -> list[dict[str, Any]]:
    """
    OpenAI function-calling tool definitions for Canopy. Bind them to your LLM
    call with `tools=canopy.get_tools(framework="openai")`.

    Each entry carries an `execute` callable so callers can dispatch tool
    invocations without re-importing Canopy.
    """

    def execute(args: dict[str, Any]) -> Any:
        return canopy.pay(to=args["to"], amount_usd=args["amountUsd"])

    return [
        {
            "type": "function",
            "function": {
                "name": "canopy_pay",
                "description": (
                    "Send a USD payment from this agent's Canopy wallet. "
                    "Subject to the agent's spending policy. "
                    "May return pending_approval if the amount exceeds the approval threshold."
                ),
                "parameters": {
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
                    "additionalProperties": False,
                },
            },
            "execute": execute,
        }
    ]
