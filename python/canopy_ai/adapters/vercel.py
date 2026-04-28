"""Vercel AI SDK adapter.

The Vercel AI SDK is JavaScript-only, but Python projects sometimes proxy
through it (e.g., LangChain calling a TS-side runtime). For symmetry with
the TS SDK we expose the same shape — ``Record<name, {description,
parameters, execute}>`` — but Python users on a pure-Python stack will
typically prefer the LangChain or OpenAI Agents adapters.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from canopy_ai.async_client import AsyncCanopy
    from canopy_ai.client import Canopy


def _build(canopy: Canopy | AsyncCanopy) -> dict[str, dict[str, Any]]:
    return {
        t["name"]: {
            "description": t["description"],
            "parameters": t["parameters"],
            "execute": t["execute"],
        }
        for t in canopy.get_tools()
    }


class VercelAdapter:
    def __init__(self, canopy: "Canopy") -> None:
        self._canopy = canopy

    def tools(self) -> dict[str, dict[str, Any]]:
        return _build(self._canopy)


class AsyncVercelAdapter:
    def __init__(self, canopy: "AsyncCanopy") -> None:
        self._canopy = canopy

    def tools(self) -> dict[str, dict[str, Any]]:
        return _build(self._canopy)
