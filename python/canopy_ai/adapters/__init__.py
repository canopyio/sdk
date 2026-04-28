"""Framework-shape adapters for Canopy.

Each adapter exposes ``tools()`` (and where useful ``dispatch()``) sized to
the target framework. Sync versions are bound to ``Canopy``; async versions
to :class:`canopy_ai.AsyncCanopy`.
"""

from canopy_ai.adapters.anthropic import (
    AnthropicAdapter,
    AsyncAnthropicAdapter,
)
from canopy_ai.adapters.openai import AsyncOpenAIAdapter, OpenAIAdapter
from canopy_ai.adapters.vercel import AsyncVercelAdapter, VercelAdapter

__all__ = [
    "OpenAIAdapter",
    "AsyncOpenAIAdapter",
    "AnthropicAdapter",
    "AsyncAnthropicAdapter",
    "VercelAdapter",
    "AsyncVercelAdapter",
]
