import type { Transport } from "./transport.js";
import type { ApprovalStatus, WaitForApprovalOptions } from "./types.js";
import { CanopyApprovalTimeoutError } from "./errors.js";

interface ApprovalStatusResponse {
  status: "pending" | "approved" | "denied" | "expired";
  decided_at: string | null;
  expires_at: string;
  transaction_id: string;
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
