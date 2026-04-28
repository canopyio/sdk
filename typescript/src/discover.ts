import type { Transport } from "./transport.js";
import type { DiscoverArgs, DiscoveredService } from "./types.js";

interface DiscoverResponse {
  services: Array<{
    slug: string;
    name: string;
    description: string | null;
    url: string | null;
    category: string;
    paymentProtocol: string | null;
    typicalAmountUsd: number | null;
    payTo: string;
    policyAllowed: boolean;
  }>;
  count: number;
}

/**
 * Calls `GET /api/services` and returns the parsed list. The caller (the
 * `Canopy` client) supplies `agent_id` so the backend can apply policy-aware
 * filtering: services not on the agent's allowlist are filtered out by
 * default (or marked `policyAllowed: false` when `includeBlocked: true`).
 */
export async function discover(
  transport: Transport,
  agentId: string | undefined,
  args: DiscoverArgs = {},
): Promise<DiscoveredService[]> {
  const params = new URLSearchParams();
  if (args.category) {
    const cats = Array.isArray(args.category) ? args.category : [args.category];
    for (const c of cats) params.append("category", c);
  }
  if (args.query) params.set("q", args.query);
  if (args.includeUnverified) params.set("include_unverified", "true");
  if (args.includeBlocked) params.set("include_blocked", "true");
  if (args.limit !== undefined) params.set("limit", String(args.limit));
  if (agentId) params.set("agent_id", agentId);

  const path = `/api/services${params.toString() ? `?${params.toString()}` : ""}`;
  const { body } = await transport.request<DiscoverResponse>({
    method: "GET",
    path,
    expectStatuses: [200],
  });

  return body.services.map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
    url: s.url,
    category: s.category,
    paymentProtocol: s.paymentProtocol,
    typicalAmountUsd: s.typicalAmountUsd,
    payTo: s.payTo,
    policyAllowed: s.policyAllowed,
  }));
}
