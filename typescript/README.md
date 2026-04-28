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
    // Three options here — see "Human-in-the-loop approvals" below:
    //   1. tell the user (LLM picks a phrase using `result.recipientName`,
    //      `result.amountUsd`, etc.) and call canopy.approve() / .deny()
    //      when they reply
    //   2. canopy.waitForApproval(result.approvalId) — block-poll
    //   3. let it ride — agent moves on, dashboard handles decision
    console.log(`Pending: $${result.amountUsd} to ${result.recipientName}`);
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

## Human-in-the-loop approvals

When the policy is configured with `approval_required: true`, payments above the threshold come back as `status: "pending_approval"` instead of settling. There are three places the human can decide. All hit the same backend, so any one of them resolves the approval:

| Where | Best when |
|---|---|
| **Dashboard** (already built — `pending-approvals-section`, activity drawer) | Org admin already on the dashboard |
| **In chat** — the LLM calls `canopy.approve(id)` / `canopy.deny(id)` when the user replies "yes" / "no" | The user is mid-conversation with the agent |
| **`canopy.fetch(..., { waitForApproval: true })`** | The agent is auto-paying an x402 endpoint and wants to block until decided |

### Chat-native (recommended for conversational agents)

`getTools()` includes `canopy_approve` and `canopy_deny`. The LLM calls them when the user gives explicit consent in chat. Reads naturally:

> **You:** Find a data feed and pull BTC depth.
> **LLM:** *[calls `canopy_pay({ to: "0x…Alchemy", amountUsd: 5 })`]*
> *[returns `{ status: "pending_approval", approvalId: "ar_x9", recipientName: "Alchemy", amountUsd: 5 }`]*
> **LLM:** I'd like to pay $5 to Alchemy for compute. Reply 'approve' or 'deny'.
> **You:** approve
> **LLM:** *[calls `canopy_approve({ approval_id: "ar_x9" })`]*
> **LLM:** Approved — sent. tx 0x123… on Base.

The pending result carries everything the LLM needs to phrase the question — `recipientName`, `amountUsd`, `agentName`, `expiresAt`. No follow-up call needed.

To turn this off, uncheck "Allow approval from chat" in the policy. Then `canopy.approve()` throws `CanopyChatApprovalDisabledError` and the LLM should redirect the user to the dashboard.

### Block-and-retry on `fetch()`

If your agent calls `canopy.fetch(url)` against an x402 endpoint and the policy gates it, the default behavior is to throw `CanopyApprovalRequiredError`. To wait instead:

```ts
const res = await canopy.fetch("https://paid-api.example.com/generate", undefined, {
  waitForApproval: 60_000, // ms; or `true` for default 5 min
});
// On approve: SDK retries the URL with the recovered X-PAYMENT header.
// On deny / expiry: throws CanopyApprovalDeniedError / CanopyApprovalExpiredError.
```

### Manual polling

`canopy.waitForApproval(approvalId)` polls every 2 seconds (default 5-min timeout) and returns when the status leaves `pending`. `canopy.getApprovalStatus(approvalId)` is the one-shot version if you want to drive the polling yourself.

## Plug Canopy into your agent

The `Canopy` instance carries framework-shaped tool helpers. Pick the namespace that matches your stack — each one returns the right shape for that framework, no transforms needed.

| Framework | Helper | Lines of glue |
|---|---|---|
| Vercel AI SDK (v3+) | `canopy.vercel.tools()` | 1 |
| OpenAI Chat Completions / Responses | `canopy.openai.tools()` + `canopy.openai.dispatch()` | 2 |
| Anthropic Messages | `canopy.anthropic.tools()` + `canopy.anthropic.dispatch()` | 2 |
| LangChain JS (v0.3+) | `import { toLangChainTools } from "@canopy-ai/sdk/langchain"` | 1 |
| Mastra | `createTool({ ... canopy.pay })` per tool | small |
| MCP host (Claude Desktop, Cursor, Cline, Windsurf) | install [`@canopy-ai/mcp`](../mcp) | 0 |

