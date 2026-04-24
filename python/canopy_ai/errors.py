from typing import Any


class CanopyError(Exception):
    """Base class for all Canopy SDK errors."""


class CanopyApiError(CanopyError):
    def __init__(self, status: int, message: str, body: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class CanopyNetworkError(CanopyError):
    def __init__(self, message: str, cause: Exception | None = None) -> None:
        super().__init__(message)
        self.cause = cause


class CanopyConfigError(CanopyError):
    pass


class CanopyApprovalTimeoutError(CanopyError):
    def __init__(self, approval_id: str, timeout_ms: int) -> None:
        super().__init__(f"Approval {approval_id} did not resolve within {timeout_ms}ms")
        self.approval_id = approval_id
