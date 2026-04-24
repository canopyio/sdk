# Canopy SDK

Client libraries for [Canopy](https://www.trycanopy.ai) — org treasury wallets with agent-level policy-gated spending.

Canopy lets an AI agent transact from your org treasury without handing it a private key. The agent calls `canopy.pay({ to, amountUsd })`; Canopy evaluates that agent's spending policy (cap, allowlist, approval threshold), and — if allowed — signs and submits the transaction from the Privy-backed org treasury wallet.

## The three packages

| Package | Install | Use when |
|---|---|---|
| [`@canopy-ai/sdk`](./typescript) | `npm install @canopy-ai/sdk` | You're building a TypeScript / Node.js agent |
| [`canopy-ai`](./python) | `pip install canopy-ai` | You're building a Python agent (LangChain, CrewAI, LangGraph, custom) |
| [`@canopy-ai/mcp`](./mcp) | `npx -y @canopy-ai/mcp` | You want to give an existing MCP-compatible host (Claude Desktop, Cursor, Cline) a payment tool — no code changes |

All three share the same HTTP contract and return the same result shapes. Pick whichever matches your stack.

## 30-second overview

```ts
import { Canopy } from "@canopy-ai/sdk";

const canopy = new Canopy({
  apiKey: process.env.CANOPY_API_KEY!,
  agentId: "agt_xxxxxxxx",
});

// Pay someone
const result = await canopy.pay({
  to: "0x1234…",
  amountUsd: 0.10,
});

// result is a discriminated union:
if (result.status === "allowed") {
  console.log("tx:", result.txHash);
} else if (result.status === "pending_approval") {
  const decided = await canopy.waitForApproval(result.approvalId);
} else {
  console.log("denied:", result.reason);
}
```

Policy outcomes (`allowed`, `denied`, `pending_approval`) are **return values**, not exceptions. The agent's LLM can reason about them directly ("I was denied, I should ask the user"). HTTP and network errors still throw.

## Before you install

You need three things:

1. **An org on [trycanopy.ai](https://www.trycanopy.ai)**. Sign up, Canopy auto-provisions a treasury wallet and a default spending policy for you.
2. **An API key**. Dashboard → Settings → API Keys → Create. You'll see `ak_live_…` exactly once — copy it into `CANOPY_API_KEY`.
3. **An agent**. Dashboard → Agents → Add Agent. Canopy gives you an `agt_…` id so policy and activity can be attributed to that agent while funds come from the org treasury.

After that, the SDK just needs `CANOPY_API_KEY` and the agent id.

## The five primitives

Every SDK exposes the same five calls:

| Call | What it does |
|---|---|
| `canopy.pay({ to, amountUsd })` | Issue a payment. Returns `{ status, … }`. |
| `canopy.preview({ to, amountUsd })` | Dry-run the same policy evaluation. Nothing is signed or persisted. |
| `canopy.fetch(url)` | Like `fetch`, but if the server returns HTTP 402, Canopy signs the x402 payment transparently and retries. |
| `canopy.waitForApproval(id)` | Poll until a pending approval is decided or times out. |
| `canopy.getTools({ framework })` | Return LLM-framework-shaped tool definitions bound to this Canopy instance. |

The package-specific READMEs document each in detail.

## How payments actually work

1. **SDK → Canopy API**: `POST /api/sign` with your API key, agent id, recipient, amount.
2. **Canopy evaluates**: atomic SQL function runs the allowlist check, cap check (with advisory lock so concurrent signs can't race past the cap), and approval-threshold check.
3. **Three outcomes**:
   - `allowed` → Canopy submits the tx from the org treasury wallet. Returns `txHash`.
   - `pending_approval` → Canopy creates an `approval_request`. An org admin decides in the dashboard. Agent can `waitForApproval(id)`.
   - `denied` → Rejection logged. Agent sees the reason.
4. **Idempotent**: pass an `idempotencyKey` / `idempotency_key` and a retry returns the cached decision — no double charge.

You never see a private key. Signing happens server-side against the Privy-managed org treasury wallet, gated by your policy and attributed to the calling agent.

## Entity registry

Canopy hosts a small registry of known payees (think Stripe's customer network). You can pay by slug instead of address:

```ts
await canopy.pay({ to: "agentic.market/anthropic", amountUsd: 0.05 });
```

The SDK sniffs the `to` field — anything matching `0x[40 hex chars]` is used as-is; anything else is resolved via `GET /api/resolve` before the payment fires.

## Parity

The TS and Python SDKs are tested against a shared fixture set in [`shared/fixtures/`](./shared/fixtures/). Each fixture is a JSON record of:

- an SDK call (`pay`, `preview`),
- the expected HTTP request the SDK should send,
- a mocked HTTP response,
- the structured return value the SDK should produce.

Both SDKs ship a replay runner. Any wire-level drift between languages fails in CI. Adding a scenario is just dropping a JSON file in `shared/fixtures/`.

## Repo layout

```
sdk/
├── README.md           ← you are here
├── LICENSE
├── shared/
│   ├── openapi.yaml    ← HTTP contract (4 endpoints)
│   └── fixtures/       ← parity test fixtures
├── typescript/         ← @canopy-ai/sdk
├── python/             ← canopy-ai
└── mcp/                ← @canopy-ai/mcp
```

## Contributing

1. Pick a scenario you want the SDK to handle.
2. Add a JSON fixture to `shared/fixtures/`.
3. Run `npm test` in `typescript/` and `pytest` in `python/` — both should fail identically.
4. Implement in both SDKs, re-run, land the PR.

Prefer language-specific conventions over forcing parity (camelCase in TS, snake_case in Python), but the **wire format** is one-to-one.

## Links

- Product: <https://www.trycanopy.ai>
- Dashboard: <https://www.trycanopy.ai/dashboard>
- x402 spec: <https://x402.org>

## License

[MIT](./LICENSE)
