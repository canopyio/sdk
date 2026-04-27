# Canopy SDK

[Canopy](https://www.trycanopy.ai) is a treasury wallet for AI agents. You fund a USDC wallet on Base; your agent spends from it, gated by per-agent policies you set in the dashboard (cap, allowlist, approval threshold). No private keys leave the server.

## Pick a package

| Package | Install | Use when |
|---|---|---|
| **[`@canopy-ai/sdk`](./typescript)** | `npm install @canopy-ai/sdk` | TypeScript / Node.js agents |
| **[`canopy-ai`](./python)** | `pip install canopy-ai` | Python agents (LangChain, LangGraph, custom) |
| **[`@canopy-ai/mcp`](./mcp)** | `npx -y @canopy-ai/mcp` | You're using an MCP host (Claude Desktop, Cursor, Cline) and want a payment tool with no code changes |

All three share the same wire format and return shapes — pick whichever matches your stack.

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
  await canopy.waitForApproval(result.approvalId);
} else {
  console.log("denied:", result.reason);
}
```

`pay()` returns one of three outcomes (`allowed` / `pending_approval` / `denied`) — they're return values, not exceptions, so an LLM can read them and decide what to do. HTTP/network failures still throw.

## One-line setup

In the dashboard, click **Install** on any agent to get a one-time code. Then in your project:

```bash
npx @canopy-ai/sdk init <code>
```

That writes `CANOPY_API_KEY` and `CANOPY_AGENT_ID` to `.env.local` and pings to confirm the integration is live. No copy-paste.

## What the SDK gives you

Every SDK exposes the same surface:

| Call | What it does |
|---|---|
| `pay({ to, amountUsd })` | Issue a payment. |
| `preview({ to, amountUsd })` | Dry-run the policy. Nothing signed or persisted. |
| `fetch(url)` | Like `fetch`, but auto-pays HTTP 402 ([x402](https://x402.org)) responses. |
| `ping()` | Health check + the moment the dashboard shows your agent as connected. |
| `budget()` | "How much can I spend right now?" — pre-flight cap snapshot. |
| `waitForApproval(id)` | Block until a pending approval is decided. |
| `getTools({ framework })` | LLM-ready tool definitions. Frameworks: `openai`, `anthropic`, `vercel`, `langchain`. |

The package READMEs ([typescript](./typescript), [python](./python)) have copy-paste recipes for each framework.

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
