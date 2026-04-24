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
