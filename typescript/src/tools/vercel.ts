import type { Canopy } from "../client.js";

/**
 * Vercel AI SDK tool definitions for Canopy. Bind them to your `generateText`
 * / `streamText` call with `tools: canopy.getTools({ framework: "vercel" })`.
 *
 * Returns a `Record<string, ToolSpec>` matching Vercel AI's `tools` arg shape.
 * Parameters are expressed as JSON Schema — Vercel AI's `tool()` helper is
 * purely a type-narrowing utility, so a plain object is interchangeable. If
 * you prefer Zod, wrap each entry yourself.
 */
export function vercelTools(canopy: Canopy) {
  return {
    canopy_pay: {
      description:
        "Send a USD payment from the org treasury. Subject to this agent's spending policy. " +
        "May return `pending_approval` if the amount exceeds the approval threshold.",
      parameters: {
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
      execute: async (args: { to: string; amountUsd: number }) => canopy.pay(args),
    },
  };
}
