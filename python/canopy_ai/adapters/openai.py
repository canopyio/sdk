"""OpenAI Chat Completions / Responses adapter.

Returns plain ``dict``s — no ``openai`` package import. The shapes match what
the OpenAI SDK accepts (``tools=[{type, function}]``) and produces
(``tool_calls=[{id, function: {name, arguments}}]``).
"""

from __future__ import annotations

import inspect
import json
from typing import TYPE_CHECKING, Any, Awaitable, Iterable

if TYPE_CHECKING:
    from canopy_ai.async_client import AsyncCanopy
    from canopy_ai.client import Canopy


def _tools_for(canopy: Canopy | AsyncCanopy) -> list[dict[str, Any]]:
    # AsyncCanopy.get_tools() returns the same schema list as Canopy; only
    # the bound `execute` differs (sync vs. async). We strip `execute` here.
    raw = canopy.get_tools()
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            },
        }
        for t in raw
    ]


def _executors_by_name(canopy: Canopy | AsyncCanopy) -> dict[str, Any]:
    return {t["name"]: t["execute"] for t in canopy.get_tools()}


def _parse_args(raw: Any) -> dict[str, Any]:
    if raw is None or raw == "":
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _embed_error(err: Exception) -> str:
    return json.dumps({"error": str(err)})


class OpenAIAdapter:
    """Sync OpenAI adapter for :class:`canopy_ai.Canopy`."""

    def __init__(self, canopy: "Canopy") -> None:
        self._canopy = canopy

    def tools(self) -> list[dict[str, Any]]:
        """Canopy tools shaped for ``chat.completions.create(tools=...)``."""
        return _tools_for(self._canopy)

    def dispatch(
        self, tool_calls: Iterable[Any] | None
    ) -> list[dict[str, Any]]:
        """Execute every Canopy ``tool_call`` and return ``tool``-role messages.

        Tool calls naming non-Canopy tools are skipped (the host loop owns
        those). Errors thrown by Canopy methods become ``{"error": ...}``
        JSON in the tool message so the LLM can react instead of crashing.
        """
        if not tool_calls:
            return []
        executors = _executors_by_name(self._canopy)
        out: list[dict[str, Any]] = []
        for call in tool_calls:
            call_id, name, raw_args = _read_tool_call(call)
            execute = executors.get(name)
            if execute is None:
                continue
            try:
                result = execute(_parse_args(raw_args))
                content = json.dumps(_jsonable(result))
            except Exception as err:  # noqa: BLE001
                content = _embed_error(err)
            out.append(
                {"role": "tool", "tool_call_id": call_id, "content": content}
            )
        return out


class AsyncOpenAIAdapter:
    """Async OpenAI adapter for :class:`canopy_ai.AsyncCanopy`."""

    def __init__(self, canopy: "AsyncCanopy") -> None:
        self._canopy = canopy

    def tools(self) -> list[dict[str, Any]]:
        return _tools_for(self._canopy)

    async def dispatch(
        self, tool_calls: Iterable[Any] | None
    ) -> list[dict[str, Any]]:
        if not tool_calls:
            return []
        executors = _executors_by_name(self._canopy)
        out: list[dict[str, Any]] = []
        for call in tool_calls:
            call_id, name, raw_args = _read_tool_call(call)
            execute = executors.get(name)
            if execute is None:
                continue
            try:
                result = execute(_parse_args(raw_args))
                if inspect.isawaitable(result):
                    result = await result
                content = json.dumps(_jsonable(result))
            except Exception as err:  # noqa: BLE001
                content = _embed_error(err)
            out.append(
                {"role": "tool", "tool_call_id": call_id, "content": content}
            )
        return out


def _read_tool_call(call: Any) -> tuple[str, str, Any]:
    """Pull (id, name, arguments) from either the OpenAI SDK object form or
    a plain dict — users may hand us either depending on their setup."""
    # SDK object form: call.id, call.function.name, call.function.arguments
    call_id = getattr(call, "id", None)
    fn = getattr(call, "function", None)
    if call_id is not None and fn is not None:
        return (
            str(call_id),
            str(getattr(fn, "name", "")),
            getattr(fn, "arguments", None),
        )
    # Dict form
    if isinstance(call, dict):
        fn_dict = call.get("function") or {}
        return (
            str(call.get("id", "")),
            str(fn_dict.get("name", "")),
            fn_dict.get("arguments"),
        )
    return ("", "", None)


def _jsonable(value: Any) -> Any:
    if value is None:
        return None
    return value
