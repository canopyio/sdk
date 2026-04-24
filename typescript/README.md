# @canopy-ai/sdk

TypeScript client for [Canopy](https://www.trycanopy.ai) — custodial agent wallets with policy-gated spending.

```bash
npm install @canopy-ai/sdk
```

Requires Node.js 18+ (uses the built-in `fetch`). Ships both ESM and CJS builds.

## Setup

1. **Create an org** at <https://www.trycanopy.ai> — sign up with Clerk, Canopy auto-provisions a treasury wallet and a default spending policy (spend cap, approval threshold).
2. **Generate an API key**: Dashboard → Settings → API Keys → Create. Copy the `ak_live_…` string (shown once).
3. **Create an agent**: Dashboard → Agents → Add Agent. You get an `agt_…` id plus a dedicated server wallet for that agent.
4. **Put them in your env**:
   ```bash
   CANOPY_API_KEY=ak_live_xxxxxxxxxxxxxxxx
   CANOPY_AGENT_ID=agt_xxxxxxxx
   ```

## Minimal example

```ts
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: process.env.CANOPY_AGENT_ID!,
});

const result = await canopy.pay({
  to: "0x1111222233334444555566667777888899990000",
  amountUsd: 0.10,
});

switch (result.status) {
  case "allowed":
    console.log("tx submitted:", result.txHash);
    break;
  case "pending_approval":
    console.log("approval required:", result.reason);
    const decided = await canopy.waitForApproval(result.approvalId);
    console.log("approval decided:", decided.status);
    break;
  case "denied":
    console.log("policy denied:", result.reason);
    break;
}
```

## API

### `new Canopy(config)`

```ts
new Canopy({
  apiKey: string;          // CANOPY_API_KEY
  agentId?: string;        // required for pay() / preview() / fetch()
  baseUrl?: string;        // default: https://www.trycanopy.ai
})
```

### `canopy.pay(args)`

Issue a payment. Returns a discriminated union — no exceptions for policy outcomes.

```ts
type PayArgs = {
  to: string;              // 0x… address OR registry slug like "agentic.market/anthropic"
  amountUsd: number;       // USD amount, e.g. 0.10 for ten cents
  chainId?: number;        // default 8453 (Base mainnet)
  idempotencyKey?: string; // opt-in: retries with the same key return the cached decision
};

type PayResult =
  | { status: "allowed"; txHash: string | null; signature: string | null;
      transactionId: string | null; costUsd: number | null;
      idempotent?: boolean; dryRun?: boolean; }
  | { status: "pending_approval"; approvalId: string; transactionId: string; reason: string; }
  | { status: "denied"; reason: string; transactionId: string; };
```

**What "to" accepts**

- A 20-byte hex address: `0x1234567890123456789012345678901234567890`
- A registry slug: `agentic.market/anthropic`. The SDK resolves it via `/api/resolve` before signing.

**When to use `idempotencyKey`**

Always, for anything invoked in response to external state you don't control (webhook handlers, tool calls retried by a framework). On the same `(agentId, idempotencyKey)`, a second `pay()` call returns the cached result with `idempotent: true` — no duplicate charge.

### `canopy.preview(args)`

Same shape and return as `pay()`, but evaluates the policy without signing or persisting anything. Use this when the agent wants to pre-check whether a payment *would* be allowed.

```ts
const check = await canopy.preview({ to, amountUsd });
if (check.status === "denied") {
  // Tell the user we can't do it, before even trying.
}
```

### `canopy.fetch(url, init?)`

Drop-in replacement for global `fetch` that transparently handles [x402](https://x402.org) payments:

```ts
const res = await canopy.fetch("https://paid-api.example.com/generate-image");
// If the server returns 402, Canopy signs the payment and retries.
// You just see the eventual 200.
```

The 402 body must conform to the x402 `paymentRequirements` shape (`scheme: "exact"`, `network: "base"`). Non-402 responses pass through untouched. The server-side x402 signing handler is rolling out alongside the SDK — until then, use explicit `pay()`.

### `canopy.waitForApproval(approvalId, opts?)`

Poll `/api/approvals/{id}/status` until the approval leaves `pending`.

```ts
const decided = await canopy.waitForApproval(result.approvalId, {
  timeoutMs: 5 * 60_000,   // default
  pollIntervalMs: 2_000,   // default
});
// decided.status is one of "approved" | "denied" | "expired"
```

Throws `CanopyApprovalTimeoutError` if the timeout elapses.

### `canopy.getTools({ framework })`

Returns LLM-framework-shaped tool definitions that wrap `pay()`. Bind them to your LLM call and the agent can spend on its own:

```ts
const tools = canopy.getTools({ framework: "openai" });
// Each tool is { type: "function", function: {...}, execute: (args) => canopy.pay(args) }
```

**Supported frameworks (day 1)**

- `"openai"` — shape matches OpenAI Chat Completions / Responses API tool format. Works directly with Vercel AI SDK and most frameworks that accept OpenAI tool schemas.

The `"anthropic"`, `"vercel"`, and `"langchain"` parameter values are reserved; they throw today. Native shapes land as those adapters ship.

## LLM integration examples

### OpenAI

```ts
import OpenAI from "openai";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({ apiKey: process.env.CANOPY_API_KEY!, agentId: "agt_…" });
const openai = new OpenAI();
const tools = canopy.getTools({ framework: "openai" });

const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Send 5 cents to 0x1234..." }],
  tools: tools.map(({ execute, ...rest }) => rest), // OpenAI doesn't accept execute
});

// Dispatch tool calls back to Canopy
for (const call of completion.choices[0].message.tool_calls ?? []) {
  const tool = tools.find((t) => t.function.name === call.function.name);
  if (tool) await tool.execute(JSON.parse(call.function.arguments));
}
```

### Vercel AI SDK

```bash
npm install @canopy-ai/sdk ai @ai-sdk/openai zod
```

```ts
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({ apiKey: process.env.CANOPY_API_KEY!, agentId: "agt_…" });

const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: {
    canopy_pay: tool({
      description: "Send a USD payment from the agent's Canopy wallet.",
      parameters: z.object({
        to: z.string(),
        amountUsd: z.number(),
      }),
      execute: async ({ to, amountUsd }) => canopy.pay({ to, amountUsd }),
    }),
  },
  prompt: "Send 5 cents to 0x1234...",
});
```

Native `canopy.getTools({ framework: "vercel" })` is on the roadmap — until it lands, defining the `tool()` by hand as above is the canonical path.

### Mastra

[Mastra](https://mastra.ai) is a TS-first agent framework; Canopy plugs in as a `createTool`.

```bash
npm install @canopy-ai/sdk @mastra/core @ai-sdk/openai zod
```

```ts
import { Canopy } from "@canopy-ai/sdk";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const canopy = new Canopy({ apiKey: process.env.CANOPY_API_KEY!, agentId: "agt_…" });

const payTool = createTool({
  id: "canopy_pay",
  description: "Send a USD payment from the agent's Canopy wallet.",
  inputSchema: z.object({ to: z.string(), amountUsd: z.number() }),
  execute: async ({ context }) =>
    canopy.pay({ to: context.to, amountUsd: context.amountUsd }),
});

const agent = new Agent({
  name: "treasurer",
  instructions: "Pay recipients when asked.",
  model: openai("gpt-4o"),
  tools: { canopy_pay: payTool },
});
```

### Anthropic (manual tool dispatch)

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({ apiKey: process.env.CANOPY_API_KEY!, agentId: "agt_…" });
const anthropic = new Anthropic();

const msg = await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  tools: [{
    name: "canopy_pay",
    description: "Send a USD payment from the agent's Canopy wallet.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        amountUsd: { type: "number" },
      },
      required: ["to", "amountUsd"],
    },
  }],
  messages: [{ role: "user", content: "Pay 10 cents to 0x1234..." }],
});

