# @canopy-ai/sdk

TypeScript / Node.js client for [Canopy](https://www.trycanopy.ai). Give your AI agent a USDC treasury on Base, gated by a policy you set in the dashboard.

```bash
npm install @canopy-ai/sdk
```

Node 18+. Ships ESM + CJS. Zero runtime dependencies.

## Setup in 30 seconds

After you've signed up at <https://www.trycanopy.ai> and added an agent:

1. Dashboard → **Settings** → copy your org API key (`ak_live_…`).
2. Dashboard → **Agents** → copy the agent's `agt_…` id.
3. Drop both into your project's `.env`:

```bash
CANOPY_API_KEY=ak_live_xxxxxxxxxxxxxxxx
CANOPY_AGENT_ID=agt_xxxxxxxx
```

## Hello world

```ts
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});

const result = await canopy.pay({
  to: "agentic.market/anthropic",   // or a 0x… address
  amountUsd: 0.10,
});

switch (result.status) {
  case "allowed":
    console.log("paid:", result.txHash);
    break;
  case "pending_approval":
    const decided = await canopy.waitForApproval(result.approvalId);
    console.log("decision:", decided.status);
    break;
  case "denied":
    console.log("denied:", result.reason);
    break;
}
```

## Discover paid services at runtime

Don't hardcode URLs. Let the agent find x402 services it can call:

```ts
const services = await canopy.discover({ category: "data", query: "orderbook" });
// → [{ name, description, url, payTo, typicalAmountUsd, policyAllowed, ... }]

const feed = services[0];
if (feed?.policyAllowed) {
  const data = await canopy.fetch(feed.url!);   // 402 → auto-paid → 200 with content
}
```

`discover()` queries Canopy's registry of x402 services. The agent's policy filters the results — if the policy has an allowlist, only services on that list are returned. Set `includeBlocked: true` to see blocked services too (with `policyAllowed: false`).

## Plug Canopy into your agent

`canopy.getTools()` returns the canonical tool list — `canopy_pay` and `canopy_discover_services` — as `{ name, description, parameters: JSONSchema, execute }`. Most frameworks consume this shape directly. For OpenAI / Anthropic, wrap with a one-line transform.

| Framework | Fit | Recipe |
|---|---|---|
| Vercel AI SDK (v3+) | Direct | [↓](#vercel-ai-sdk) |
| LangChain JS (v0.2+) | Direct | [↓](#langchain) |
| Mastra | Direct | [↓](#mastra) |
| OpenAI Chat Completions / Responses | One-line wrap | [↓](#openai-chat-completions) |
| Anthropic Messages | One-line wrap | [↓](#anthropic) |
| MCP host (Claude Desktop, Cursor, Cline, Windsurf) | No code — install [`@canopy-ai/mcp`](../mcp) | — |

If your framework isn't listed but accepts a tool definition with JSON Schema + an async callable, our canonical shape works directly. If it expects a different envelope (like OpenAI/Anthropic), wrap with a `.map(...)`.

### Vercel AI SDK

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});
const tools = canopy.getTools();

const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: Object.fromEntries(tools.map((t) => [t.name, t])),
  prompt: "Find me an orderbook feed and pull BTC depth.",
});
```

### LangChain

```ts
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});

const lcTools = canopy.getTools().map(
  (t) =>
    new DynamicStructuredTool({
      name: t.name,
      description: t.description,
      schema: t.parameters,
      func: t.execute,
    }),
);
```

### OpenAI (Chat Completions)

OpenAI's tool format wraps each entry in `{ type: "function", function: { ... } }`. One-line transform:

```ts
import OpenAI from "openai";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});
const openai = new OpenAI();
const tools = canopy.getTools();

const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Find data feeds I can pay for and use the cheapest." }],
  tools: tools.map(({ execute, ...rest }) => ({ type: "function", function: rest })),
});

