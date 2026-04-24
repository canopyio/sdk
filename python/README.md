# canopy-ai

Python client for [Canopy](https://www.trycanopy.ai) — org treasury wallets with agent-level policy-gated spending.

```bash
pip install canopy-ai
```

Requires Python 3.10+. Uses `httpx` for transport.

## Setup

1. **Create an org** at <https://www.trycanopy.ai> — sign up with Clerk, Canopy auto-provisions a treasury wallet and a default spending policy.
2. **Generate an API key**: Dashboard → Settings → API Keys → Create. Copy the `ak_live_…` string (shown once).
3. **Create an agent**: Dashboard → Agents → Add Agent. You get an `agt_…` id; spend is attributed to that agent and funded by the org treasury.
4. **Set env vars**:
   ```bash
   export CANOPY_API_KEY=ak_live_xxxxxxxxxxxxxxxx
   export CANOPY_AGENT_ID=agt_xxxxxxxx
   ```

## Minimal example

```python
import os
from canopy_ai import Canopy

canopy = Canopy(
    api_key=os.environ["CANOPY_API_KEY"],
    agent_id=os.environ["CANOPY_AGENT_ID"],
)

result = canopy.pay(
    to="0x1111222233334444555566667777888899990000",
    amount_usd=0.10,
)

if result["status"] == "allowed":
    print("tx submitted:", result["tx_hash"])
elif result["status"] == "pending_approval":
    print("approval required:", result["reason"])
    decided = canopy.wait_for_approval(result["approval_id"])
    print("approval decided:", decided["status"])
elif result["status"] == "denied":
    print("policy denied:", result["reason"])
```

Results are `TypedDict`s with a `status` key — a discriminated union. Your type checker will narrow the other fields based on the `status` literal.

## API

### `Canopy(...)`

```python
Canopy(
    *,
    api_key: str,                # CANOPY_API_KEY
    agent_id: str | None = None, # required for pay() / preview() / fetch()
    base_url: str | None = None, # default: https://www.trycanopy.ai
    http_client: httpx.Client | None = None,
)
```

Pass a custom `httpx.Client` if you need to plug in proxies, custom timeouts, or mock transports (the test suite does this).

### `canopy.pay(...)`

Issue a payment.

```python
canopy.pay(
    *,
    to: str,                       # 0x… OR registry slug like "agentic.market/anthropic"
    amount_usd: float,             # USD, e.g. 0.10
    chain_id: int | None = None,   # default 8453 (Base mainnet)
    idempotency_key: str | None = None,
) -> PayResult
```

Return shape — a typed union:

```python
# Allowed
{
    "status": "allowed",
    "tx_hash": str | None,
    "signature": str | None,
    "transaction_id": str | None,  # None only when dry_run=True
    "cost_usd": float | None,
    "idempotent": bool,              # optional, present only when cached replay
    "dry_run": bool,                 # optional, present only in preview() results
}

# Pending
{
    "status": "pending_approval",
    "approval_id": str,
    "transaction_id": str,
    "reason": str,
}

# Denied
{
    "status": "denied",
    "reason": str,
    "transaction_id": str,
}
```

**`to` accepts**

- A 20-byte hex address: `0x1234567890123456789012345678901234567890`
- A registry slug: `agentic.market/anthropic`. Resolved via `/api/resolve` before signing.

**`idempotency_key`** — pass a stable string when retrying against external triggers (webhooks, framework retries). Subsequent calls with the same key on the same agent return the cached result without double-charging the cap.

### `canopy.preview(...)`

Same signature and return shape as `pay()`, but evaluates the policy without signing or persisting. Use this when an agent wants to pre-flight a payment before committing.

```python
check = canopy.preview(to="0x...", amount_usd=50.0)
if check["status"] == "denied":
    # Warn the user before we even try.
    ...
```

### `canopy.fetch(url, ...)`

HTTP client that auto-handles [x402](https://x402.org) payments.

```python
res = canopy.fetch("https://paid-api.example.com/generate-image")
# If the server returns 402, Canopy signs the payment and retries.
# You just see the eventual 200.
```

Signature:

```python
canopy.fetch(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    content: Any = None,
) -> httpx.Response
```

Only 402 responses in the x402 `paymentRequirements` format (`scheme="exact"`, `network="base"`) are auto-paid. Everything else passes through unchanged.

### `canopy.wait_for_approval(approval_id, ...)`

Poll until the approval leaves `pending` or the timeout elapses.

```python
decided = canopy.wait_for_approval(
    result["approval_id"],
    timeout_ms=5 * 60_000,    # default
    poll_interval_ms=2_000,   # default
)
# decided["status"] is "approved" | "denied" | "expired"
```

Raises `CanopyApprovalTimeoutError` if the timeout hits.

### `canopy.get_tools(framework=...)`

Returns LLM-framework-shaped tool definitions bound to this Canopy instance.

```python
tools = canopy.get_tools(framework="openai")
```

Supported values (day 1): `"openai"` only. `"anthropic"`, `"vercel"`, `"langchain"` are reserved and raise `NotImplementedError` today.

## LLM integration examples

### OpenAI

```python
import os
from openai import OpenAI
from canopy_ai import Canopy

canopy = Canopy(
    api_key=os.environ["CANOPY_API_KEY"],
    agent_id=os.environ["CANOPY_AGENT_ID"],
)
openai = OpenAI()
tools = canopy.get_tools(framework="openai")

# Strip the execute callable — OpenAI only wants the schema
schema_tools = [{k: v for k, v in t.items() if k != "execute"} for t in tools]

completion = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Send 5 cents to 0x1234..."}],
    tools=schema_tools,
)

# Dispatch any tool calls back through Canopy
import json
for call in completion.choices[0].message.tool_calls or []:
    tool = next(t for t in tools if t["function"]["name"] == call.function.name)
    tool["execute"](json.loads(call.function.arguments))
```

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

msg = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    tools=[{
        "name": "canopy_pay",
        "description": "Send a USD payment from the org treasury.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string"},
                "amountUsd": {"type": "number"},
            },
            "required": ["to", "amountUsd"],
        },
    }],
    messages=[{"role": "user", "content": "Pay 10 cents to 0x1234..."}],
)

