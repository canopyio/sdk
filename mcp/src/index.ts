#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Canopy } from "@canopy-ai/sdk";
import { registerTools } from "./handlers.js";

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

registerTools(server, canopy);

const transport = new StdioServerTransport();
await server.connect(transport);
