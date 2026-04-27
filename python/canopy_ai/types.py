from typing import Literal, TypedDict, Union

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