// If msg.stop_reason === "tool_use", dispatch via canopy.pay(...)
```

## Errors

HTTP and network errors throw. Policy outcomes are returns.

| Error | When |
|---|---|
| `CanopyConfigError` | Constructor args are invalid (missing `apiKey`, no `agentId` on `pay()`). |
| `CanopyApiError` | Server returned a status outside `[200, 202, 403]`. Has `.status` and `.body`. |
| `CanopyNetworkError` | `fetch` itself threw (DNS, TLS, timeout). Has `.cause`. |
| `CanopyApprovalTimeoutError` | `waitForApproval` exhausted its timeout. |

All inherit from `CanopyError`. Catch the base if you want a single `try/catch`:

```ts
import { Canopy, CanopyError, CanopyApiError } from "@canopy-ai/sdk";

try {
  await canopy.pay({ to, amountUsd });
} catch (err) {
  if (err instanceof CanopyApiError && err.status === 401) {
    console.error("Check your CANOPY_API_KEY");
  } else if (err instanceof CanopyError) {
    console.error("Canopy:", err.message);
  } else {
    throw err;
  }
}
```

## Local development

If you're running canopy-app locally:

```ts
const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: "agt_…",
  baseUrl: "http://localhost:3000",
});
```

Use a test-mode key (`ak_test_…`) generated from the local dashboard so production data stays clean.

## Chains and tokens

Day 1: USDC on Base mainnet (chain 8453). The SDK hand-builds the `ERC20.transfer(to, amount)` calldata and submits via the agent's Privy server wallet.

The wallet needs a dust balance of ETH to cover gas. Fund the `server_wallet_address` (visible in the dashboard) with ~$0.50 worth of Base ETH once per agent.

Support for other chains/tokens will arrive via an expanded `pay()` signature (`chainId`, `token`). The `chainId` arg already exists as a pass-through, but only Base USDC is tested today.

## Troubleshooting

**`CanopyApiError: 401 Invalid API key`** — the key is missing, wrong, or revoked. Regenerate in the dashboard; keys start with `ak_live_` or `ak_test_`.

**`CanopyApiError: 503 Privy is not configured`** — the canopy-app server doesn't have `PRIVY_APP_ID` set. Production should have this; local dev may not.

**`CanopyApiError: 404 Organization not found`** — should be rare now that the server auto-syncs orgs from Clerk, but happens if an API key was issued before its org got synced. Creating one agent from the dashboard first fixes it.

**`CanopyConfigError: agentId is required for pay()`** — pass `agentId` to the `Canopy` constructor, or set `CANOPY_AGENT_ID` and read it yourself.

**`denied` with `Recipient … is not in the allowlist`** — the agent's policy has an allowlist set. Edit the policy in the dashboard to add the recipient, or choose a different recipient.

**`denied` with `Spend cap exceeded`** — the agent has spent its cap in the current window. Wait out the window (default 24h from your policy's `cap_period_hours`), or raise the cap in the dashboard.

## Version

`0.0.1` — alpha. Wire format is stable; API surface may see small refinements before `1.0`.

## License

[MIT](../LICENSE)
