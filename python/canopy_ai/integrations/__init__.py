"""Canonical tool list returned by `canopy.get_tools()`.

The shape is `{name, description, parameters: JSONSchema, execute}`. Works
directly with LangChain `StructuredTool.from_function`, MCP, and most modern
frameworks. For OpenAI / Anthropic, see the README for the one-line wrap recipe.
"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from canopy_ai.async_client import AsyncCanopy
    from canopy_ai.client import Canopy
    from canopy_ai.types import CanopyTool


_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "canopy_pay",
        "description": (
            "Send a USD payment from the org treasury. "
            "Subject to the agent's spending policy. "
            "May return pending_approval if the amount exceeds the approval threshold."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "to": {
                    "type": "string",
                    "description": (
                        "Recipient on-chain address (`0x…`). For paid-service "
                        "interactions, use `canopy.fetch(service_url)` instead — "
                        "`pay()` is for direct transfers."
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
    {
        "name": "canopy_discover_services",
        "description": (
            "List paid services the agent can call. Filter by category "
            "(data/api/compute/service/...) or a free-text query. Returns "
            "services from the agent's policy allowlist by default."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": (
                        "Filter by category slug, e.g. `data`, `api`, `compute`, `service`. Optional."
                    ),
                },
                "query": {
                    "type": "string",
                    "description": "Free-text match on service name and description. Optional.",
                },
                "limit": {
                    "type": "number",
                    "description": "Max results to return. Default 20, capped at 50.",
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "canopy_approve",
        "description": (
            "Mark a pending payment approval as approved. Call this ONLY "
            "when the user explicitly approves a transaction in chat (e.g. "
            "they replied 'yes', 'approve', 'go ahead'). The approval_id "
            "comes from a previous canopy_pay result whose status was "
            "pending_approval. Never call this on your own — only when "
            "the user gives explicit consent."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "approval_id": {
                    "type": "string",
                    "description": (
                        "The approval_id from the pending_approval result of a prior canopy_pay."
                    ),
                },
            },
            "required": ["approval_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "canopy_deny",
        "description": (
            "Mark a pending payment approval as denied. Call this ONLY "
            "when the user explicitly denies a transaction in chat (e.g. "
            "they replied 'no', 'deny', 'cancel'). The approval_id comes "
            "from a previous canopy_pay result whose status was pending_approval."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "approval_id": {
                    "type": "string",
                    "description": (
                        "The approval_id from the pending_approval result of a prior canopy_pay."
                    ),
                },
            },
            "required": ["approval_id"],
            "additionalProperties": False,
        },
    },
]


def get_tools(canopy: "Canopy") -> list["CanopyTool"]:
    executors: dict[str, Any] = {
        "canopy_pay": _make_pay_executor(canopy),
        "canopy_discover_services": _make_discover_executor(canopy),
        "canopy_approve": _make_decide_executor(canopy, "approve"),
        "canopy_deny": _make_decide_executor(canopy, "deny"),
    }
    return _build_tool_list(executors)


def get_async_tools(canopy: "AsyncCanopy") -> list["CanopyTool"]:
    executors: dict[str, Any] = {
        "canopy_pay": _make_async_pay_executor(canopy),
        "canopy_discover_services": _make_async_discover_executor(canopy),
        "canopy_approve": _make_async_decide_executor(canopy, "approve"),
        "canopy_deny": _make_async_decide_executor(canopy, "deny"),
    }
    return _build_tool_list(executors)


def _build_tool_list(executors: dict[str, Any]) -> list["CanopyTool"]:
    return [
        {
            "name": schema["name"],
            "description": schema["description"],
            "parameters": schema["parameters"],
            "execute": executors[schema["name"]],
        }
        for schema in _TOOL_SCHEMAS
    ]


def _make_pay_executor(canopy: "Canopy") -> Any:
    def execute(args: dict[str, Any]) -> Any:
        return canopy.pay(to=args["to"], amount_usd=args["amountUsd"])

    return execute


def _make_discover_executor(canopy: "Canopy") -> Any:
    def execute(args: dict[str, Any]) -> Any:
        kwargs: dict[str, Any] = {}
        if "category" in args:
            kwargs["category"] = args["category"]
        if "query" in args:
            kwargs["query"] = args["query"]
        if "limit" in args:
            kwargs["limit"] = args["limit"]
        return canopy.discover(**kwargs)

    return execute


def _make_decide_executor(canopy: "Canopy", kind: str) -> Any:
    def execute(args: dict[str, Any]) -> Any:
        approval_id = args["approval_id"]
        return canopy.approve(approval_id) if kind == "approve" else canopy.deny(approval_id)

    return execute


def _make_async_pay_executor(canopy: "AsyncCanopy") -> Any:
    async def execute(args: dict[str, Any]) -> Any:
        return await canopy.pay(to=args["to"], amount_usd=args["amountUsd"])

    return execute


def _make_async_discover_executor(canopy: "AsyncCanopy") -> Any:
    async def execute(args: dict[str, Any]) -> Any:
        kwargs: dict[str, Any] = {}
        if "category" in args:
            kwargs["category"] = args["category"]
        if "query" in args:
            kwargs["query"] = args["query"]
        if "limit" in args:
            kwargs["limit"] = args["limit"]
        return await canopy.discover(**kwargs)

    return execute


def _make_async_decide_executor(canopy: "AsyncCanopy", kind: str) -> Any:
    async def execute(args: dict[str, Any]) -> Any:
        approval_id = args["approval_id"]
        return (
            await canopy.approve(approval_id)
            if kind == "approve"
            else await canopy.deny(approval_id)
        )

    return execute
