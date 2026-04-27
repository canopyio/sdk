import type { Canopy } from "../client.js";

/**
 * LangChain tool spec for Canopy. Pass each entry to
 * `new DynamicStructuredTool(spec)` from `@langchain/core/tools`:
 *
 * ```ts
 * import { DynamicStructuredTool } from "@langchain/core/tools";
 * const [spec] = canopy.getTools({ framework: "langchain" });
 * const tool = new DynamicStructuredTool(spec);
 * ```
 *
 * The `schema` field is a JSON Schema, which `DynamicStructuredTool` accepts
 * directly (no Zod required). The `func` returns the same `PayResult` shape as
 * `canopy.pay()`; LangChain will JSON-stringify it for the model.
 */
export function langchainTools(canopy: Canopy) {
  return [
    {
      name: "canopy_pay",
      description:
        "Send a USD payment from the org treasury. Subject to this agent's spending policy. " +
        "May return `pending_approval` if the amount exceeds the approval threshold.",
      schema: {
        type: "object" as const,
        properties: {
          to: {
            type: "string",
            description:
              "Recipient: either an `0x…` address, or an entity-registry slug like `agentic.market/anthropic`.",
          },
          amountUsd: {
            type: "number",
            description: "Amount in US dollars (e.g. 0.05 for 5 cents).",
          },
        },
        required: ["to", "amountUsd"],
        additionalProperties: false,
      },
      func: async (args: { to: string; amountUsd: number }) => {
        const result = await canopy.pay(args);
        return JSON.stringify(result);
      },
    },
  ];
}
