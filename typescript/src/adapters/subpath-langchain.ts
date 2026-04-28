import { DynamicStructuredTool } from "@langchain/core/tools";
import type { Canopy } from "../client.js";

/**
 * Wrap Canopy's canonical tools as LangChain `DynamicStructuredTool`
 * instances. Pass directly to LangChain agents, LangGraph
 * `create_react_agent`, etc.
 *
 * Requires the optional peer dep `@langchain/core` (>= 0.3).
 */
export function toLangChainTools(canopy: Canopy): DynamicStructuredTool[] {
  return canopy.getTools().map(
    (t) =>
      new DynamicStructuredTool({
        name: t.name,
        description: t.description,
        schema: t.parameters,
        func: async (args: Record<string, unknown>) => {
          const result = await t.execute(args);
          return JSON.stringify(result ?? null);
        },
      }),
  );
}
