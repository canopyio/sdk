"""Anthropic Messages adapter.

Returns plain ``dict``s; no ``anthropic`` package import. ``tools()`` matches
``messages.create(tools=...)`` shape; ``dispatch()`` consumes assistant
content blocks and returns ``tool_result`` blocks the caller wraps in a user
message.
"""

from __future__ import annotations

import inspect
import json
from typing import TYPE_CHECKING, Any, Iterable

if TYPE_CHECKING:
    from canopy_ai.async_client import AsyncCanopy
    from canopy_ai.client import Canopy


def _tools_for(canopy: Canopy | AsyncCanopy) -> list[dict[str, Any]]:
    raw = canopy.get_tools()
    return [
        {
            "name": t["name"],
            "description": t["description"],
            "input_schema": t["parameters"],
        }
        for t in raw
    ]


def _executors_by_name(canopy: Canopy | AsyncCanopy) -> dict[str, Any]:
    return {t["name"]: t["execute"] for t in canopy.get_tools()}


def _read_block(block: Any) -> tuple[str, str, dict[str, Any]] | None:
    btype = getattr(block, "type", None) or (
        block.get("type") if isinstance(block, dict) else None
    )
    if btype != "tool_use":
        return None
    block_id = getattr(block, "id", None) or (
        block.get("id") if isinstance(block, dict) else None
    )
    name = getattr(block, "name", None) or (
        block.get("name") if isinstance(block, dict) else None
    )
    raw_input = getattr(block, "input", None)
    if raw_input is None and isinstance(block, dict):
        raw_input = block.get("input")
    if not block_id or not name:
        return None
    if not isinstance(raw_input, dict):
        raw_input = {}
    return (str(block_id), str(name), raw_input)


def _embed_error(err: Exception) -> str:
    return json.dumps({"error": str(err)})


class AnthropicAdapter:
    """Sync Anthropic adapter for :class:`canopy_ai.Canopy`."""

    def __init__(self, canopy: "Canopy") -> None:
        self._canopy = canopy

    def tools(self) -> list[dict[str, Any]]:
        """Canopy tools shaped for ``messages.create(tools=...)``."""
        return _tools_for(self._canopy)

    def dispatch(self, content: Iterable[Any] | None) -> list[dict[str, Any]]:
        """Execute every ``tool_use`` block and return ``tool_result`` blocks.

        Wrap the returned list in ``{"role": "user", "content": <blocks>}``
        and append for the next ``messages.create()`` turn.
        """
        if not content:
            return []
        executors = _executors_by_name(self._canopy)
        out: list[dict[str, Any]] = []
        for block in content:
            parsed = _read_block(block)
            if parsed is None:
                continue
            tu_id, name, args = parsed
            execute = executors.get(name)
            if execute is None:
                continue
            try:
                result = execute(args)
                result_content = json.dumps(result)
            except Exception as err:  # noqa: BLE001
                result_content = _embed_error(err)
            out.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tu_id,
                    "content": result_content,
                }
            )
        return out


class AsyncAnthropicAdapter:
    """Async Anthropic adapter for :class:`canopy_ai.AsyncCanopy`."""

    def __init__(self, canopy: "AsyncCanopy") -> None:
        self._canopy = canopy

    def tools(self) -> list[dict[str, Any]]:
        return _tools_for(self._canopy)

    async def dispatch(
        self, content: Iterable[Any] | None
    ) -> list[dict[str, Any]]:
        if not content:
            return []
        executors = _executors_by_name(self._canopy)
        out: list[dict[str, Any]] = []
        for block in content:
            parsed = _read_block(block)
            if parsed is None:
                continue
            tu_id, name, args = parsed
            execute = executors.get(name)
            if execute is None:
                continue
            try:
                result = execute(args)
                if inspect.isawaitable(result):
                    result = await result
                result_content = json.dumps(result)
            except Exception as err:  # noqa: BLE001
                result_content = _embed_error(err)
            out.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tu_id,
                    "content": result_content,
                }
            )
        return out
