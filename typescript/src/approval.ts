import type { Transport } from "./transport.js";
import type {
  ApprovalStatus,
  DecideApprovalResult,
  WaitForApprovalOptions,
} from "./types.js";
import {
  CanopyApprovalTimeoutError,
  CanopyChatApprovalDisabledError,
} from "./errors.js";

interface ApprovalStatusResponse {
  status: "pending" | "approved" | "denied" | "expired";
  decided_at: string | null;
  expires_at: string;
  transaction_id: string;
  x_payment_header: string | null;
  mpp_payment_header?: string | null;
}

export async function getApprovalStatus(
  transport: Transport,
  approvalId: string,
): Promise<ApprovalStatus> {
  const { body } = await transport.request<ApprovalStatusResponse>({
    method: "GET",
    path: `/api/approvals/${approvalId}/status`,
    expectStatuses: [200],
  });
  return {
    status: body.status,
    decidedAt: body.decided_at,
    expiresAt: body.expires_at,
    transactionId: body.transaction_id,
    xPaymentHeader: body.x_payment_header ?? null,
    mppPaymentHeader: body.mpp_payment_header ?? null,
  };
}

/**
 * Polls the approval's status until it leaves `pending`, timing out after
 * `timeoutMs` (default 5 minutes). Polling interval is 2s by default.
 */
export async function waitForApproval(
  transport: Transport,
  approvalId: string,
  opts: WaitForApprovalOptions = {},
): Promise<ApprovalStatus> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const status = await getApprovalStatus(transport, approvalId);
    if (status.status !== "pending") return status;
    if (Date.now() >= deadline) {
      throw new CanopyApprovalTimeoutError(approvalId, timeoutMs);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

interface DecideApprovalResponseBody {
  decision: "approved" | "denied";
  transaction_id: string | null;
  tx_hash: string | null;
  signature: string | null;
  x_payment_header?: string | null;
  /** Present on the chat-approval-disabled 403 response. */
  error?: string;
  message?: string;
}

async function decide(
  transport: Transport,
  approvalId: string,
  decision: "approved" | "denied",
): Promise<DecideApprovalResult> {
  const { status, body } = await transport.request<DecideApprovalResponseBody>({
    method: "POST",
    path: `/api/approvals/${approvalId}/decide-by-agent`,
    body: { decision },
    expectStatuses: [200, 403],
  });

  if (status === 403 && body.error === "chat_approval_disabled") {
    throw new CanopyChatApprovalDisabledError(approvalId, body.message);
  }

  return {
    decision: body.decision,
    transactionId: body.transaction_id,
    txHash: body.tx_hash,
    signature: body.signature,
  };
}

export async function approve(
  transport: Transport,
  approvalId: string,
): Promise<DecideApprovalResult> {
  return decide(transport, approvalId, "approved");
}

export async function deny(
  transport: Transport,
  approvalId: string,
): Promise<DecideApprovalResult> {
  return decide(transport, approvalId, "denied");
}
