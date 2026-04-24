export interface CanopyConfig {
  apiKey: string;
  agentId?: string;
  baseUrl?: string;
}

export interface PayArgs {
  /** Recipient: either an `0x…` address or an entity-registry slug like `agentic.market/anthropic`. */
  to: string;
  /** Amount in USD. Policy engine enforces caps and approval thresholds against this. */
  amountUsd: number;
  /** Defaults to 8453 (Base mainnet). Only Base is supported for MVP. */
  chainId?: number;
  /**
   * Opt-in retry safety. If provided, a repeat `pay()` call with the same key on the
   * same agent returns the cached decision without re-charging the cap.
   */
  idempotencyKey?: string;
}

export type PayResult =
  | {
      status: "allowed";
      txHash: string | null;
      signature: string | null;
      /** Null when dryRun=true (no transaction persisted). */
      transactionId: string | null;
      costUsd: number | null;
      idempotent?: boolean;
      dryRun?: boolean;
    }
  | {
      status: "pending_approval";
      approvalId: string;
      transactionId: string;
      reason: string;
    }
  | {
      status: "denied";
      reason: string;
      transactionId: string;
    };

export interface ApprovalStatus {
  status: "pending" | "approved" | "denied" | "expired";
  decidedAt: string | null;
  expiresAt: string;
  transactionId: string;
}

export interface WaitForApprovalOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export type ToolFramework = "openai" | "anthropic" | "vercel" | "langchain";
