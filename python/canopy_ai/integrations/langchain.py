import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from canopy_ai.client import Canopy


def langchain_tools(canopy: "Canopy") -> list[dict[str, Any]]:
    """
    LangChain tool spec for Canopy. Pass each entry to
    ``StructuredTool.from_function`` (or wrap in a ``DynamicStructuredTool``)::

        from langchain_core.tools import StructuredTool

        spec = canopy.get_tools(framework="langchain")[0]
        tool = StructuredTool.from_function(
            func=spec["func"],
            name=spec["name"],
            description=spec["description"],
            args_schema=spec["schema"],
        )

    The ``schema`` field is a JSON Schema dict, which LangChain accepts
    directly (no Pydantic required). The ``func`` returns a JSON string of
    the PayResult so LangChain can hand it to the model verbatim.
    """

    def func(args: dict[str, Any]) -> str:
        result = canopy.pay(to=args["to"], amount_usd=args["amountUsd"])
        return json.dumps(result)

    return [
        {
            "name": "canopy_pay",
            "description": (
                "Send a USD payment from the org treasury. "
                "Subject to the agent's spending policy. "
                "May return pending_approval if the amount exceeds the approval threshold."
            ),
            "schema": {
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
            "func": func,
        }
    ]
