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
        "Send a USD payment from this agent's Canopy wallet. Subject to the agent's spending policy. " +
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs = args as { to: string; amountUsd: number };

  if (name === "canopy_pay") {
    const result = await canopy.pay(typedArgs);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
  if (name === "canopy_preview") {
    const result = await canopy.preview(typedArgs);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
