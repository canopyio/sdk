#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Canopy } from "@canopy-ai/sdk";

const apiKey = process.env.CANOPY_API_KEY;
const agentId = process.env.CANOPY_AGENT_ID;
const baseUrl = process.env.CANOPY_BASE_URL;

if (!apiKey) {
  console.error("CANOPY_API_KEY environment variable is required");
  process.exit(1);
}
if (!agentId) {
  console.error("CANOPY_AGENT_ID environment variable is required");
  process.exit(1);
}

const canopy = new Canopy({ apiKey, agentId, baseUrl });

const server = new Server(
  { name: "canopy", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "canopy_pay",
      description:
        "Send a USD payment from this org treasury. Subject to the agent's spending policy. " +
        "Returns { status: 'allowed' | 'pending_approval' | 'denied', ... }.",
      inputSchema: {
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
      },
    },
    {
      name: "canopy_preview",
      description:
        "Check whether a payment would be allowed, without actually signing or charging. " +
        "Useful for agents that want to pre-flight a potential payment before committing.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string" },
          amountUsd: { type: "number" },
        },
        required: ["to", "amountUsd"],
      },
    },
    {
      name: "canopy_get_approval_status",
      description:
        "Check the current status of an approval request returned by canopy_pay. " +
        "Returns { status: 'pending' | 'approved' | 'denied' | 'expired', decidedAt, expiresAt, transactionId }.",
      inputSchema: {
        type: "object",
        properties: {
          approvalId: {
            type: "string",
            description: "The approval id returned by canopy_pay when status was 'pending_approval'.",
          },
        },
        required: ["approvalId"],
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
        type: "object",
        properties: {
          approvalId: {
            type: "string",
            description: "The approval id returned by canopy_pay when status was 'pending_approval'.",
          },
          timeoutMs: {
            type: "number",
            description:
              "Optional timeout in milliseconds. Capped at 60000 (60s) to avoid holding the MCP transport.",
          },
        },
        required: ["approvalId"],
      },
    },
    {
      name: "canopy_ping",
      description:
        "Verify the configured Canopy API key + agent are valid. " +
        "Returns details about the agent and org, plus round-trip latency. " +
        "Use this on first turn if you want to confirm the integration is live.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "canopy_get_budget",
      description:
        "Pre-flight cap snapshot. Returns { capUsd, spentUsd, remainingUsd, periodHours, periodResetsAt } " +
        "so the agent can plan ahead — e.g. 'I have $4.30 left this window, defer the expensive call'. " +
        "When no policy is bound, capUsd and remainingUsd are null (no cap).",
      inputSchema: {
        type: "object",
        properties: {},
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
        type: "object",
        properties: {
          approval_id: {
            type: "string",
            description: "The approval id returned by canopy_pay when status was 'pending_approval'.",
          },
        },
        required: ["approval_id"],
      },
    },
    {
      name: "canopy_deny",
      description:
        "Mark a pending payment approval as denied. Call this ONLY when the user explicitly " +
        "denies a transaction in chat (e.g., they replied 'no', 'deny', 'cancel'). The " +
        "approval_id comes from a previous canopy_pay result whose status was 'pending_approval'.",
      inputSchema: {
        type: "object",
        properties: {
          approval_id: {
            type: "string",
            description: "The approval id returned by canopy_pay when status was 'pending_approval'.",
          },
        },
        required: ["approval_id"],
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
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Filter by category slug (e.g. 'data', 'api', 'compute'). Optional.",
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
    },
  ],
}));

const MAX_WAIT_MS = 60_000;

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
    const { approvalId, timeoutMs } = args as { approvalId: string; timeoutMs?: number };
    const bounded = Math.min(timeoutMs ?? MAX_WAIT_MS, MAX_WAIT_MS);
    const result = await canopy.waitForApproval(approvalId, { timeoutMs: bounded });
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
    const typed = (args ?? {}) as { category?: string; query?: string; limit?: number };
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

const transport = new StdioServerTransport();
await server.connect(transport);
