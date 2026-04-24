import time

from canopy_ai.errors import CanopyApprovalTimeoutError
from canopy_ai.transport import Transport
from canopy_ai.types import ApprovalStatus


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
