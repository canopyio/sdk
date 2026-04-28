# @canopy-ai/mcp

[Canopy](https://www.trycanopy.ai) as an [MCP](https://modelcontextprotocol.io) server. Use it from Claude Agent SDK, Claude Desktop, Cursor, Cline, or Windsurf to give an existing agent policy-gated payment tools.

## What this is for

You're running an agent in Claude Agent SDK or inside a host app (Claude Desktop, Cursor, Cline, Windsurf) and you don't want to write a custom payment tool. MCP is the neutral plug. You add Canopy once, and the agent can discover services, check budget, request payments, and resolve chat-native approvals under the policy you set in Canopy.

This is the **recommended path** for any MCP-aware agent runtime — one install, every host, zero code changes.

## When to use the language SDKs instead

Reach for [`@canopy-ai/sdk`](../typescript) or [`canopy-ai`](../python) when MCP isn't a fit:

- **Backend scripts** that call `canopy.pay()` directly with no LLM in the loop — `pip install canopy-ai` + 3 lines beats spinning up a stdio child process.
- **x402 auto-paying** with `canopy.fetch()` against paywalled APIs from your own code.
- **Raw LLM API loops** — direct `chat.completions.create` / `messages.create` flows where you don't want MCP overhead. The native adapters (`canopy.openai`, `canopy.anthropic`, `canopy.vercel`, plus LangChain / OpenAI Agents SDK subpaths) cover these.
- **Edge / serverless runtimes** where stdio MCP servers are awkward.

The wire format is identical, so you can mix freely — e.g., MCP for the agent's tool surface and the language SDK for `canopy.fetch()` x402 calls in the same project.

## Setup

1. **Create an org** at <https://www.trycanopy.ai>.
2. **Generate an API key**: Dashboard → Settings → API Keys → Create. Copy the `ak_live_…`.
3. **Create an agent**: Dashboard → Agents → Connect agent. Pick an existing policy or create one in the flow, then copy the `agt_…` id.
4. **Add Canopy to Claude Agent SDK or your MCP host config** (below).

You don't install `@canopy-ai/mcp` globally. `npx` fetches it on first run.

## Claude Agent SDK

Claude Agent SDK can launch Canopy as a stdio MCP server from your `query()` options. Claude requires MCP tools to be explicitly allowed; with the server named `canopy`, use `allowedTools: ["mcp__canopy__*"]`.

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find a data feed and pay for BTC orderbook depth.",
  options: {
    mcpServers: {
      canopy: {
        command: "npx",
        args: ["-y", "@canopy-ai/mcp"],
        env: {
          CANOPY_API_KEY: process.env.CANOPY_API_KEY!,
          CANOPY_AGENT_ID: process.env.CANOPY_AGENT_ID!,
        },
      },
    },
    allowedTools: ["mcp__canopy__*"],
  },
})) {
  if (message.type === "result") console.log(message.result);
}
```

To narrow permissions, list individual tools such as `mcp__canopy__canopy_pay` and `mcp__canopy__canopy_get_budget`.

## Host configs

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "canopy": {
      "command": "npx",
      "args": ["-y", "@canopy-ai/mcp"],
      "env": {
        "CANOPY_API_KEY": "ak_live_...",
        "CANOPY_AGENT_ID": "agt_xxxxxxxx"
      }
    }
  }
}
```

Restart Claude Desktop. In any new conversation, the hammer icon (tools) should list the Canopy tools — `canopy_pay`, `canopy_preview`, `canopy_discover_services`, `canopy_approve`, `canopy_deny`, plus the helpers below.

### Cursor

