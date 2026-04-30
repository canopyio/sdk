import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Canopy } from "@canopy-ai/sdk";

const MAX_WAIT_MS = 60_000;

const TOOLS = [
  {
    name: "canopy_pay",
    description:
      "Send a USD payment from this org treasury. Subject to the agent's spending policy. " +
      "Returns { status: 'allowed' | 'pending_approval' | 'denied', ... }.",
    inputSchema: {
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
    },
    annotations: {
      title: "Send a payment",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "canopy_preview",
    description:
      "Check whether a payment would be allowed, without actually signing or charging. " +
      "Useful for agents that want to pre-flight a potential payment before committing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: { type: "string" },
        amountUsd: { type: "number" },
      },
      required: ["to", "amountUsd"],
    },
    annotations: {
      title: "Preview a payment (no charge)",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "canopy_get_approval_status",
    description:
      "Check the current status of an approval request returned by canopy_pay. " +
      "Returns { status: 'pending' | 'approved' | 'denied' | 'expired', decidedAt, expiresAt, transactionId }.",
    inputSchema: {
      type: "object" as const,
      properties: {
        approvalId: {
          type: "string",
          description:
            "The approval id returned by canopy_pay when status was 'pending_approval'.",
        },
      },
      required: ["approvalId"],
    },
    annotations: {
      title: "Get approval status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "canopy_wait_for_approval",
    description:
      "Block until an approval request is decided, or up to 60 seconds. " +
      "Use this when an agent has just received a 'pending_approval' result and the user is " +
      "expected to approve or deny in the dashboard within the next minute. For longer waits, " +
      "poll canopy_get_approval_status instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        approvalId: {
          type: "string",
          description:
            "The approval id returned by canopy_pay when status was 'pending_approval'.",
        },
        timeoutMs: {
          type: "number",
          description:
            "Optional timeout in milliseconds. Capped at 60000 (60s) to avoid holding the MCP transport.",
        },
      },
      required: ["approvalId"],
    },
    annotations: {
      title: "Wait for approval (blocks)",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "canopy_ping",
    description:
      "Verify the configured Canopy API key + agent are valid. " +
      "Returns details about the agent and org, plus round-trip latency. " +
      "Use this on first turn if you want to confirm the integration is live.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    annotations: {
      title: "Ping Canopy",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "canopy_get_budget",
    description:
      "Pre-flight cap snapshot. Returns { capUsd, spentUsd, remainingUsd, periodHours, periodResetsAt } " +
      "so the agent can plan ahead — e.g. 'I have $4.30 left this window, defer the expensive call'. " +
      "When no policy is bound, capUsd and remainingUsd are null (no cap).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    annotations: {
      title: "Get budget snapshot",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "canopy_approve",
    description:
      "Mark a pending payment approval as approved. Call this ONLY when the user explicitly " +
      "approves a transaction in chat (e.g., they replied 'yes', 'approve', 'go ahead'). The " +
      "approval_id comes from a previous canopy_pay result whose status was 'pending_approval'. " +
      "Never call this on your own — only when the user gives explicit consent. Returns 403 " +
      "with chat_approval_disabled if the agent's policy disallows chat approval; in that " +
      "case, direct the user to the dashboard.",
    inputSchema: {
      type: "object" as const,
      properties: {
        approval_id: {
          type: "string",
          description:
            "The approval id returned by canopy_pay when status was 'pending_approval'.",
        },
      },
      required: ["approval_id"],
    },
    annotations: {
      title: "Approve a pending payment",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "canopy_deny",
    description:
      "Mark a pending payment approval as denied. Call this ONLY when the user explicitly " +
      "denies a transaction in chat (e.g., they replied 'no', 'deny', 'cancel'). The " +
      "approval_id comes from a previous canopy_pay result whose status was 'pending_approval'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        approval_id: {
          type: "string",
          description:
            "The approval id returned by canopy_pay when status was 'pending_approval'.",
        },
      },
      required: ["approval_id"],
    },
    annotations: {
      title: "Deny a pending payment",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "canopy_discover_services",
    description:
      "List paid services the agent can call (x402 by default). Filter by category " +
      "(data/api/compute/service/...) or a free-text query. Returns services from the " +
      "agent's policy allowlist by default. Each result has a `url` you can hand to " +
      "canopy.fetch(); the resulting 402 will auto-pay.",
    inputSchema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description:
            "Filter by category slug (e.g. 'data', 'api', 'compute'). Optional.",
        },
        query: {
          type: "string",
          description: "Free-text match on service name + description. Optional.",
        },
        limit: {
          type: "number",
          description: "Max results to return. Default 20, capped at 50.",
        },
      },
    },
    annotations: {
      title: "Discover paid services",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
];

/**
 * Registers Canopy's 9 tools on an MCP `Server` and binds their handlers to a
 * `Canopy` SDK instance. Transport-agnostic — the caller decides whether to
 * `connect` the resulting server to stdio (`StdioServerTransport`) or remote
 * Streamable HTTP (`StreamableHTTPServerTransport`).
 */
export function registerTools(server: Server, canopy: Canopy): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "canopy_pay") {
      const typed = args as { to: string; amountUsd: number };
      const result = await canopy.pay(typed);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "canopy_preview") {
      const typed = args as { to: string; amountUsd: number };
      const result = await canopy.preview(typed);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "canopy_get_approval_status") {
      const { approvalId } = args as { approvalId: string };
      const result = await canopy.getApprovalStatus(approvalId);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "canopy_wait_for_approval") {
      const { approvalId, timeoutMs } = args as {
        approvalId: string;
        timeoutMs?: number;
      };
      const bounded = Math.min(timeoutMs ?? MAX_WAIT_MS, MAX_WAIT_MS);
      const result = await canopy.waitForApproval(approvalId, {
        timeoutMs: bounded,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "canopy_ping") {
      const result = await canopy.ping();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "canopy_get_budget") {
      const result = await canopy.budget();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "canopy_discover_services") {
      const typed = (args ?? {}) as {
        category?: string;
        query?: string;
        limit?: number;
      };
      const result = await canopy.discover(typed);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "canopy_approve") {
      const { approval_id } = args as { approval_id: string };
      const result = await canopy.approve(approval_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    if (name === "canopy_deny") {
      const { approval_id } = args as { approval_id: string };
      const result = await canopy.deny(approval_id);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  });
}

export const TOOL_NAMES = TOOLS.map((t) => t.name);
