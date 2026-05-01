from typing import Any, Callable, Literal, TypedDict, Union

from typing_extensions import NotRequired


class PayResultAllowed(TypedDict):
    status: Literal["allowed"]
    tx_hash: str | None
    signature: str | None
    # None when dry_run=True (no transaction persisted).
    transaction_id: str | None
    cost_usd: float | None
    idempotent: NotRequired[bool]
    dry_run: NotRequired[bool]


class PayResultPending(TypedDict):
    status: Literal["pending_approval"]
    approval_id: str
    transaction_id: str
    reason: str
    #: Resolved name of the recipient from the Canopy registry, when available.
    recipient_name: str | None
    recipient_address: str | None
    amount_usd: float | None
    agent_name: str | None
    #: ISO timestamp; the approval is auto-cancelled after this.
    expires_at: str | None
    #: When False, calling canopy.approve()/deny() will fail with CanopyChatApprovalDisabledError.
    chat_approval_enabled: bool


class PayResultDenied(TypedDict):
    status: Literal["denied"]
    reason: str
    transaction_id: str


PayResult = Union[PayResultAllowed, PayResultPending, PayResultDenied]


class ApprovalStatus(TypedDict):
    status: Literal["pending", "approved", "denied", "expired"]
    decided_at: str | None
    expires_at: str
    transaction_id: str
    #: For x402 transactions resumed after approval, the X-PAYMENT header to retry the resource URL.
    x_payment_header: str | None
    #: For MPP transactions resumed after approval, the credential to put in the ``Authorization: Payment <…>`` retry header.
    mpp_payment_header: NotRequired[str | None]


class DecideApprovalResult(TypedDict):
    decision: Literal["approved", "denied"]
    transaction_id: str | None
    tx_hash: str | None
    signature: str | None


class PingAgent(TypedDict):
    id: str
    name: str | None
    status: str
    policy_id: str | None
    policy_name: str | None


class PingOrg(TypedDict):
    name: str | None
    treasury_address: str


class PingResult(TypedDict):
    ok: Literal[True]
    agent: PingAgent
    org: PingOrg
    #: Round-trip latency in milliseconds, observed by the SDK.
    latency_ms: int


class BudgetSnapshot(TypedDict):
    agent_id: str
    #: Spend cap in USD, or None if the agent has no policy bound.
    cap_usd: float | None
    #: USD spent in the current cap window.
    spent_usd: float
    #: Remaining USD in the current window, or None if there's no cap.
    remaining_usd: float | None
    #: Cap window in hours (default 24).
    period_hours: int
    #: Timestamp when the oldest spend in the current window ages out;
    #: None if nothing has been spent yet.
    period_resets_at: str | None


class DiscoverArgs(TypedDict, total=False):
    #: Filter by one or more category slugs.
    category: str | list[str]
    #: Free-text match on service name + description.
    query: str
    #: Include verified=False long-tail entries. Default False.
    include_unverified: bool
    #: Include policy-blocked services with policy_allowed=False. Default False.
    include_blocked: bool
    #: Default 20, capped at 50 server-side.
    limit: int


class ServicePaymentMethod(TypedDict):
    realm: str
    base_url: str
    protocol: str


class ServiceEndpoint(TypedDict):
    method: str
    path: str
    description: str | None
    price_atomic: str | None
    currency: str | None
    pricing_model: str | None
    protocol: str | None


class DiscoveredService(TypedDict):
    slug: str
    name: str
    description: str | None
    category: str
    logo_url: str | None
    docs_url: str | None
    payment_methods: list[ServicePaymentMethod]
    endpoints: list[ServiceEndpoint]
    #: The base URL agents should use, picked by treasury balance.
    #: Concatenate with an endpoint `path` and pass to `canopy.fetch()`.
    preferred_base_url: str | None
    #: False only when include_blocked=True returned a service the policy blocks.
    policy_allowed: bool


class CanopyTool(TypedDict):
    """Canonical tool shape returned by `canopy.get_tools()`.

    `parameters` is a JSON Schema dict. `execute` is the bound implementation
    that calls the underlying SDK method. Sync clients return a sync callable;
    async clients return a coroutine function.
    """

    name: str
    description: str
    parameters: dict[str, Any]
    execute: Callable[..., Any]
