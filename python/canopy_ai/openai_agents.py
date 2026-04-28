"""OpenAI Agents SDK adapter — wraps Canopy's canonical tools as
``agents.FunctionTool`` instances.

Requires the optional peer dep ``openai-agents``. Install with
``pip install canopy-ai[openai-agents]``.

Pass the result directly to ``agents.Agent(tools=...)``.
"""

from __future__ import annotations

import asyncio
import inspect
import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from canopy_ai.async_client import AsyncCanopy
    from canopy_ai.client import Canopy


def to_openai_agents_tools(canopy: "Canopy | AsyncCanopy") -> list[Any]:
    """Return ``list[FunctionTool]`` for the four canonical Canopy tools.

    The ``on_invoke_tool`` is async and awaits Canopy's ``execute`` whether
    the underlying client is sync or async.
    """
    try:
        from agents import FunctionTool
    except ImportError as err:  # pragma: no cover - optional dep
        raise ImportError(
            "to_openai_agents_tools requires 'openai-agents'. "
            "Install with: pip install canopy-ai[openai-agents]"
        ) from err

    out: list[Any] = []
    for spec in canopy.get_tools():
        execute = spec["execute"]

        def _make_invoker(exec_fn: Any) -> Any:
            async def on_invoke(_run_ctx: Any, args_json: str) -> str:
                args = json.loads(args_json) if args_json else {}
                result = exec_fn(args)
                if inspect.isawaitable(result) or asyncio.iscoroutine(result):
                    result = await result
                return json.dumps(result)

            return on_invoke

        out.append(
            FunctionTool(
                name=spec["name"],
                description=spec["description"],
                params_json_schema=spec["parameters"],
                on_invoke_tool=_make_invoker(execute),
            )
        )
    return out
