from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from canopy_ai.client import Canopy


def get_tools_for(canopy: "Canopy", framework: str) -> Any:
    if framework == "openai":
        from canopy_ai.integrations.openai import openai_tools

        return openai_tools(canopy)
    if framework in ("anthropic", "vercel", "langchain"):
        raise NotImplementedError(
            f'get_tools(framework="{framework}") is not implemented yet. '
            "Day-1 support is OpenAI only."
        )
    raise ValueError(f"Unknown framework: {framework}")
