# canopy-ai

Python client for [Canopy](https://www.trycanopy.ai). Give your AI agent a USDC treasury on Base, gated by a policy you set in the dashboard.

```bash
pip install canopy-ai
```

Python 3.10+. Uses `httpx` for transport. `mypy --strict` passes on the library.

## Setup in 30 seconds

After you've signed up at <https://www.trycanopy.ai> and added an agent:

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

result = canopy.pay(to="agentic.market/anthropic", amount_usd=0.10)

if result["status"] == "allowed":
    print("paid:", result["tx_hash"])
elif result["status"] == "pending_approval":
    decided = canopy.wait_for_approval(result["approval_id"])
    print("decision:", decided["status"])
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

Don't hardcode URLs. Let the agent find x402 services it can call:

```python
services = canopy.discover(category="data", query="orderbook")
# → [{ "name", "description", "url", "pay_to", "typical_amount_usd",
#      "policy_allowed", ... }]

feed = services[0]
if feed["policy_allowed"] and feed["url"]:
    res = canopy.fetch(feed["url"])   # 402 → auto-paid → 200 with content
```

`discover()` queries Canopy's registry of x402 services. The agent's policy filters the results — if the policy has an allowlist, only services on that list are returned. Pass `include_blocked=True` to see blocked services too (with `policy_allowed: False`).

## Plug Canopy into your agent

`canopy.get_tools()` returns the canonical tool list — `canopy_pay` and `canopy_discover_services` — as `[{ name, description, parameters: JSONSchema, execute }]`. Most frameworks consume this shape directly. For OpenAI / Anthropic, wrap with a one-line transform.

| Framework | Fit | Recipe |
|---|---|---|
| LangChain | Direct (JSON Schema dict, no Pydantic required) | [↓](#langchain) |
| LangGraph | Direct (via LangChain `StructuredTool`) | [↓](#langgraph) |
| OpenAI Agents SDK | Direct (decorator pattern) | [↓](#openai-agents-sdk) |
| OpenAI Chat Completions | One-line wrap | [↓](#openai-chat-completions) |
| Anthropic Messages | One-line wrap | [↓](#anthropic) |
| MCP host (Claude Desktop, Cursor, Cline, Windsurf) | No code — install [`@canopy-ai/mcp`](../mcp) | — |

If your framework isn't listed but accepts a tool definition with JSON Schema + a Python callable, our canonical shape works directly. If it expects a different envelope (like OpenAI/Anthropic), wrap with a list-comprehension.

### LangChain

```python
from langchain_core.tools import StructuredTool
from canopy_ai import Canopy

canopy = Canopy(api_key=os.environ["CANOPY_API_KEY"], agent_id=os.environ["CANOPY_AGENT_ID"])

lc_tools = [
    StructuredTool.from_function(
        func=t["execute"],
        name=t["name"],
        description=t["description"],
        args_schema=t["parameters"],   # JSON Schema dict — no Pydantic required
    )
    for t in canopy.get_tools()
]
```

### LangGraph

```python
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

# Build lc_tools as in the LangChain example above, then:
agent = create_react_agent(ChatOpenAI(model="gpt-4o"), tools=lc_tools)
agent.invoke({
    "messages": [{"role": "user", "content": "Find a data feed and pull BTC orderbook depth."}],
})
```

### OpenAI Agents SDK

```python
import os
from agents import Agent, Runner, function_tool
from canopy_ai import Canopy

canopy = Canopy(api_key=os.environ["CANOPY_API_KEY"], agent_id=os.environ["CANOPY_AGENT_ID"])

@function_tool
def canopy_pay(to: str, amount_usd: float):
    """Send a USD payment from the org treasury."""
    return canopy.pay(to=to, amount_usd=amount_usd)

@function_tool
def canopy_discover_services(category: str | None = None, query: str | None = None):
    """List paid services the agent can call."""
    return canopy.discover(
        **{k: v for k, v in {"category": category, "query": query}.items() if v},
    )

agent = Agent(
    name="Treasurer",
    instructions="Pay recipients and discover x402 services when asked.",
    tools=[canopy_pay, canopy_discover_services],
)
print(Runner.run_sync(agent, "Find data feeds and use the cheapest.").final_output)
```

### OpenAI (Chat Completions)

OpenAI's tool format wraps each entry in `{"type": "function", "function": { ... }}`. One-line transform:

```python
import json, os
from openai import OpenAI
from canopy_ai import Canopy

canopy = Canopy(api_key=os.environ["CANOPY_API_KEY"], agent_id=os.environ["CANOPY_AGENT_ID"])
openai = OpenAI()
tools = canopy.get_tools()

openai_tools = [
    {
        "type": "function",
        "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]},
    }
    for t in tools
]

completion = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Discover data feeds and pay for BTC orderbook."}],
    tools=openai_tools,
)

for call in completion.choices[0].message.tool_calls or []:
    t = next(x for x in tools if x["name"] == call.function.name)
    t["execute"](json.loads(call.function.arguments))
```

### Anthropic

Anthropic's Messages API renames `parameters` → `input_schema`. One-line transform:

```python
import os
from anthropic import Anthropic
from canopy_ai import Canopy

canopy = Canopy(api_key=os.environ["CANOPY_API_KEY"], agent_id=os.environ["CANOPY_AGENT_ID"])
client = Anthropic()
tools = canopy.get_tools()

anthropic_tools = [
    {"name": t["name"], "description": t["description"], "input_schema": t["parameters"]}
    for t in tools
]

msg = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    tools=anthropic_tools,
    messages=[{"role": "user", "content": "Discover x402 data feeds and pay for one."}],
)

for block in msg.content:
    if block.type == "tool_use":
        t = next(x for x in tools if x["name"] == block.name)
        t["execute"](dict(block.input))
```

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
    base_url: str | None = None,     # default: https://www.trycanopy.ai
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
{"status": "pending_approval", "approval_id": str, "transaction_id": str, "reason": str}

# Denied
{"status": "denied", "reason": str, "transaction_id": str}
```

- **`to`**: a `0x…` address or a registry slug like `"agentic.market/anthropic"`.
- **`idempotency_key`** *(optional)*: stable string for retries you don't fully control (webhook handlers, framework retries). Subsequent calls with the same key on the same agent return the cached result without re-charging.

### `canopy.preview(...)`

Same signature and return shape as `pay()`, but evaluates the policy without signing or persisting.

### `canopy.fetch(url, *, method="GET", headers=None, content=None)`

Like `httpx.request`, but auto-pays HTTP 402 ([x402](https://x402.org)) responses. Same agent policy applies.

### `canopy.discover(**kwargs)`

Find x402-paywalled services the agent can call.

```python
services = canopy.discover(
    category="data",          # or list of categories; optional
    query="orderbook",        # optional free-text match
    limit=20,                 # optional, default 20, capped at 50
    include_blocked=False,    # include policy-blocked services with policy_allowed=False
    include_unverified=False, # include long-tail unverified entries
)
# → list[DiscoveredService]
#   { "slug", "name", "description", "url", "category",
#     "payment_protocol", "typical_amount_usd", "pay_to", "policy_allowed" }
```

When the agent's policy has an allowlist, results are filtered to allowed payees by default. Pass `include_blocked=True` to see blocked services too — useful when you want the LLM to reason about why something isn't available.

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

### `canopy.wait_for_approval(approval_id, *, timeout_ms=300_000, poll_interval_ms=2_000)`

Polls until the approval leaves `pending` or the timeout elapses. Raises `CanopyApprovalTimeoutError` on timeout.

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
]
```

Filter the list if you only want one (e.g., `[t for t in canopy.get_tools() if t["name"] == "canopy_pay"]`).

## Errors

HTTP and network errors raise. Policy outcomes (`denied`, `pending_approval`) are returns.

| Exception | When | Useful attr |
|---|---|---|
| `CanopyConfigError` | Missing `api_key`, missing `agent_id`, etc. | `dashboard_url` |
| `CanopyApiError` | Server returned an unexpected status | `status`, `body`, `dashboard_url` |
| `CanopyNetworkError` | httpx itself raised (DNS/TLS/timeout) | `cause` |
| `CanopyApprovalTimeoutError` | `wait_for_approval` exhausted its timeout | `approval_id` |

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
- **`pending_approval` and your script just sits there** — call `wait_for_approval(id)` to block, or `get_approval_status(id)` to poll on your own cadence.
- **`discover()` returns an empty list** — the registry might not have x402 services in that category yet. Try without `category`, or pass `include_unverified=True` to see the long tail.

## Version

`0.0.1` — alpha. Wire format is stable; small refinements possible before `1.0`.

## License

[MIT](../LICENSE)
