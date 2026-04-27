import type { Canopy } from "../client.js";
import type { ToolFramework } from "../types.js";
import { anthropicTools } from "./anthropic.js";
import { langchainTools } from "./langchain.js";
import { openaiTools } from "./openai.js";
import { vercelTools } from "./vercel.js";

export function getToolsFor(canopy: Canopy, framework: ToolFramework) {
  switch (framework) {
    case "openai":
      return openaiTools(canopy);
    case "anthropic":
      return anthropicTools(canopy);
    case "vercel":
      return vercelTools(canopy);
    case "langchain":
      return langchainTools(canopy);
  }
}