`canopy.getTools()` is still available as the canonical, framework-agnostic shape (`{ name, description, parameters: JSONSchema, execute }[]`) for any framework not listed.

### Vercel AI SDK

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});

const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: canopy.vercel.tools(),
  prompt: "Find me an orderbook feed and pull BTC depth.",
});
```

### OpenAI (Chat Completions)

`canopy.openai.tools()` returns the `[{ type: "function", function: { ... } }]` shape OpenAI expects. `canopy.openai.dispatch(toolCalls)` runs them and returns tool messages already shaped for the next turn.

```ts
import OpenAI from "openai";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});
const openai = new OpenAI();

const messages: OpenAI.ChatCompletionMessageParam[] = [
  { role: "user", content: "Find data feeds I can pay for and use the cheapest." },
];

const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages,
  tools: canopy.openai.tools(),
});

const toolMessages = await canopy.openai.dispatch(
  completion.choices[0].message.tool_calls,
);
if (toolMessages.length) {
  messages.push(completion.choices[0].message);
  messages.push(...toolMessages);
  // Loop back into chat.completions.create with the updated messages.
}
```

`dispatch` skips tool calls that aren't Canopy's (the host loop dispatches those) and embeds errors as `{ error }` JSON in the tool message so the LLM can react instead of crashing the loop. Pending-approval results land in the tool message with `recipientName`, `amountUsd`, `expiresAt`, `chatApprovalEnabled` — the LLM can ask the user and call `canopy_approve` / `canopy_deny` next turn.

### Anthropic (Messages)

Same pattern, Anthropic-shaped: `canopy.anthropic.tools()` produces `[{ name, description, input_schema }]`. `canopy.anthropic.dispatch(content)` consumes assistant content blocks and returns `tool_result` blocks ready to wrap in a user message.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});
const client = new Anthropic();

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: "Discover x402 data feeds and pay for one." },
];

const reply = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  tools: canopy.anthropic.tools(),
  messages,
});

const toolResults = await canopy.anthropic.dispatch(reply.content);
if (toolResults.length) {
  messages.push({ role: "assistant", content: reply.content });
  messages.push({ role: "user", content: toolResults });
  // Loop back into messages.create with the updated messages.
}
```

### LangChain

```ts
import { Canopy } from "@canopy-ai/sdk";
import { toLangChainTools } from "@canopy-ai/sdk/langchain";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});

const lcTools = toLangChainTools(canopy);  // DynamicStructuredTool[]
```

`@canopy-ai/sdk/langchain` is a subpath import — `@langchain/core` is an optional peer dep, so installs that don't use LangChain don't pay for it.

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
  | { status: "pending_approval"; approvalId: string; transactionId: string;
      reason: string;
      recipientName: string | null;   // resolved from registry — "Alchemy" etc.
      recipientAddress: string | null;
      amountUsd: number | null;
      agentName: string | null;
      expiresAt: string | null;       // ISO; auto-cancelled after this
      chatApprovalEnabled: boolean;   // false → canopy.approve() throws
    }
  | { status: "denied"; reason: string; transactionId: string; };