# Inspect msg.stop_reason; if "tool_use", dispatch via canopy.pay(...)
```

### LangChain

LangChain support is in the `"langchain"` framework (coming soon). For now, wrap `canopy.pay` as a `StructuredTool` by hand:

```python
from langchain_core.tools import StructuredTool
from pydantic import BaseModel

class PayArgs(BaseModel):
    to: str
    amount_usd: float

def canopy_pay(to: str, amount_usd: float):
    return canopy.pay(to=to, amount_usd=amount_usd)

canopy_tool = StructuredTool.from_function(
    func=canopy_pay,
    name="canopy_pay",
    description="Send a USD payment from the org treasury.",
    args_schema=PayArgs,
)
```

### LangGraph

[LangGraph](https://langchain-ai.github.io/langgraph/) is the recommended successor to LangChain's legacy `AgentExecutor`. Use the same `StructuredTool` pattern as above, then hand it to `create_react_agent`.

```bash
pip install canopy-ai langgraph langchain-openai
```

```python
import os
from canopy_ai import Canopy
from langchain_core.tools import StructuredTool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from pydantic import BaseModel

canopy = Canopy(
    api_key=os.environ["CANOPY_API_KEY"],
    agent_id=os.environ["CANOPY_AGENT_ID"],
)

class PayArgs(BaseModel):
    to: str
    amount_usd: float

def pay(to: str, amount_usd: float):
    return canopy.pay(to=to, amount_usd=amount_usd)

pay_tool = StructuredTool.from_function(
    func=pay,
    name="canopy_pay",
    description="Send a USD payment from the org treasury.",
    args_schema=PayArgs,
)

