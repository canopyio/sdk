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
      /** Resolved name of the recipient from the Canopy registry, when available. */
      recipientName: string | null;
      recipientAddress: string | null;
      amountUsd: number | null;
      agentName: string | null;
      /** ISO timestamp; the approval is auto-cancelled after this. */
      expiresAt: string | null;
      /** When false, calling canopy.approve()/deny() will fail with CanopyChatApprovalDisabledError. */
      chatApprovalEnabled: boolean;
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
  /** For x402 transactions resumed after approval, the X-PAYMENT header to retry the resource URL. */
  xPaymentHeader: string | null;
}

export interface WaitForApprovalOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface CanopyFetchOptions {
  /**
   * If `false` (default), `canopy.fetch()` throws `CanopyApprovalRequiredError`
   * when a payment goes pending_approval — the caller decides what to do.
   *
   * If `true` or a number of milliseconds, the SDK polls until the approval is
   * decided, then either retries the URL with the recovered `X-PAYMENT` header
   * (on approve) or throws `CanopyApprovalDeniedError` / `CanopyApprovalExpiredError`.
   */
  waitForApproval?: boolean | number;
}

export interface DecideApprovalResult {
  decision: "approved" | "denied";
  transactionId: string | null;
  txHash: string | null;
  signature: string | null;
}

/**
 * Canonical tool shape returned by `canopy.getTools()`. Works directly with
 * Vercel AI SDK, LangChain, Mastra, and MCP. For OpenAI / Anthropic, the
 * READMEs show one-line wrap recipes (their APIs use slightly different
 * envelope shapes).
 *
 * `parameters` is a JSON Schema object. `execute` is the bound implementation
 * that calls the underlying SDK method.
 */
export interface CanopyTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  // `any` here is deliberate: the framework you bind these to (Vercel AI,
  // LangChain, etc.) supplies its own typed wrapper at the boundary, so
  // narrowing here would just create assignment friction without adding
  // safety. Internal builders construct typed args before calling.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (args: any) => Promise<unknown>;
}

export interface DiscoverArgs {
  /** Filter by one or more category slugs (e.g. `"data"`, `"api"`). */
  category?: string | string[];
  /** Free-text match on service name + description. */
  query?: string;
  /** Include `verified = false` services from the long tail. Default false. */
  includeUnverified?: boolean;
  /** Include services blocked by the agent's policy, marked `policyAllowed: false`. Default false. */
  includeBlocked?: boolean;
  /** Default 20, capped at 50 server-side. */
  limit?: number;
}

export interface DiscoveredService {
  slug: string;
  name: string;
  description: string | null;
  /** The endpoint to hit with `canopy.fetch(url)`. May be `null` for entries without a known URL. */
  url: string | null;
  category: string;
  paymentProtocol: string | null;
  /** Hint cost — actual price comes from the 402 response. */
  typicalAmountUsd: number | null;
  /** On-chain `payTo` address. */
  payTo: string;
  /** False only when `includeBlocked: true` returned a service the policy blocks. */
  policyAllowed: boolean;
}

export interface BudgetSnapshot {
  agentId: string;
  /** Spend cap in USD, or `null` if the agent has no policy bound. */
  capUsd: number | null;
  /** USD spent in the current cap window. */
  spentUsd: number;
  /** Remaining USD in the current window, or `null` if there's no cap. */
  remainingUsd: number | null;
  /** Cap window in hours (default 24). */
  periodHours: number;
  /**
   * Timestamp when the oldest spend in the current window ages out (so the
   * agent regains some headroom). `null` if nothing has been spent yet.
   */
  periodResetsAt: string | null;
}

export interface PingResult {
  ok: true;
  agent: {
    id: string;
    name: string | null;
    status: string;
    policyId: string | null;
    policyName: string | null;
  };
  org: {
    name: string | null;
    treasuryAddress: string;
  };
  /** Round-trip latency in milliseconds, observed by the SDK. */
  latencyMs: number;
}
