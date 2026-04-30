# Canopy SDK

[Canopy](https://trycanopy.ai) is a treasury wallet for AI agents. You fund a USDC wallet on Base; your agent spends from it, gated by per-agent policies you set in the dashboard (cap, allowlist, approval threshold). No private keys leave the server.

## Pick a package

| Package | Install | Use when |
|---|---|---|
| **[`@canopy-ai/mcp`](./mcp)** | `npx -y @canopy-ai/mcp` | **Default for any MCP-aware agent** — Claude Agent SDK, Claude Desktop, Cursor, Cline, Windsurf. One install, all four canonical Canopy tools, zero code changes. |
| **[`@canopy-ai/sdk`](./typescript)** | `npm install @canopy-ai/sdk` | TypeScript / Node.js agents that call `canopy.pay()` directly, auto-pay x402 endpoints via `canopy.fetch()`, or wire raw OpenAI / Anthropic / Vercel / LangChain flows where MCP isn't a fit. |
| **[`canopy-ai`](./python)** | `pip install canopy-ai` | Python agents in the same situations — pure-API use, x402 paywalled APIs, raw `chat.completions.create` / `messages.create`, LangChain / LangGraph / OpenAI Agents SDK. |

All three share the same wire format and return shapes. Start with `@canopy-ai/mcp` if your runtime supports MCP — it covers the broadest set of agent hosts with the smallest install footprint. Fall back to the language SDKs for cases MCP doesn't reach.

## 30-second example

```ts
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});

const result = await canopy.pay({
  to: "agentic.market/anthropic",
  amountUsd: 0.10,
});

if (result.status === "allowed") {
  console.log("paid:", result.txHash);
} else if (result.status === "pending_approval") {
  // Three options (see the per-language READMEs):
  //   1. ask the user in chat (using result.recipientName / result.amountUsd)
  //      and call canopy.approve(result.approvalId) / .deny(...) when they reply
  //   2. canopy.waitForApproval(result.approvalId) — block-poll the dashboard
  //   3. let it ride — the dashboard handles it
  console.log(`pending: $${result.amountUsd} to ${result.recipientName}`);
} else {
  console.log("denied:", result.reason);
}
```

`pay()` returns one of three outcomes (`allowed` / `pending_approval` / `denied`) — they're return values, not exceptions, so an LLM can read them and decide what to do. HTTP/network failures still throw.

## Setup

Grab `CANOPY_API_KEY` from the dashboard's Settings page and the agent's `CANOPY_AGENT_ID` from its agent page. Drop both into your project's env:

```bash
CANOPY_API_KEY=ak_live_xxxxxxxxxxxxxxxx
CANOPY_AGENT_ID=agt_xxxxxxxx
```

## What the SDK gives you

Every SDK exposes the same surface:

| Call | What it does |
|---|---|
| `pay({ to, amountUsd })` | Issue a payment. |
| `preview({ to, amountUsd })` | Dry-run the policy. Nothing signed or persisted. |
| `fetch(url, init?, opts?)` | Like `fetch`, but auto-pays HTTP 402 ([x402](https://x402.org)) responses. Pass `{ waitForApproval: true }` to block on pending approvals. |
| `discover({ category, query })` | Find x402 services the agent can call. Filtered by the agent's policy by default. |
| `approve(id)` / `deny(id)` | Mark a pending approval decided. Call when the user says "yes" / "no" in chat. Gated by the policy's `chat_approval_enabled` flag. |
| `waitForApproval(id)` | Block until a pending approval is decided (poll-based). |
| `ping()` | Health check + the moment the dashboard shows your agent as connected. |
| `budget()` | "How much can I spend right now?" — pre-flight cap snapshot. |
| `getTools()` | Canonical tool list (`canopy_pay`, `canopy_discover_services`, `canopy_approve`, `canopy_deny`) for any agent framework. |
| `canopy.openai.tools()` / `.dispatch()` | Tools + dispatch loop pre-shaped for OpenAI Chat Completions / Responses. |
| `canopy.anthropic.tools()` / `.dispatch()` | Same, for Anthropic Messages. |
| `canopy.vercel.tools()` | Vercel AI SDK shape — passes through directly to `generateText`. |

For LangChain (`@canopy-ai/sdk/langchain` / `canopy_ai.langchain`) and OpenAI Agents SDK (`canopy_ai.openai_agents`) we ship subpath imports with optional peer deps so you only pay for what you use. For Claude Agent SDK, use the Canopy MCP server with `allowedTools: ["mcp__canopy__*"]`. The package READMEs ([typescript](./typescript), [python](./python), [mcp](./mcp)) have copy-paste recipes for each framework.

## Repo layout

```
sdk/
├── typescript/         @canopy-ai/sdk
├── python/             canopy-ai
├── mcp/                @canopy-ai/mcp (stdio MCP server)
└── shared/
    ├── openapi.yaml    HTTP contract
    └── fixtures/       JSON fixtures replayed by both SDKs in CI
```

The shared fixtures keep both languages locked to the same wire format — any drift fails CI.

## License

[MIT](./LICENSE)
