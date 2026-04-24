import type { CanopyConfig, PayArgs, PayResult, ApprovalStatus, WaitForApprovalOptions, ToolFramework } from "./types.js";
import { Transport } from "./transport.js";
import { CanopyConfigError } from "./errors.js";
import { encodeErc20Transfer, isEntitySlug, USDC_BASE, usdToUsdcUnits } from "./encoding.js";
import { resolveEntity } from "./resolve.js";
import { waitForApproval as waitForApprovalImpl, getApprovalStatus as getApprovalStatusImpl } from "./approval.js";
import { canopyFetch } from "./fetch.js";
import { getToolsFor } from "./tools/index.js";

const DEFAULT_BASE_URL = "https://www.trycanopy.ai";
const DEFAULT_CHAIN_ID = 8453;

interface SignResponseBody {
  signature?: string | null;
  tx_hash?: string | null;
  agent_id?: string;
  cost_usd?: string | null;
  transaction_id?: string | null;
  idempotent?: boolean;
  dry_run?: boolean;
  status?: "pending_approval";
  reason?: string;
  approval_request_id?: string;
  error?: string;
}

export class Canopy {
  private readonly transport: Transport;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  readonly agentId?: string;

  constructor(config: CanopyConfig) {
    if (!config.apiKey) {
      throw new CanopyConfigError("apiKey is required");
    }
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.transport = new Transport(this.baseUrl, this.apiKey);
  }

  /** Issue a payment, gated by the org's policy for this agent. */
  async pay(args: PayArgs): Promise<PayResult> {
    return this.signOrPreview(args, false);
  }

  /**
   * Run policy evaluation without signing or persisting a real transaction.
   * Useful for agents that want to pre-flight a payment.
   */
  async preview(args: PayArgs): Promise<PayResult> {
    return this.signOrPreview(args, true);
  }

  private async signOrPreview(args: PayArgs, dryRun: boolean): Promise<PayResult> {
    const agentId = this.agentId;
    if (!agentId) {
      throw new CanopyConfigError(
        "agentId is required for pay()/preview(). Pass it to the Canopy constructor.",
      );
    }

    const recipientAddress = isEntitySlug(args.to)
      ? await resolveEntity(this.transport, args.to)
      : args.to;

    const amountUnits = usdToUsdcUnits(args.amountUsd);
    const chainId = args.chainId ?? DEFAULT_CHAIN_ID;

    const body = {
      agent_id: agentId,
      type: "raw_transaction" as const,
      chain_id: chainId,
      recipient_address: recipientAddress,
      amount_usd: args.amountUsd,
      payload: {
        transaction: {
          to: USDC_BASE,
          data: encodeErc20Transfer(recipientAddress, amountUnits),
        },
      },
      ...(dryRun ? { dry_run: true } : {}),
    };

    const headers: Record<string, string> = {};
    if (args.idempotencyKey) headers["idempotency-key"] = args.idempotencyKey;

    const { status, body: resBody } = await this.transport.request<SignResponseBody>({
      method: "POST",
      path: "/api/sign",
      body,
      headers,
      expectStatuses: [200, 202, 403],
    });

    return this.mapSignResponse(status, resBody);
  }

  private mapSignResponse(status: number, body: SignResponseBody): PayResult {
    if (status === 200) {
      return {
        status: "allowed",
        txHash: body.tx_hash ?? null,
        signature: body.signature ?? null,
        transactionId: body.transaction_id ?? null,
        costUsd: parseCostUsd(body.cost_usd),
        ...(body.idempotent ? { idempotent: true } : {}),
        ...(body.dry_run ? { dryRun: true } : {}),
      };
    }
    if (status === 202) {
      return {
        status: "pending_approval",
        approvalId: body.approval_request_id ?? "",
        transactionId: body.transaction_id ?? "",
        reason: body.reason ?? "Approval required",
      };
    }
    // 403
    return {
      status: "denied",
      reason: body.reason ?? body.error ?? "Policy denied",
      transactionId: body.transaction_id ?? "",
    };
  }

  /** Poll an approval's current status. */
  getApprovalStatus(approvalId: string): Promise<ApprovalStatus> {
    return getApprovalStatusImpl(this.transport, approvalId);
  }

  /** Block until an approval is decided or `timeoutMs` (default 5 min) elapses. */
  waitForApproval(approvalId: string, opts?: WaitForApprovalOptions): Promise<ApprovalStatus> {
    return waitForApprovalImpl(this.transport, approvalId, opts);
  }

  /**
   * `fetch` wrapper that transparently handles HTTP 402 Payment Required
   * responses per the x402 spec.
   */
  fetch(url: string, init?: RequestInit): Promise<Response> {
    return canopyFetch(this.transport, this.agentId, url, init);
  }

  /** Returns LLM-tool schemas for the requested framework. Bind to your LLM call. */
  getTools(opts: { framework: ToolFramework }) {
    return getToolsFor(this, opts.framework);
  }
}

function parseCostUsd(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^\$/, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
