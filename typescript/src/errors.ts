export class CanopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanopyError";
  }
}

export class CanopyApiError extends CanopyError {
  status: number;
  body: unknown;
  /** Dashboard URL the developer should open to fix this, if known. */
  dashboardUrl?: string;

  constructor(status: number, message: string, body?: unknown, dashboardUrl?: string) {
    super(message);
    this.name = "CanopyApiError";
    this.status = status;
    this.body = body;
    this.dashboardUrl = dashboardUrl;
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
  /** Dashboard URL the developer should open to fix this, if known. */
  dashboardUrl?: string;

  constructor(message: string, dashboardUrl?: string) {
    super(message);
    this.name = "CanopyConfigError";
    this.dashboardUrl = dashboardUrl;
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

export class CanopyApprovalRequiredError extends CanopyError {
  approvalId: string;
  transactionId: string;
  recipientName: string | null;
  amountUsd: number | null;
  agentName: string | null;
  expiresAt: string | null;
  chatApprovalEnabled: boolean;

  constructor(args: {
    message: string;
    approvalId: string;
    transactionId: string;
    recipientName?: string | null;
    amountUsd?: number | null;
    agentName?: string | null;
    expiresAt?: string | null;
    chatApprovalEnabled?: boolean;
  }) {
    super(args.message);
    this.name = "CanopyApprovalRequiredError";
    this.approvalId = args.approvalId;
    this.transactionId = args.transactionId;
    this.recipientName = args.recipientName ?? null;
    this.amountUsd = args.amountUsd ?? null;
    this.agentName = args.agentName ?? null;
    this.expiresAt = args.expiresAt ?? null;
    this.chatApprovalEnabled = args.chatApprovalEnabled ?? true;
  }
}

export class CanopyApprovalDeniedError extends CanopyError {
  approvalId: string;
  transactionId: string;

  constructor(approvalId: string, transactionId: string) {
    super(`Approval ${approvalId} was denied`);
    this.name = "CanopyApprovalDeniedError";
    this.approvalId = approvalId;
    this.transactionId = transactionId;
  }
}

export class CanopyApprovalExpiredError extends CanopyError {
  approvalId: string;
  transactionId: string;

  constructor(approvalId: string, transactionId: string) {
    super(`Approval ${approvalId} expired before a decision was made`);
    this.name = "CanopyApprovalExpiredError";
    this.approvalId = approvalId;
    this.transactionId = transactionId;
  }
}

export class CanopyChatApprovalDisabledError extends CanopyError {
  approvalId: string;

  constructor(approvalId: string, message?: string) {
    super(
      message ??
        `Chat-based approval is disabled for this policy. Approve in the Canopy dashboard.`,
    );
    this.name = "CanopyChatApprovalDisabledError";
    this.approvalId = approvalId;
  }
}
