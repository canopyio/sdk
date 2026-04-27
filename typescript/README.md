# @canopy-ai/sdk

TypeScript / Node.js client for [Canopy](https://www.trycanopy.ai). Give your AI agent a USDC treasury on Base, gated by a policy you set in the dashboard.

```bash
npm install @canopy-ai/sdk
```

Node 18+. Ships ESM + CJS. Zero runtime dependencies.

## Setup in 30 seconds

The fast path, after you've signed up at <https://www.trycanopy.ai> and added an agent: click **Install** on the agent's page in the dashboard to get a one-time code, then in your project:

```bash
npx @canopy-ai/sdk init <code>
```

That writes `CANOPY_API_KEY` and `CANOPY_AGENT_ID` into `.env.local` and pings to confirm the connection. The dashboard flips your agent's status to **Connected** in real time.

Prefer manual setup? Dashboard → Settings → API Keys → Create (`ak_live_…`), then Dashboard → Agents → copy the `agt_…` id. Drop both into your env:

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

## Plug Canopy into your agent

Drop a payment tool into whatever framework you're using. `getTools({ framework })` returns ready-to-bind definitions; the `execute` callable is wired to `canopy.pay()`.

### Anthropic

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});
const client = new Anthropic();

const tools = canopy.getTools({ framework: "anthropic" });
const msg = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  tools: tools.map(({ execute, ...rest }) => rest),  // strip execute for the API
  messages: [{ role: "user", content: "Pay 10 cents to agentic.market/anthropic" }],
});

// Dispatch any tool_use blocks back through Canopy:
for (const block of msg.content) {
  if (block.type !== "tool_use") continue;
  const tool = tools.find((t) => t.name === block.name);
  if (tool) await tool.execute(block.input as { to: string; amountUsd: number });
}
```

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
  tools: canopy.getTools({ framework: "vercel" }),  // Record<string, Tool>
  prompt: "Send 5 cents to 0x1234...",
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

const [spec] = canopy.getTools({ framework: "langchain" });
const payTool = new DynamicStructuredTool(spec);  // pass the spec directly — JSON Schema, no Zod required
```

### OpenAI

```ts
import OpenAI from "openai";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});
const openai = new OpenAI();
const tools = canopy.getTools({ framework: "openai" });

const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Send 5 cents to 0x1234..." }],
  tools: tools.map(({ execute, ...rest }) => rest),
});

for (const call of completion.choices[0].message.tool_calls ?? []) {
  const tool = tools.find((t) => t.function.name === call.function.name);
  if (tool) await tool.execute(JSON.parse(call.function.arguments));
}
```

### Pay paywalled APIs (x402)

Drop-in replacement for `fetch` that auto-pays [x402](https://x402.org) endpoints:

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
  agentId?: string;        // required for pay/preview/fetch/ping/budget
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

Like global `fetch`, but auto-pays HTTP 402 responses per the x402 spec. See above.

### `canopy.ping()`

Health check. Confirms the API key + agent are valid and returns a structured snapshot:

```ts
const ping = await canopy.ping();
// { ok: true,
//   agent: { id, name, status, policyId, policyName },
//   org:   { name, treasuryAddress },
//   latencyMs }
```

Run on app startup to fail-fast on bad config. Also drives the dashboard's "Connected" indicator.

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

### `canopy.getTools({ framework })`

Returns LLM-framework-shaped tool definitions for the four supported frameworks: `"openai"`, `"anthropic"`, `"vercel"`, `"langchain"`. Each entry carries an `execute` callable that calls `canopy.pay()`. See examples above.

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
- **`denied: Recipient is not in the allowlist`** — edit the agent's policy to add the recipient, or pick a different one.
- **`denied: Spend cap exceeded`** — wait out the cap window or raise it in the dashboard. Run `canopy.budget()` to see remaining headroom.
- **`pending_approval` and your script just sits there** — call `waitForApproval(id)` to block, or `getApprovalStatus(id)` to poll on your own cadence.

## Version

`0.0.1` — alpha. Wire format is stable; small refinements possible before `1.0`.

## License

[MIT](../LICENSE)