Edit `~/.cursor/mcp.json` (or the workspace-scoped `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "canopy": {
      "command": "npx",
      "args": ["-y", "@canopy-ai/mcp"],
      "env": {
        "CANOPY_API_KEY": "ak_live_...",
        "CANOPY_AGENT_ID": "agt_xxxxxxxx"
      }
    }
  }
}
```

Restart Cursor. Tools appear in the agent sidebar.

### Cline / Windsurf / other MCP hosts

Any MCP host with a `mcpServers` config block will work with the same shape — `command: npx`, `args: ["-y", "@canopy-ai/mcp"]`, the two env vars.

## Available tools

Nine tools covering discovery, the payment lifecycle, and chat-native approvals:

### `canopy_pay`

Send a USD payment from the org treasury. Subject to the org's spending policy.

**Arguments**
```json
{
  "to": "0x1234... or agentic.market/anthropic",
  "amountUsd": 0.10
}
```

**Returns** (as JSON text content)
```json
{
  "status": "allowed",
  "txHash": "0x...",
  "transactionId": "...",
  "costUsd": 0.10
}
```

Other outcomes the LLM needs to reason about:

```json
{ "status": "pending_approval", "approvalId": "...", "reason": "Amount $7.50 exceeds approval threshold of $5" }
{ "status": "denied", "reason": "Spend cap exceeded: $8.00 + $5.00 > $10 / 24h" }
```

### `canopy_preview`

Dry-run the same policy evaluation without signing or charging. Useful when the LLM wants to ask "would this payment go through?" before committing.

Same argument shape as `canopy_pay`. Returns a `PayResult` with `"dryRun": true`.

### `canopy_get_approval_status`

Poll the current state of an approval request. Use this after `canopy_pay` returns `pending_approval` to find out whether the org admin has decided.

**Arguments**
```json
{ "approvalId": "appr_..." }
```

**Returns**
```json
{
  "status": "pending" | "approved" | "denied" | "expired",
  "decidedAt": "2026-04-27T10:32:11Z" | null,
  "expiresAt": "2026-04-27T10:45:00Z",
  "transactionId": "..."
}
```

### `canopy_wait_for_approval`

Block until an approval is decided, or up to 60 seconds. Useful when the user is expected to decide promptly in the dashboard. For longer waits, poll `canopy_get_approval_status`.

**Arguments**
```json
{ "approvalId": "appr_...", "timeoutMs": 30000 }
```

`timeoutMs` is optional and capped at `60000` regardless of caller input — long timeouts would hold the MCP transport. Returns the same shape as `canopy_get_approval_status`.

### `canopy_approve`

Mark a pending approval as approved. The LLM calls this when the user explicitly approves a transaction in chat (e.g. they replied "yes", "approve", "go ahead"). Lets the user say yes naturally without leaving the chat to open the dashboard.

**Arguments**
```json
{ "approval_id": "ar_..." }
```

**Returns**
```json
{
  "decision": "approved",
  "transactionId": "...",
  "txHash": "0x...",
  "signature": "0x..."
}
```

Gated by the agent's policy: if "Allow approval from chat" is off, returns a 403 with `chat_approval_disabled` and the LLM should redirect the user to the dashboard.

### `canopy_deny`

Mark a pending approval as denied. The LLM calls this when the user explicitly declines (e.g. they replied "no", "deny", "cancel"). Same arg / response shape as `canopy_approve` but with `decision: "denied"` and `txHash` / `signature` left null.

### `canopy_ping`

Verify the configured API key + agent are valid. Returns the agent and org details plus round-trip latency. Useful as a first-turn self-check ("am I configured correctly?").

**Arguments**: none.

**Returns**
```json
{
  "ok": true,
  "agent": { "id": "agt_...", "name": "Trader", "status": "active",
             "policyId": "...", "policyName": "trading.default" },
  "org":   { "name": "Acme", "treasuryAddress": "0x..." },
  "latencyMs": 84
}
```

### `canopy_get_budget`

Pre-flight cap snapshot — useful for the LLM to plan ahead ("I have $4.30 left this window, defer the expensive call").

**Arguments**: none.

**Returns**
```json
{
  "agentId": "agt_...",
  "capUsd": 5,
  "spentUsd": 1.25,
  "remainingUsd": 3.75,
  "periodHours": 24,
  "periodResetsAt": "2026-04-28T12:00:00.000Z"
}
```

When no policy is bound to the agent, `capUsd` and `remainingUsd` are `null` (no cap).

### `canopy_discover_services`

List paid services the agent can call. Filter by category (`data`, `api`, `compute`, …) or a free-text query. Pairs with `canopy_pay` (or `canopy.fetch` from your own code): the LLM discovers a service, then pays its `payTo` address or hits its `url`.

**Arguments**
```json
{ "category": "data", "query": "orderbook", "limit": 20 }
```

All optional. With no args, returns the top services the agent's policy permits.

**Returns** — a JSON array of services (one per match):
```json
[
  {
    "slug": "agentic.market/coinglass-orderbook",
    "name": "Coinglass Orderbook Feed",
    "description": "Real-time order book depth.",
    "url": "https://api.coinglass.example/v1/orderbook",
    "category": "data",
    "paymentProtocol": "x402",
    "typicalAmountUsd": 0.01,
    "payTo": "0x...",
    "policyAllowed": true
  }
]
```

If the agent's policy has an allowlist, results are filtered to allowed payees by default.

## How the LLM experiences it

Once the server is loaded, the host exposes all nine tools in its normal tool UI. The LLM decides when to call them; the host runs them; results come back as tool output the LLM reads. A typical prompt flow:

> **You:** find a data feed and pay for BTC orderbook depth.
> **LLM:** *[calls `canopy_discover_services({ category: "data", query: "orderbook" })`]*
> *[tool returns 3 services with URLs and prices]*
> **LLM:** *[picks the cheapest, calls `canopy_pay({ to: "0x...", amountUsd: 0.01 })`]*
> *[tool returns `{ "status": "allowed", "txHash": "0xabc…" }`]*
> **LLM:** Paid Coinglass $0.01 for the feed. Here's the depth: …

If the amount exceeds the approval threshold, the LLM sees `pending_approval` with rich context (`recipientName`, `amountUsd`, `agentName`, `expiresAt`) and asks the user inline:

> **LLM:** I'd like to pay $5 to Alchemy for compute. Reply 'approve' or 'deny'.
> **You:** approve
> **LLM:** *[calls `canopy_approve({ approval_id: "ar_x9" })`]*
> *[tool returns `{ "decision": "approved", "txHash": "0x123…" }`]*
> **LLM:** Approved — sent. tx 0x123… on Base.

To force the dashboard route instead, turn off "Allow approval from chat" on the policy. Then `canopy_approve` returns 403 with `chat_approval_disabled` and the LLM should direct the user to the Canopy dashboard.

## Custom base URL (local dev)

Point the MCP server at a locally-running canopy-app:

```json
{
  "mcpServers": {
    "canopy": {
      "command": "npx",
      "args": ["-y", "@canopy-ai/mcp"],
      "env": {
        "CANOPY_API_KEY": "ak_test_...",
        "CANOPY_AGENT_ID": "agt_...",
        "CANOPY_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

Use a test-mode key (`ak_test_…`) so you don't pollute production data.

## Troubleshooting

**Tools don't appear in the host** — the server probably failed to start. Check the host's MCP log (Claude Desktop: `~/Library/Logs/Claude/mcp-server-canopy.log`). Common causes:

- `CANOPY_API_KEY environment variable is required` — env var not set in the host config.
- `CANOPY_AGENT_ID environment variable is required` — same.
- npm resolution failures — delete the npx cache (`~/.npm/_npx/`) and retry.

**`canopy_pay` returns `denied` with "Privy is not configured"** — the canopy-app server doesn't have `PRIVY_APP_ID` set. Production shouldn't hit this; check with ops if it does.

**`canopy_pay` returns `denied` with "Spend cap exceeded"** — the agent has spent its cap in the current window. Wait it out or raise the cap in the dashboard.

**`canopy_pay` returns `pending_approval`** — three options. (1) Tell the user inline using `recipientName` / `amountUsd` from the result, then call `canopy_approve({ approval_id })` or `canopy_deny({ approval_id })` when they reply (requires "Allow approval from chat" on the policy). (2) Call `canopy_wait_for_approval({ approvalId })` to block up to 60 seconds while the user decides in the dashboard. (3) `canopy_get_approval_status({ approvalId })` to poll on your own cadence.

**`canopy_approve` returns 403 with `chat_approval_disabled`** — the agent's policy has chat-based approval turned off. Direct the user to the dashboard.

## What's under the hood

`@canopy-ai/mcp` is a thin wrapper around [`@canopy-ai/sdk`](../typescript). It's an stdio MCP server (the official `@modelcontextprotocol/sdk`) that exposes `canopy.pay`, `canopy.preview`, `canopy.discover`, `canopy.approve`, `canopy.deny`, `canopy.getApprovalStatus`, `canopy.waitForApproval`, `canopy.ping`, and `canopy.budget` as MCP tools. No custody — the server just proxies to Canopy's API with your key.

## Version

`0.0.1` — alpha.

## License

[MIT](../LICENSE)
