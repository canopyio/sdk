from typing import Any


class CanopyError(Exception):
    """Base class for all Canopy SDK errors."""


class CanopyApiError(CanopyError):
    def __init__(
        self,
        status: int,
        message: str,
        body: Any = None,
        *,
        dashboard_url: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.body = body
        #: Dashboard URL the developer should open to fix this, if known.
        self.dashboard_url = dashboard_url


class CanopyNetworkError(CanopyError):
    def __init__(self, message: str, cause: Exception | None = None) -> None:
        super().__init__(message)
        self.cause = cause


class CanopyConfigError(CanopyError):
    def __init__(self, message: str, *, dashboard_url: str | None = None) -> None:
        super().__init__(message)
        #: Dashboard URL the developer should open to fix this, if known.
        self.dashboard_url = dashboard_url


class CanopyApprovalTimeoutError(CanopyError):
    def __init__(self, approval_id: str, timeout_ms: int) -> None:
        super().__init__(f"Approval {approval_id} did not resolve within {timeout_ms}ms")
        self.approval_id = approval_id


class CanopyApprovalRequiredError(CanopyError):
    """Raised by canopy.fetch() when a payment goes pending_approval and the
    caller did not opt into wait_for_approval."""

    def __init__(
        self,
        message: str,
        *,
        approval_id: str,
        transaction_id: str,
        recipient_name: str | None = None,
        amount_usd: float | None = None,
        agent_name: str | None = None,
        expires_at: str | None = None,
        chat_approval_enabled: bool = True,
    ) -> None:
        super().__init__(message)
        self.approval_id = approval_id
        self.transaction_id = transaction_id
        self.recipient_name = recipient_name
        self.amount_usd = amount_usd
        self.agent_name = agent_name
        self.expires_at = expires_at
        self.chat_approval_enabled = chat_approval_enabled


class CanopyApprovalDeniedError(CanopyError):
    def __init__(self, approval_id: str, transaction_id: str) -> None:
        super().__init__(f"Approval {approval_id} was denied")
        self.approval_id = approval_id
        self.transaction_id = transaction_id


class CanopyApprovalExpiredError(CanopyError):
    def __init__(self, approval_id: str, transaction_id: str) -> None:
        super().__init__(f"Approval {approval_id} expired before a decision was made")
        self.approval_id = approval_id
        self.transaction_id = transaction_id


class CanopyChatApprovalDisabledError(CanopyError):
    def __init__(self, approval_id: str, message: str | None = None) -> None:
        super().__init__(
            message
            or "Chat-based approval is disabled for this policy. Approve in the Canopy dashboard."
        )
        self.approval_id = approval_id