```

- **`to`**: a `0x…` address or a registry slug like `agentic.market/anthropic` (resolved server-side).
- **`amountUsd`**: USD as a number (e.g. `0.10` for ten cents).
- **`idempotencyKey`** *(optional)*: pass a stable string for retries you don't fully control (webhooks, framework retries). Same `(agentId, idempotencyKey)` returns the cached result with `idempotent: true`.

### `canopy.preview({ to, amountUsd })`

Same shape and return as `pay()`, but evaluates the policy without signing or persisting. Use it to ask "would this go through?" before committing.

### `canopy.fetch(url, init?, opts?)`

Like global `fetch`, but auto-pays HTTP 402 responses per the x402 spec. Same agent policy applies.

```ts
const res = await canopy.fetch(url, init, {
  waitForApproval: 60_000,  // ms, or `true` for default 5 min
                            // omit/false (default): throws CanopyApprovalRequiredError on pending
});
```

Without `waitForApproval`, a payment that goes pending throws a typed error you can catch and handle yourself.

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

### `canopy.approve(approvalId)` / `canopy.deny(approvalId)`

Mark a pending approval decided. Call from agent code when the user gives explicit consent in chat (`approve` for "yes", `deny` for "no"). The org's policy must have `chat_approval_enabled = true` (default true), or these throw `CanopyChatApprovalDisabledError` and the LLM should redirect the user to the dashboard.

```ts
const result = await canopy.pay({ to: "0x…", amountUsd: 5 });
if (result.status === "pending_approval") {
  // ...the LLM asks the user, the user replies "approve", the LLM calls:
  const decided = await canopy.approve(result.approvalId);
  // decided: { decision, transactionId, txHash, signature }
}
```

### `canopy.waitForApproval(approvalId, opts?)`

Polls until the approval leaves `pending` or the timeout elapses (default 5 min, 2s polling). Use when the agent should block on the human deciding via the dashboard or chat.

```ts
const decided = await canopy.waitForApproval(result.approvalId, {
  timeoutMs: 60_000,
  pollIntervalMs: 1_000,
});
// decided.status: "approved" | "denied" | "expired"
// decided.xPaymentHeader is populated for x402 transactions on approve
```

Throws `CanopyApprovalTimeoutError` on timeout.

### `canopy.getApprovalStatus(approvalId)`

One-shot read of the same status. Use this when you want to poll on your own cadence.

### `canopy.getTools()`

Returns the canonical tool list as `CanopyTool[]`:

```ts
type CanopyTool = {
  name: string;            // "canopy_pay" | "canopy_discover_services" | "canopy_approve" | "canopy_deny"
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute: (args: any) => Promise<unknown>;
};
```

Four tools by default:

| Tool | Purpose |
|---|---|
| `canopy_pay` | Send a payment from the org treasury, gated by the agent's policy. |
| `canopy_discover_services` | Find x402-paywalled services the agent can call. |
| `canopy_approve` | Mark a pending approval approved. The LLM calls this when the user replies "yes" / "approve". |
| `canopy_deny` | Mark a pending approval denied. The LLM calls this when the user replies "no" / "cancel". |

Filter the array if you only want a subset:

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
| `CanopyApprovalRequiredError` | `canopy.fetch()` hit a payment that needs approval and `waitForApproval` was off | `approvalId`, `recipientName`, `amountUsd`, `agentName`, `expiresAt`, `chatApprovalEnabled` |
| `CanopyApprovalDeniedError` | The user denied while `waitForApproval` was blocking | `approvalId`, `transactionId` |
| `CanopyApprovalExpiredError` | The approval expired (24h default) before a decision | `approvalId`, `transactionId` |
| `CanopyChatApprovalDisabledError` | `canopy.approve()` / `.deny()` against a policy with `chat_approval_enabled=false` | `approvalId` |

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
- **`pending_approval` and your script just sits there** — for chat agents, surface `result.recipientName` / `result.amountUsd` to the user and call `canopy.approve(id)` / `.deny(id)` when they reply. For scripted agents, call `canopy.waitForApproval(id)` to block, or `getApprovalStatus(id)` to poll on your own cadence.
- **`CanopyChatApprovalDisabledError` when calling `approve()`** — the agent's policy has chat-based approval turned off. The user must approve in the dashboard.
- **`discover()` returns an empty array** — the registry might not have x402 services in that category yet. Try without `category`, or pass `includeUnverified: true` to see the long tail.

## Version

`0.0.1` — alpha. Wire format is stable; small refinements possible before `1.0`.

## License

[MIT](../LICENSE)
