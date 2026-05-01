import type { Canopy } from "../client.js";
import type { CanopyTool } from "../types.js";

/**
 * Returns the SDK's canonical tool list:
 *
 *   - `canopy_pay` — issue a USD payment, gated by the agent's policy.
 *   - `canopy_discover_services` — list paid services the agent can call.
 *   - `canopy_approve` / `canopy_deny` — resolve a pending approval in chat.
 *
 * Each tool has the canonical shape `{ name, description, parameters: JSONSchema, execute }`,
 * framework-agnostic. For pre-shaped output use `canopy.openai`,
 * `canopy.anthropic`, `canopy.vercel`, or the `@canopy-ai/sdk/langchain` subpath.
 *
 * Filter the array if you want a subset (e.g. pay-only):
 *   `canopy.getTools().filter(t => t.name === "canopy_pay")`
 */
export function getTools(canopy: Canopy): CanopyTool[] {
  return [
    {
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
              "Recipient on-chain address (`0x…`). For paid-service interactions, use `canopy.fetch(serviceUrl)` instead — `pay()` is for direct transfers.",
          },
          amountUsd: {
            type: "number",
            description: "Amount in US dollars (e.g. 0.05 for 5 cents).",
          },
        },
        required: ["to", "amountUsd"],
        additionalProperties: false,
      },
      execute: (args: { to: string; amountUsd: number }) => canopy.pay(args),
    },
    {
      name: "canopy_discover_services",
      description:
        "List paid services the agent can call. Filter by category (data/api/compute/service/...) " +
        "or a free-text query. Returns services from the agent's policy allowlist by default.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              "Filter by category slug, e.g. `data`, `api`, `compute`, `service`. Optional.",
          },
          query: {
            type: "string",
            description: "Free-text match on service name and description. Optional.",
          },
          limit: {
            type: "number",
            description: "Max results to return. Default 20, capped at 50.",
          },
        },
        additionalProperties: false,
      },
      execute: (args: { category?: string; query?: string; limit?: number }) =>
        canopy.discover({ category: args.category, query: args.query, limit: args.limit }),
    },
    {
      name: "canopy_approve",
      description:
        "Mark a pending payment approval as approved. Call this ONLY when the user explicitly approves a transaction in chat (e.g., they replied 'yes', 'approve', 'go ahead'). The approval_id comes from a previous canopy_pay result whose status was `pending_approval`. Never call this on your own — only when the user gives explicit consent.",
      parameters: {
        type: "object",
        properties: {
          approval_id: {
            type: "string",
            description:
              "The `approvalId` from the `pending_approval` result of a prior `canopy_pay`.",
          },
        },
        required: ["approval_id"],
        additionalProperties: false,
      },
      execute: (args: { approval_id: string }) => canopy.approve(args.approval_id),
    },
    {
      name: "canopy_deny",
      description:
        "Mark a pending payment approval as denied. Call this ONLY when the user explicitly denies a transaction in chat (e.g., they replied 'no', 'deny', 'cancel'). The approval_id comes from a previous canopy_pay result whose status was `pending_approval`.",
      parameters: {
        type: "object",
        properties: {
          approval_id: {
            type: "string",
            description:
              "The `approvalId` from the `pending_approval` result of a prior `canopy_pay`.",
          },
        },
        required: ["approval_id"],
        additionalProperties: false,
      },
      execute: (args: { approval_id: string }) => canopy.deny(args.approval_id),
    },
  ];
}
