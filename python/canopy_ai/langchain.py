"""LangChain adapter — wraps Canopy's canonical tools as
``langchain_core.tools.StructuredTool`` instances.

Requires the optional peer dep ``langchain-core`` (>= 0.3). Install with
``pip install canopy-ai[langchain]``.

Pass the result directly to LangChain agents, LangGraph
``create_react_agent``, etc.
"""

from __future__ import annotations

import asyncio
import inspect
import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from canopy_ai.async_client import AsyncCanopy
    from canopy_ai.client import Canopy


def to_langchain_tools(canopy: "Canopy | AsyncCanopy") -> list[Any]:
    """Return ``list[StructuredTool]`` for the four canonical Canopy tools.

    Works with both :class:`Canopy` (sync executors) and
    :class:`AsyncCanopy` (async executors); each tool's ``coroutine`` /
    ``func`` is bound appropriately.
    """
    try:
        from langchain_core.tools import StructuredTool
    except ImportError as err:  # pragma: no cover - optional dep
        raise ImportError(
            "to_langchain_tools requires 'langchain-core'. "
            "Install with: pip install canopy-ai[langchain]"
        ) from err

    out: list[Any] = []
    for spec in canopy.get_tools():
        execute = spec["execute"]
        is_async = inspect.iscoroutinefunction(execute)

        def _make_sync(exec_fn: Any) -> Any:
            def _sync(**kwargs: Any) -> str:
                result = exec_fn(kwargs)
                return json.dumps(result)

            return _sync

        def _make_async(exec_fn: Any) -> Any:
            async def _async(**kwargs: Any) -> str:
                result = exec_fn(kwargs)
                if asyncio.iscoroutine(result):
                    result = await result
                return json.dumps(result)

            return _async

        if is_async:
            tool = StructuredTool.from_function(
                coroutine=_make_async(execute),
                name=spec["name"],
                description=spec["description"],
                args_schema=spec["parameters"],
            )
        else:
            tool = StructuredTool.from_function(
                func=_make_sync(execute),
                name=spec["name"],
                description=spec["description"],
                args_schema=spec["parameters"],
            )
        out.append(tool)
    return out
