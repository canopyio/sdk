import type { Canopy } from "../client.js";

/**
 * OpenAI function-calling tool definitions for Canopy. Bind them to your LLM
 * call with `tools: canopy.getTools({ framework: "openai" })`.
 *
 * The returned shape is the OpenAI Chat Completions / Responses tool format.
 * An `execute` function is also returned so the caller can dispatch tool
 * invocations without re-importing Canopy.
 */
export function openaiTools(canopy: Canopy) {
  return [
    {
      type: "function" as const,
      function: {
        name: "canopy_pay",
        description:
          "Send a USD payment from the org treasury. Subject to this agent's spending policy. " +
          "May return `pending_approval` if the amount exceeds the approval threshold.",
        parameters: {
          type: "object",
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
      },
      execute: async (args: { to: string; amountUsd: number }) => canopy.pay(args),
    },
  ];
}