for (const call of completion.choices[0].message.tool_calls ?? []) {
  const t = tools.find((x) => x.name === call.function.name);
  if (t) await t.execute(JSON.parse(call.function.arguments));
}
```

### Anthropic

Anthropic's Messages API renames `parameters` → `input_schema`. One-line transform:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});
const client = new Anthropic();
const tools = canopy.getTools();

const msg = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  tools: tools.map(({ execute, parameters, ...rest }) => ({ ...rest, input_schema: parameters })),
  messages: [{ role: "user", content: "Discover x402 data feeds and pay for one." }],
});

for (const block of msg.content) {
  if (block.type !== "tool_use") continue;
  const t = tools.find((x) => x.name === block.name);
  if (t) await t.execute(block.input as Record<string, unknown>);
}
```

### Mastra

```ts
import { createTool } from "@mastra/core/tools";

const mastraTools = Object.fromEntries(
  canopy.getTools().map((t) => [
    t.name,
    createTool({
      id: t.name,
      description: t.description,
      inputSchema: t.parameters,
      execute: ({ context }) => t.execute(context),
    }),
  ]),
);
```

### Pay paywalled APIs (x402)

`canopy.fetch()` is a drop-in replacement for global `fetch` that auto-pays [x402](https://x402.org) endpoints:

```ts
const res = await canopy.fetch("https://paid-api.example.com/generate-image");
// On HTTP 402, Canopy signs the payment and retries. You see the eventual 200.
```

Subject to the same agent policy as `pay()`. Non-402 responses pass through untouched.

## Reference

### `new Canopy(config)`

```ts
new Canopy({
  apiKey: string;          // required
  agentId?: string;        // required for pay/preview/fetch/discover/ping/budget
  baseUrl?: string;        // default: https://www.trycanopy.ai
})
```

### `canopy.pay({ to, amountUsd, idempotencyKey?, chainId? })`

Issues a payment. Returns a discriminated union — never throws on policy outcomes:

```ts
type PayResult =
  | { status: "allowed"; txHash: string | null; signature: string | null;
      transactionId: string | null; costUsd: number | null;
      idempotent?: boolean; dryRun?: boolean; }
  | { status: "pending_approval"; approvalId: string; transactionId: string; reason: string; }
  | { status: "denied"; reason: string; transactionId: string; };
```

- **`to`**: a `0x…` address or a registry slug like `agentic.market/anthropic` (resolved server-side).
- **`amountUsd`**: USD as a number (e.g. `0.10` for ten cents).
- **`idempotencyKey`** *(optional)*: pass a stable string for retries you don't fully control (webhooks, framework retries). Same `(agentId, idempotencyKey)` returns the cached result with `idempotent: true`.

### `canopy.preview({ to, amountUsd })`

Same shape and return as `pay()`, but evaluates the policy without signing or persisting. Use it to ask "would this go through?" before committing.

### `canopy.fetch(url, init?)`

Like global `fetch`, but auto-pays HTTP 402 responses per the x402 spec. Same agent policy applies.

### `canopy.discover(opts?)`

Find x402-paywalled services the agent can call.

```ts
const services = await canopy.discover({
  category: "data",         // optional, e.g. "data", "api", "compute"
  query: "orderbook",       // optional free-text match
  limit: 20,                // optional, default 20, capped at 50
  includeBlocked: false,    // include policy-blocked services with policyAllowed=false
  includeUnverified: false, // include long-tail unverified entries
});
// → DiscoveredService[]: { slug, name, description, url, category,
//                          paymentProtocol, typicalAmountUsd, payTo, policyAllowed }
```

When the agent's policy has an allowlist, results are filtered to allowed payees by default. Pass `includeBlocked: true` to see blocked services too (each marked `policyAllowed: false`) — useful when you want the LLM to reason about why something isn't available.

### `canopy.ping()`

Health check. Confirms the API key + agent are valid and returns a structured snapshot:

```ts
const ping = await canopy.ping();
// { ok: true,
//   agent: { id, name, status, policyId, policyName },
//   org:   { name, treasuryAddress },
//   latencyMs }
```

Run on app startup to fail-fast on bad config.

### `canopy.budget()`

Pre-flight cap snapshot. Useful for LLM planning ("I have $4.30 left, defer the expensive call"):

```ts
const b = await canopy.budget();
// { agentId, capUsd, spentUsd, remainingUsd, periodHours, periodResetsAt }
```

`capUsd` and `remainingUsd` are `null` when no policy is bound.

### `canopy.waitForApproval(approvalId, opts?)`

Polls until the approval leaves `pending` or the timeout elapses (default 5 min, 2s polling).

```ts
const decided = await canopy.waitForApproval(result.approvalId, {
  timeoutMs: 60_000,
  pollIntervalMs: 1_000,
});
// decided.status: "approved" | "denied" | "expired"
```

Throws `CanopyApprovalTimeoutError` on timeout.

### `canopy.getApprovalStatus(approvalId)`

One-shot read of the same status. Use this when you want to poll on your own cadence.

### `canopy.getTools()`

Returns the canonical tool list as `CanopyTool[]`:

```ts
type CanopyTool = {
  name: string;            // "canopy_pay", "canopy_discover_services"
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute: (args: any) => Promise<unknown>;
};
```

Two tools by default: `canopy_pay` and `canopy_discover_services`. Filter the array if you only want one:

```ts
const payOnly = canopy.getTools().filter((t) => t.name === "canopy_pay");
```

## Errors

HTTP and network errors throw. Policy outcomes (`denied`, `pending_approval`) are return values.

| Error | When | Useful field |
|---|---|---|
| `CanopyConfigError` | Missing `apiKey`, missing `agentId`, etc. | `dashboardUrl` (jump to the page that fixes it) |
| `CanopyApiError` | Server returned an unexpected status | `status`, `body`, `dashboardUrl` |
| `CanopyNetworkError` | DNS / TLS / timeout | `cause` |
| `CanopyApprovalTimeoutError` | `waitForApproval` exhausted its timeout | `approvalId` |

All inherit from `CanopyError`. Most actionable errors include a `dashboardUrl` field pointing at the page that fixes them — the message includes the URL inline too.

```ts
import { CanopyError, CanopyApiError } from "@canopy-ai/sdk";

try {
  await canopy.pay({ to, amountUsd });
} catch (err) {
  if (err instanceof CanopyApiError && err.status === 401) {
    console.error("Bad API key. Open:", err.dashboardUrl);
  } else if (err instanceof CanopyError) {
    console.error("Canopy:", err.message);
  } else {
    throw err;
  }
}
```

## Local development

Point at a locally-running canopy-app:

```ts
const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: "agt_…",
  baseUrl: "http://localhost:3000",
});
```

Use a test-mode key (`ak_test_…`) so prod data stays clean.

## Troubleshooting

- **`401 Invalid API key`** — regenerate in Dashboard → Settings.
- **`agentId is required for pay()`** — pass `agentId` to the constructor or set `CANOPY_AGENT_ID`.
- **`denied: Recipient is not in the allowlist`** — edit the agent's policy to add the recipient, or pick a different one. `discover()` will respect the same allowlist.
- **`denied: Spend cap exceeded`** — wait out the cap window or raise it in the dashboard. Run `canopy.budget()` to see remaining headroom.
- **`pending_approval` and your script just sits there** — call `waitForApproval(id)` to block, or `getApprovalStatus(id)` to poll on your own cadence.
- **`discover()` returns an empty array** — the registry might not have x402 services in that category yet. Try without `category`, or pass `includeUnverified: true` to see the long tail.

## Version

`0.0.1` — alpha. Wire format is stable; small refinements possible before `1.0`.

## License

[MIT](../LICENSE)
