# canopy-ai

Python client for [Canopy](https://trycanopy.ai). Give your AI agent a USDC treasury on Base, gated by a policy you set in the dashboard.

```bash
pip install canopy-ai
```

Python 3.10+. Uses `httpx` for transport. `mypy --strict` passes on the library.

## Setup in 30 seconds

After you've signed up at <https://trycanopy.ai> and added an agent:

1. Dashboard → **Settings** → copy your org API key (`ak_live_…`).
2. Dashboard → **Agents** → copy the agent's `agt_…` id.
3. Drop both into your environment:

```bash
export CANOPY_API_KEY=ak_live_xxxxxxxxxxxxxxxx
export CANOPY_AGENT_ID=agt_xxxxxxxx
```

## Hello world

```python
import os
from canopy_ai import Canopy

canopy = Canopy(
    api_key=os.environ["CANOPY_API_KEY"],
    agent_id=os.environ["CANOPY_AGENT_ID"],
)

result = canopy.pay(to="0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97", amount_usd=0.10)

if result["status"] == "allowed":
    print("paid:", result["tx_hash"])
elif result["status"] == "pending_approval":
    # Three options here — see "Human-in-the-loop approvals" below:
    #   1. tell the user (LLM uses result["recipient_name"], result["amount_usd"])
    #      and call canopy.approve() / .deny() when they reply
    #   2. canopy.wait_for_approval(result["approval_id"]) — block-poll
    #   3. let it ride — agent moves on, dashboard handles decision
    print(f"Pending: ${result['amount_usd']} to {result['recipient_name']}")
elif result["status"] == "denied":
    print("denied:", result["reason"])
```

`pay()` returns a `TypedDict` with a `status` discriminator — your type checker narrows the other fields based on the literal.

## Async

For async frameworks (LangGraph, FastAPI, asyncio agent loops) use `AsyncCanopy` — same surface, all methods are coroutines:

```python
import asyncio, os
from canopy_ai import AsyncCanopy

async def main():
    canopy = AsyncCanopy(
        api_key=os.environ["CANOPY_API_KEY"],
        agent_id=os.environ["CANOPY_AGENT_ID"],
    )
    result = await canopy.pay(to="0x...", amount_usd=0.10)
    print(result)

asyncio.run(main())
```

## Discover paid services at runtime

Don't hardcode URLs. Let the agent find paid services it can call:

```python
services = canopy.discover(category="data", query="orderbook")
# → [{ "slug", "name", "description", "category", "payment_methods",
#      "endpoints", "preferred_base_url", "policy_allowed", ... }]

feed = services[0]
if feed["policy_allowed"] and feed["preferred_base_url"]:
    path = feed["endpoints"][0]["path"] if feed["endpoints"] else "/"
    res = canopy.fetch(feed["preferred_base_url"] + path)
    # 402 → auto-paid → 200 with content
```

`discover()` queries Canopy's registry of x402-on-Base and MPP-on-Tempo services. The agent's policy filters the results by service slug — if the policy has an allowlist, only services on that list are returned. Pass `include_blocked=True` to see blocked services too (with `policy_allowed: False`). `preferred_base_url` is picked by treasury balance: the rail whose chain currently has positive USDC.

## Human-in-the-loop approvals

When the policy is configured with `approval_required: True`, payments above the threshold come back as `status: "pending_approval"` instead of settling. Three surfaces — all hit the same backend, so any one of them resolves the approval:

| Where | Best when |
|---|---|
| **Dashboard** (already built — pending-approvals card, activity drawer) | Org admin already on the dashboard |
| **In chat** — the LLM calls `canopy.approve(id)` / `canopy.deny(id)` when the user replies "yes" / "no" | The user is mid-conversation with the agent |
| **`canopy.fetch(..., wait_for_approval=True)`** | The agent is auto-paying an x402 endpoint and wants to block until decided |

### Chat-native (recommended for conversational agents)

`get_tools()` includes `canopy_approve` and `canopy_deny`. The LLM calls them when the user gives explicit consent. The pending result carries everything the LLM needs to phrase the question — `recipient_name`, `amount_usd`, `agent_name`, `expires_at`:

```python
result = canopy.pay(to="0x...", amount_usd=5)
if result["status"] == "pending_approval":
    # LLM tells the user: "Pay $5 to Alchemy for compute? Reply approve / deny."
    # When user replies "approve":
    decided = canopy.approve(result["approval_id"])
    # decided: { decision, transaction_id, tx_hash, signature }
```

To turn this off, uncheck "Allow approval from chat" in the policy. Then `canopy.approve()` raises `CanopyChatApprovalDisabledError` and the LLM should redirect the user to the dashboard.

### Block-and-retry on `fetch()`

If your agent calls `canopy.fetch(url)` against an x402 endpoint and the policy gates it, the default behavior is to raise `CanopyApprovalRequiredError`. To wait instead:

```python
res = canopy.fetch(
    "https://paid-api.example.com/generate",
    wait_for_approval=60_000,  # ms; or True for default 5 min
)
# On approve: SDK retries the URL with the recovered X-PAYMENT header.
# On deny / expiry: raises CanopyApprovalDeniedError / CanopyApprovalExpiredError.
```

### Manual polling

`canopy.wait_for_approval(approval_id)` polls every 2 seconds (default 5-min timeout) and returns when the status leaves `pending`. `canopy.get_approval_status(approval_id)` is the one-shot version if you want to drive the polling yourself.

## Plug Canopy into your agent

**Already running an MCP-aware agent?** Skip this section — paste `https://mcp.trycanopy.ai/mcp` into the host's Custom Connectors or `mcpServers` config and your agent gets all nine canonical Canopy tools through MCP. That's the right path for claude.ai, ChatGPT, Claude Agent SDK, Claude Desktop, Cursor, VS Code, Zed, Cline, Windsurf, and any other MCP host. The native adapters below are for direct LLM-API flows where MCP isn't a fit (backend scripts, x402 auto-paying via `canopy.fetch()`, raw `chat.completions.create` / `messages.create` loops).

| Framework | Helper | Lines of glue |
|---|---|---|
| MCP host (claude.ai, ChatGPT, Claude Desktop, Cursor, VS Code, Zed, Cline, Windsurf) | paste `https://mcp.trycanopy.ai/mcp` | 0 |
| Claude Agent SDK | Remote MCP + `allowedTools: ["mcp__canopy__*"]` | 0 Canopy code |
| OpenAI Chat Completions | `canopy.openai.tools()` + `canopy.openai.dispatch()` | 2 |
| Anthropic Messages | `canopy.anthropic.tools()` + `canopy.anthropic.dispatch()` | 2 |
| LangChain | `from canopy_ai.langchain import to_langchain_tools` | 1 |
| LangGraph | same as LangChain (composes with `create_react_agent`) | 1 |
| OpenAI Agents SDK | `from canopy_ai.openai_agents import to_openai_agents_tools` | 1 |

`canopy.get_tools()` is still available as the canonical, framework-agnostic shape (`[{name, description, parameters: JSONSchema, execute}]`) for any framework not listed.

Claude Agent SDK uses MCP for external tools — prefer the remote MCP URL over the Anthropic Messages adapter there. `canopy.anthropic` is for direct Anthropic Messages API loops.

### OpenAI (Chat Completions)

`canopy.openai.tools()` returns the `[{"type": "function", "function": {...}}]` shape OpenAI expects. `canopy.openai.dispatch(tool_calls)` runs them and returns tool messages already shaped for the next turn.

```python
import os
from openai import OpenAI
from canopy_ai import Canopy

canopy = Canopy(api_key=os.environ["CANOPY_API_KEY"], agent_id=os.environ["CANOPY_AGENT_ID"])
openai = OpenAI()

messages = [{"role": "user", "content": "Discover data feeds and pay for BTC orderbook."}]

completion = openai.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=canopy.openai.tools(),
)

tool_messages = canopy.openai.dispatch(completion.choices[0].message.tool_calls)
if tool_messages:
    messages.append(completion.choices[0].message)
    messages.extend(tool_messages)
    # Loop back into chat.completions.create with the updated messages.
```

`dispatch` skips tool calls that aren't Canopy's (the host loop dispatches those) and embeds errors as `{"error": ...}` JSON in the tool message so the LLM can react. Pending-approval results land with `recipient_name`, `amount_usd`, `expires_at`, `chat_approval_enabled` — the LLM can ask the user and call `canopy_approve` / `canopy_deny` next turn.

For async (`AsyncCanopy`), the surface is identical but `dispatch` is awaitable: `await canopy.openai.dispatch(...)`.

### Anthropic (Messages)

```python
import os
from anthropic import Anthropic
from canopy_ai import Canopy

canopy = Canopy(api_key=os.environ["CANOPY_API_KEY"], agent_id=os.environ["CANOPY_AGENT_ID"])
client = Anthropic()

messages = [{"role": "user", "content": "Discover x402 data feeds and pay for one."}]

reply = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    tools=canopy.anthropic.tools(),
    messages=messages,
)

tool_results = canopy.anthropic.dispatch(reply.content)
if tool_results:
    messages.append({"role": "assistant", "content": reply.content})
    messages.append({"role": "user", "content": tool_results})
    # Loop back into messages.create with the updated messages.
```

### LangChain

```python
import os
from canopy_ai import Canopy
from canopy_ai.langchain import to_langchain_tools

canopy = Canopy(api_key=os.environ["CANOPY_API_KEY"], agent_id=os.environ["CANOPY_AGENT_ID"])
lc_tools = to_langchain_tools(canopy)  # list[StructuredTool]
```

`canopy_ai.langchain` requires the optional dep `langchain-core`. Install with `pip install 'canopy-ai[langchain]'`.

### LangGraph

```python
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
from canopy_ai import Canopy
from canopy_ai.langchain import to_langchain_tools

canopy = Canopy(api_key=os.environ["CANOPY_API_KEY"], agent_id=os.environ["CANOPY_AGENT_ID"])
agent = create_react_agent(ChatOpenAI(model="gpt-4o"), tools=to_langchain_tools(canopy))
agent.invoke({
    "messages": [{"role": "user", "content": "Find a data feed and pull BTC orderbook depth."}],
})
```

### OpenAI Agents SDK

```python
import os
from agents import Agent, Runner
from canopy_ai import Canopy
from canopy_ai.openai_agents import to_openai_agents_tools

canopy = Canopy(api_key=os.environ["CANOPY_API_KEY"], agent_id=os.environ["CANOPY_AGENT_ID"])

agent = Agent(
    name="Treasurer",
    instructions="Pay recipients and discover x402 services when asked.",
    tools=to_openai_agents_tools(canopy),
)
print(Runner.run_sync(agent, "Find data feeds and use the cheapest.").final_output)
```

`canopy_ai.openai_agents` requires the optional dep `openai-agents`. Install with `pip install 'canopy-ai[openai-agents]'`.

### Pay paywalled APIs (x402)

```python
res = canopy.fetch("https://paid-api.example.com/generate-image")
# On HTTP 402, Canopy signs the payment and retries. You see the eventual 200.
```

Subject to the same agent policy as `pay()`. Non-402 responses pass through. Async: `await async_canopy.fetch(...)`.

## Reference

### `Canopy(...)`

```python
Canopy(
    *,
    api_key: str,                    # required
    agent_id: str | None = None,     # required for pay/preview/fetch/discover/ping/budget
    base_url: str | None = None,     # default: https://trycanopy.ai
    http_client: httpx.Client | None = None,
)
```

`AsyncCanopy(...)` takes the same args but `http_client` is `httpx.AsyncClient`.

### `canopy.pay(*, to, amount_usd, idempotency_key=None, chain_id=None)`

Returns a `TypedDict` discriminated on `status`:

```python
# Allowed
{"status": "allowed", "tx_hash": str | None, "signature": str | None,
 "transaction_id": str | None, "cost_usd": float | None,
 "idempotent": bool,  # only on cached replays
 "dry_run": bool}     # only on preview() results

# Pending
{"status": "pending_approval",
 "approval_id": str,
 "transaction_id": str,
 "reason": str,
 "recipient_name": str | None,    # resolved from registry — "Alchemy" etc.
 "recipient_address": str | None,
 "amount_usd": float | None,
 "agent_name": str | None,
 "expires_at": str | None,        # ISO; auto-cancelled after this
 "chat_approval_enabled": bool}   # False → canopy.approve() raises

# Denied
{"status": "denied", "reason": str, "transaction_id": str}
```

- **`to`**: a `0x…` recipient address. For paid-service interactions, use `canopy.fetch(service_url)` — `pay()` is for direct transfers.
- **`idempotency_key`** *(optional)*: stable string for retries you don't fully control (webhook handlers, framework retries). Subsequent calls with the same key on the same agent return the cached result without re-charging.

### `canopy.preview(...)`

Same signature and return shape as `pay()`, but evaluates the policy without signing or persisting.

### `canopy.fetch(url, *, method="GET", headers=None, content=None, wait_for_approval=False)`

Like `httpx.request`, but auto-pays HTTP 402 ([x402](https://x402.org)) responses. Same agent policy applies.

```python
res = canopy.fetch(
    url,
    wait_for_approval=60_000,  # ms, or True for default 5 min
                               # omit/False (default): raises CanopyApprovalRequiredError on pending
)
```

Without `wait_for_approval`, a payment that goes pending raises a typed exception you can catch and handle yourself.

### `canopy.discover(**kwargs)`

Find paid services the agent can call (x402-on-Base + MPP-on-Tempo).

```python
services = canopy.discover(
    category="data",          # or list of categories; optional
    query="orderbook",        # optional free-text match
    limit=20,                 # optional, default 20, capped at 50
    include_blocked=False,    # include policy-blocked services with policy_allowed=False
    include_unverified=False, # include long-tail unverified entries
)
# → list[DiscoveredService]
#   { "slug", "name", "description", "category", "logo_url", "docs_url",
#     "payment_methods": [{ "realm", "base_url", "protocol" }],
#     "endpoints": [{ "method", "path", "description", "price_atomic",
#                     "currency", "pricing_model", "protocol" }],
#     "preferred_base_url", "policy_allowed" }
```

When the agent's policy has an allowlist, results are filtered to allowed services (by slug) by default. Pass `include_blocked=True` to see blocked services too — useful when you want the LLM to reason about why something isn't available. `preferred_base_url` is picked by treasury funding: the rail whose chain currently has positive USDC. Concatenate it with an endpoint `path` and pass the result to `canopy.fetch()`.

### `canopy.ping()`

Health check. Returns the agent + org snapshot:

```python
ping = canopy.ping()
# { "ok": True,
#   "agent": { "id", "name", "status", "policy_id", "policy_name" },
#   "org":   { "name", "treasury_address" },
#   "latency_ms": int }
```

Run on app startup to fail-fast on bad config.

### `canopy.budget()`

Pre-flight cap snapshot. Useful for LLM planning before expensive operations:

```python
b = canopy.budget()
# { "agent_id", "cap_usd", "spent_usd", "remaining_usd",
#   "period_hours", "period_resets_at" }
```

`cap_usd` and `remaining_usd` are `None` when no policy is bound.

### `canopy.approve(approval_id)` / `canopy.deny(approval_id)`

Mark a pending approval decided. Call from agent code when the user gives explicit consent in chat (`approve` for "yes", `deny` for "no"). The org's policy must have `chat_approval_enabled = True` (default True), or these raise `CanopyChatApprovalDisabledError` and the LLM should redirect the user to the dashboard.

```python
result = canopy.pay(to="0x...", amount_usd=5)
if result["status"] == "pending_approval":
    # ...the LLM asks the user, the user replies "approve", the LLM calls:
    decided = canopy.approve(result["approval_id"])
    # decided: { "decision", "transaction_id", "tx_hash", "signature" }
```

### `canopy.wait_for_approval(approval_id, *, timeout_ms=300_000, poll_interval_ms=2_000)`

Polls until the approval leaves `pending` or the timeout elapses. Use when the agent should block on the human deciding via the dashboard or chat. Raises `CanopyApprovalTimeoutError` on timeout. Returned status carries `x_payment_header` for x402 transactions on approve.

### `canopy.get_approval_status(approval_id)`

One-shot read. Use to poll on your own cadence.

### `canopy.get_tools()`

Returns the canonical tool list:

```python
[
    {"name": "canopy_pay", "description": "...",
     "parameters": {...JSON Schema...}, "execute": <callable>},
    {"name": "canopy_discover_services", "description": "...",
     "parameters": {...JSON Schema...}, "execute": <callable>},
    {"name": "canopy_approve", "description": "...",   # called when the user says "yes" / "approve"
     "parameters": {...}, "execute": <callable>},
    {"name": "canopy_deny", "description": "...",      # called when the user says "no" / "cancel"
     "parameters": {...}, "execute": <callable>},
]
```

Four tools by default:

| Tool | Purpose |
|---|---|
| `canopy_pay` | Send a payment from the org treasury, gated by the agent's policy. |
| `canopy_discover_services` | Find x402-paywalled services the agent can call. |
| `canopy_approve` | Mark a pending approval approved. The LLM calls this when the user replies "yes" / "approve". |
| `canopy_deny` | Mark a pending approval denied. The LLM calls this when the user replies "no" / "cancel". |

Filter the list if you only want a subset (e.g., `[t for t in canopy.get_tools() if t["name"] == "canopy_pay"]`).

## Errors

HTTP and network errors raise. Policy outcomes (`denied`, `pending_approval`) are returns.

| Exception | When | Useful attr |
|---|---|---|
| `CanopyConfigError` | Missing `api_key`, missing `agent_id`, etc. | `dashboard_url` |
| `CanopyApiError` | Server returned an unexpected status | `status`, `body`, `dashboard_url` |
| `CanopyNetworkError` | httpx itself raised (DNS/TLS/timeout) | `cause` |
| `CanopyApprovalTimeoutError` | `wait_for_approval` exhausted its timeout | `approval_id` |
| `CanopyApprovalRequiredError` | `canopy.fetch()` hit a payment that needs approval and `wait_for_approval` was off | `approval_id`, `recipient_name`, `amount_usd`, `agent_name`, `expires_at`, `chat_approval_enabled` |
| `CanopyApprovalDeniedError` | The user denied while `wait_for_approval` was blocking | `approval_id`, `transaction_id` |
| `CanopyApprovalExpiredError` | The approval expired (24h default) before a decision | `approval_id`, `transaction_id` |
| `CanopyChatApprovalDisabledError` | `canopy.approve()` / `.deny()` against a policy with `chat_approval_enabled=False` | `approval_id` |

All inherit from `CanopyError`. Most actionable errors include a `dashboard_url` pointing at the page that fixes them.

```python
from canopy_ai import CanopyError, CanopyApiError

try:
    canopy.pay(to="0x...", amount_usd=0.10)
except CanopyApiError as err:
    if err.status == 401:
        print("Bad API key. Open:", err.dashboard_url)
except CanopyError as err:
    print(f"Canopy: {err}")
```

## Local development

```python
canopy = Canopy(
    api_key=os.environ["CANOPY_API_KEY"],
    agent_id="agt_...",
    base_url="http://localhost:3000",
)
```

Use an `ak_test_…` key so prod data stays clean.

## Troubleshooting

- **`401 Invalid API key`** — regenerate in Dashboard → Settings.
- **`agent_id is required`** — pass `agent_id=` to the constructor or set `CANOPY_AGENT_ID`.
- **`denied: Recipient ... is not in the allowlist`** — edit the agent's policy in the dashboard. `discover()` will respect the same allowlist.
- **`denied: Spend cap exceeded`** — wait out the window or raise the cap. Call `canopy.budget()` to see remaining headroom.
- **`pending_approval` and your script just sits there** — for chat agents, surface `result["recipient_name"]` / `result["amount_usd"]` to the user and call `canopy.approve(id)` / `.deny(id)` when they reply. For scripted agents, call `canopy.wait_for_approval(id)` to block, or `get_approval_status(id)` to poll on your own cadence.
- **`CanopyChatApprovalDisabledError` when calling `approve()`** — the agent's policy has chat-based approval turned off. The user must approve in the dashboard.
- **`discover()` returns an empty list** — the registry might not have x402 services in that category yet. Try without `category`, or pass `include_unverified=True` to see the long tail.

## Version

`0.0.1` — alpha. Wire format is stable; small refinements possible before `1.0`.

## License

[MIT](../LICENSE)