agent = create_react_agent(
    ChatOpenAI(model="gpt-4o"),
    tools=[pay_tool],
)
agent.invoke({"messages": [{"role": "user", "content": "Send 10 cents to 0x1234..."}]})
```

### OpenAI Agents SDK

[`openai-agents`](https://github.com/openai/openai-agents-python) is OpenAI's official agent framework — distinct from Chat Completions. Decorate a plain function with `@function_tool` and hand it to `Agent(...)`.

```bash
pip install canopy-ai openai-agents
```

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

agent = Agent(
    name="Treasurer",
    instructions="Pay recipients when asked.",
    tools=[canopy_pay],
)
result = Runner.run_sync(agent, "Send 10 cents to 0x1234...")
print(result.final_output)
```

## Errors

HTTP and network errors raise. Policy outcomes are returns.

| Exception | When |
|---|---|
| `CanopyConfigError` | Constructor args invalid (missing `api_key`, no `agent_id` on `pay()`). |
| `CanopyApiError` | Server returned a status outside `[200, 202, 403]`. Has `.status` and `.body`. |
| `CanopyNetworkError` | httpx itself raised (DNS, TLS, timeout). Has `.cause`. |
| `CanopyApprovalTimeoutError` | `wait_for_approval` exhausted its timeout. |

All inherit from `CanopyError`.

```python
from canopy_ai import Canopy, CanopyError, CanopyApiError

try:
    canopy.pay(to="0x...", amount_usd=0.10)
except CanopyApiError as err:
    if err.status == 401:
        print("Check your CANOPY_API_KEY")
except CanopyError as err:
    print(f"Canopy: {err}")
```

## Local development

Point the SDK at a locally-running canopy-app:

```python
canopy = Canopy(
    api_key=os.environ["CANOPY_API_KEY"],
    agent_id="agt_...",
    base_url="http://localhost:3000",
)
```

Use a test-mode key (`ak_test_...`) so prod data stays clean.

## Chains and tokens

Day 1: USDC on Base mainnet (chain 8453). The SDK hand-builds `ERC20.transfer(to, amount)` calldata and submits via the org treasury wallet.

The treasury wallet needs a tiny ETH balance for gas (~$0.50 of Base ETH is plenty for hundreds of txs). Fund the treasury address shown in the dashboard.

Other chains / tokens: the `chain_id` arg is passed through but only Base USDC is tested today.

## Typing

All public surfaces are typed. `TypedDict` return shapes give you narrowing on `status`:

```python
from canopy_ai.types import PayResult

result: PayResult = canopy.pay(to="...", amount_usd=0.10)
if result["status"] == "allowed":
    # type checker knows result is PayResultAllowed here
    reveal_type(result["tx_hash"])  # str | None
```

`mypy --strict` passes on the library.

## Development

```bash
pip install -e '.[dev]'
pytest           # runs the shared-fixture replay suite
mypy canopy_ai  # strict mode
ruff check       # lint
```

The test suite replays the JSON fixtures in `../shared/fixtures/` against a mocked httpx transport, asserting the SDK sends the correct wire format and returns the expected structured value. The TS SDK runs the same fixtures — both must pass.

## Troubleshooting

**`CanopyApiError: 401 Invalid API key`** — key missing, wrong, or revoked. Regenerate in the dashboard.

**`CanopyApiError: 503 Privy is not configured`** — the canopy-app server doesn't have `PRIVY_APP_ID` set.

**`CanopyConfigError: agent_id is required`** — pass `agent_id=` to the `Canopy` constructor.

**`denied` with `Recipient ... is not in the allowlist`** — the agent's policy has an allowlist. Edit it in the dashboard.

**`denied` with `Spend cap exceeded`** — wait out the cap window or raise the cap in the dashboard.

## Version

`0.0.1` — alpha. Wire format is stable; API surface may see small refinements before `1.0`.

## License

[MIT](../LICENSE)
