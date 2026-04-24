export class CanopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanopyError";
  }
}

export class CanopyApiError extends CanopyError {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "CanopyApiError";
    this.status = status;
    this.body = body;
  }
}

export class CanopyNetworkError extends CanopyError {
  cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "CanopyNetworkError";
    this.cause = cause;
  }
}

export class CanopyConfigError extends CanopyError {
  constructor(message: string) {
    super(message);
    this.name = "CanopyConfigError";
  }
}

export class CanopyApprovalTimeoutError extends CanopyError {
  approvalId: string;

  constructor(approvalId: string, timeoutMs: number) {
    super(`Approval ${approvalId} did not resolve within ${timeoutMs}ms`);
    this.name = "CanopyApprovalTimeoutError";
    this.approvalId = approvalId;
  }
}
