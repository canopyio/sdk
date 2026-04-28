import time
from typing import Literal

from canopy_ai.errors import (
    CanopyApprovalTimeoutError,
    CanopyChatApprovalDisabledError,
)
from canopy_ai.transport import Transport
from canopy_ai.types import ApprovalStatus, DecideApprovalResult


def get_approval_status(transport: Transport, approval_id: str) -> ApprovalStatus:
    _, body = transport.request(
        "GET",
        f"/api/approvals/{approval_id}/status",
        expect_statuses=[200],
    )
    assert isinstance(body, dict)
    return ApprovalStatus(
        status=body["status"],
        decided_at=body.get("decided_at"),
        expires_at=body["expires_at"],
        transaction_id=body["transaction_id"],
        x_payment_header=body.get("x_payment_header"),
    )


def wait_for_approval(
    transport: Transport,
    approval_id: str,
    *,
    timeout_ms: int = 5 * 60 * 1000,
    poll_interval_ms: int = 2000,
) -> ApprovalStatus:
    deadline = time.monotonic() + (timeout_ms / 1000)
    while True:
        status = get_approval_status(transport, approval_id)
        if status["status"] != "pending":
            return status
        if time.monotonic() >= deadline:
            raise CanopyApprovalTimeoutError(approval_id, timeout_ms)
        time.sleep(poll_interval_ms / 1000)


def _decide(
    transport: Transport,
    approval_id: str,
    decision: Literal["approved", "denied"],
) -> DecideApprovalResult:
    status, body = transport.request(
        "POST",
        f"/api/approvals/{approval_id}/decide-by-agent",
        json={"decision": decision},
        expect_statuses=[200, 403],
    )
    assert isinstance(body, dict)
    if status == 403 and body.get("error") == "chat_approval_disabled":
        raise CanopyChatApprovalDisabledError(approval_id, body.get("message"))
    return DecideApprovalResult(
        decision=body["decision"],
        transaction_id=body.get("transaction_id"),
        tx_hash=body.get("tx_hash"),
        signature=body.get("signature"),
    )


def approve(transport: Transport, approval_id: str) -> DecideApprovalResult:
    return _decide(transport, approval_id, "approved")


def deny(transport: Transport, approval_id: str) -> DecideApprovalResult:
    return _decide(transport, approval_id, "denied")
