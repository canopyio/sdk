from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from canopy_ai.client import Canopy


def get_tools_for(canopy: "Canopy", framework: str) -> Any:
    if framework == "openai":
        from canopy_ai.integrations.openai import openai_tools

        return openai_tools(canopy)
    if framework == "anthropic":
        from canopy_ai.integrations.anthropic import anthropic_tools

        return anthropic_tools(canopy)
    if framework == "langchain":
        from canopy_ai.integrations.langchain import langchain_tools

        return langchain_tools(canopy)
    if framework == "vercel":
        # Vercel AI SDK is a JS-only framework; no Python parallel.
        raise NotImplementedError(
            'get_tools(framework="vercel") is JavaScript-only. '
            "Use the @canopy-ai/sdk TypeScript package instead."
        )
    raise ValueError(f"Unknown framework: {framework}")
