import type { Canopy } from "../client.js";
import type { ToolFramework } from "../types.js";
import { openaiTools } from "./openai.js";

export function getToolsFor(canopy: Canopy, framework: ToolFramework) {
  switch (framework) {
    case "openai":
      return openaiTools(canopy);
    case "anthropic":
    case "vercel":
    case "langchain":
      throw new Error(
        `getTools({ framework: "${framework}" }) is not implemented yet. Day-1 support is OpenAI only.`,
      );
  }
}
