# canopy-ai

Python client for [Canopy](https://www.trycanopy.ai). Give your AI agent a USDC treasury on Base, gated by a policy you set in the dashboard.

```bash
pip install canopy-ai
```

Python 3.10+. Uses `httpx` for transport. `mypy --strict` passes on the library.

## Setup in 30 seconds

The fast path, after you've signed up at <https://www.trycanopy.ai> and added an agent: click **Install** on the agent's page in the dashboard to get a one-time code, then in your project (any directory):

```bash
npx @canopy-ai/sdk init <code>
```

That writes `CANOPY_API_KEY` and `CANOPY_AGENT_ID` to `.env.local` and pings to confirm the connection. (Yes, even for Python — the CLI is small and language-agnostic. The dashboard flips your agent to **Connected** in real time.)

Prefer manual setup? Dashboard → Settings → API Keys → Create (`ak_live_…`), then Dashboard → Agents → copy the `agt_…` id:

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

## Plug Canopy into your agent

Drop a payment tool into whatever framework you're using. `get_tools(framework=...)` returns ready-to-bind definitions; the `execute` / `func` callable is wired to `canopy.pay()`.

### Anthropic

```python
import os
from anthropic import Anthropic
from canopy_ai import Canopy

canopy = Canopy(
    api_key=os.environ["CANOPY_API_KEY"],
    agent_id=os.environ["CANOPY_AGENT_ID"],
)
client = Anthropic()

tools = canopy.get_tools(framework="anthropic")
schema_tools = [{k: v for k, v in t.items() if k != "execute"} for t in tools]

msg = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    tools=schema_tools,
    messages=[{"role": "user", "content": "Pay 10 cents to agentic.market/anthropic"}],
)

# Dispatch any tool_use blocks back through Canopy
for block in msg.content:
    if block.type == "tool_use":
        tool = next(t for t in tools if t["name"] == block.name)
        tool["execute"](dict(block.input))
```

### LangChain

```python
from langchain_core.tools import StructuredTool
from canopy_ai import Canopy

canopy = Canopy(
    api_key=os.environ["CANOPY_API_KEY"],
    agent_id=os.environ["CANOPY_AGENT_ID"],
)

[spec] = canopy.get_tools(framework="langchain")
pay_tool = StructuredTool.from_function(
    func=spec["func"],
    name=spec["name"],
    description=spec["description"],
    args_schema=spec["schema"],   # JSON Schema dict — no Pydantic required
)
```

### LangGraph

```python
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

# Build pay_tool exactly as in the LangChain example above, then:
agent = create_react_agent(ChatOpenAI(model="gpt-4o"), tools=[pay_tool])
agent.invoke({"messages": [{"role": "user", "content": "Send 10 cents to 0x1234..."}]})
```

### OpenAI Agents SDK

```python
import os
from agents import Agent, Runner, function_tool
from canopy_ai import Canopy

canopy = Canopy(
    api_key=os.environ["CANOPY_API_KEY"],
    agent_id=os.environ["CANOPY_AGENT_ID"],
)

@function_tool
def canopy_pay(to: str, amount_usd: float):
    """Send a USD payment from the org treasury."""
    return canopy.pay(to=to, amount_usd=amount_usd)

agent = Agent(name="Treasurer", instructions="Pay recipients when asked.", tools=[canopy_pay])
print(Runner.run_sync(agent, "Send 10 cents to 0x1234...").final_output)
```

### OpenAI (Chat Completions)

```python
import json, os
from openai import OpenAI
from canopy_ai import Canopy

canopy = Canopy(
    api_key=os.environ["CANOPY_API_KEY"],
    agent_id=os.environ["CANOPY_AGENT_ID"],
)
openai = OpenAI()
tools = canopy.get_tools(framework="openai")
schema_tools = [{k: v for k, v in t.items() if k != "execute"} for t in tools]

completion = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Send 5 cents to 0x1234..."}],
    tools=schema_tools,
)

for call in completion.choices[0].message.tool_calls or []:
    tool = next(t for t in tools if t["function"]["name"] == call.function.name)
    tool["execute"](json.loads(call.function.arguments))
```

### Pay paywalled APIs (x402)

```python
res = canopy.fetch("https://paid-api.example.com/generate-image")
# On HTTP 402, Canopy signs the payment and retries. You see the eventual 200.
```

Subject to the same agent policy as `pay()`. Non-402 responses pass through. Async version: `await async_canopy.fetch(...)`.

## Reference

### `Canopy(...)`

```python
Canopy(
    *,
    api_key: str,                    # required
    agent_id: str | None = None,     # required for pay/preview/fetch/ping/budget
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

Like `httpx.request`, but auto-pays HTTP 402 ([x402](https://x402.org)) responses. See above.

### `canopy.ping()`

Health check. Confirms the API key + agent are valid; returns a structured snapshot:

```python
ping = canopy.ping()
# { "ok": True,
#   "agent": { "id", "name", "status", "policy_id", "policy_name" },
#   "org":   { "name", "treasury_address" },
#   "latency_ms": int }
```

Run on app startup to fail-fast on bad config. Also drives the dashboard's "Connected" indicator.

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

### `canopy.get_tools(framework=...)`

Returns LLM-framework-shaped tool specs. Supported frameworks:

| Framework | Returns |
|---|---|
| `"openai"` | List of `{ type: "function", function: {...}, execute }` |
| `"anthropic"` | List of `{ name, description, input_schema, execute }` |
| `"langchain"` | List of `{ name, description, schema, func }` (use with `StructuredTool.from_function`) |
| `"vercel"` | Raises `NotImplementedError` — Vercel AI SDK is JavaScript-only |

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
- **`denied: Recipient ... is not in the allowlist`** — edit the agent's policy in the dashboard.
- **`denied: Spend cap exceeded`** — wait out the window or raise the cap. Call `canopy.budget()` to see remaining headroom.
- **`pending_approval` and your script just sits there** — call `wait_for_approval(id)` to block, or `get_approval_status(id)` to poll on your own cadence.

## Version

`0.0.1` — alpha. Wire format is stable; small refinements possible before `1.0`.

## License

[MIT](../LICENSE)
