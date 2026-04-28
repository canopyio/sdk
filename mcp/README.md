# @canopy-ai/mcp

[Canopy](https://www.trycanopy.ai) as an [MCP](https://modelcontextprotocol.io) server. Drop it into Claude Desktop, Cursor, or Cline and whichever agent runs in that host gets a policy-gated `canopy_pay` tool — no code changes required.

## What this is for

You're running an agent inside a host app (Claude Desktop, Cursor, Cline, Windsurf) and you don't want to modify its source to add payment capability. MCP is the neutral plug. You add Canopy once to the host's config, every conversation in that host can now pay.

## Setup

1. **Create an org** at <https://www.trycanopy.ai>.
2. **Generate an API key**: Dashboard → Settings → API Keys → Create. Copy the `ak_live_…`.
3. **Create an agent**: Dashboard → Agents → Add Agent. Copy the `agt_…` id.
4. **Add Canopy to your MCP host config** (below).

You don't install `@canopy-ai/mcp` globally. `npx` fetches it on first run.

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

Restart Claude Desktop. In any new conversation, the hammer icon (tools) should list `canopy_pay` and `canopy_preview`.

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

Seven tools covering discovery + the full payment lifecycle:

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

**Returns**
```json
{
  "services": [
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
  ],
  "count": 1
}
```

If the agent's policy has an allowlist, results are filtered to allowed payees by default.

## How the LLM experiences it

Once the server is loaded, the host exposes all seven tools in its normal tool UI. The LLM decides when to call them; the host runs them; results come back as tool output the LLM reads. A typical prompt flow:

> **You:** find a data feed and pay for BTC orderbook depth.
> **LLM:** *[calls `canopy_discover_services({ category: "data", query: "orderbook" })`]*
> *[tool returns 3 services with URLs and prices]*
> **LLM:** *[picks the cheapest, calls `canopy_pay({ to: "0x...", amountUsd: 0.01 })`]*
> *[tool returns `{ "status": "allowed", "txHash": "0xabc…" }`]*
> **LLM:** Paid Coinglass $0.01 for the feed. Here's the depth: …

If the amount exceeds the approval threshold, the LLM sees `pending_approval` and will usually tell the user to approve in the dashboard. Approvals happen in the Canopy web dashboard, not inside the MCP host.

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

**`canopy_pay` returns `pending_approval`** — call `canopy_wait_for_approval({ approvalId })` to block up to 60 seconds for a decision, or `canopy_get_approval_status({ approvalId })` to poll on your own cadence. If the user takes longer than a minute, ask them to decide in the dashboard, then re-call `canopy_pay` with the same arguments — idempotency returns the cached `allowed` result without re-charging.

## What's under the hood

`@canopy-ai/mcp` is a thin wrapper around [`@canopy-ai/sdk`](../typescript). It's an stdio MCP server (the official `@modelcontextprotocol/sdk`) that exposes `canopy.pay`, `canopy.preview`, `canopy.getApprovalStatus`, `canopy.waitForApproval`, `canopy.ping`, `canopy.budget`, and `canopy.discover` as MCP tools. No custody — the server just proxies to Canopy's API with your key.

## Version

`0.0.1` — alpha.

## License

[MIT](../LICENSE)
