import type { StarterPolicy } from "./starters.js";

export interface OrgContext {
  org_id: string;
  org_name: string | null;
  treasury_address: string | null;
  treasury_provisioned: boolean;
}

export interface CreatedPolicy {
  policy_id: string;
}

export interface CreatedAgent {
  agentId: string;
  agentUuid?: string;
  policyId?: string | null;
}

export class CanopyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "CanopyApiError";
  }
}

export class CanopyApiClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = process.env.CANOPY_BASE_URL ??
      "https://trycanopy.ai",
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new CanopyApiError(
        `Network error reaching ${this.baseUrl}${path}: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }

    if (!res.ok) {
      const message =
        (parsed as { error?: string } | undefined)?.error ??
        `${method} ${path} failed with ${res.status}`;
      throw new CanopyApiError(message, res.status, parsed);
    }

    return parsed as T;
  }

  async me(): Promise<OrgContext> {
    return this.request<OrgContext>("GET", "/api/me");
  }

  async createPolicy(policy: StarterPolicy): Promise<CreatedPolicy> {
    // Allowlist intentionally omitted — users configure allowlisted services in
    // the Canopy dashboard so they can browse the live registry. The CLI
    // creates the policy with no allowlist (open to any service).
    return this.request<CreatedPolicy>("POST", "/api/policies", {
      name: policy.name,
      description: policy.description,
      spend_cap_usd: policy.spend_cap_usd,
      cap_period_hours: policy.cap_period_hours,
      approval_required: policy.approval_required,
      approval_threshold_usd: policy.approval_threshold_usd,
    });
  }

  async createAgent(name: string, policyId: string): Promise<CreatedAgent> {
    return this.request<CreatedAgent>("POST", "/api/agents", {
      name,
      policyId,
    });
  }
}
