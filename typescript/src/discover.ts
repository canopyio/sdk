import type { Transport } from "./transport.js";
import type {
  DiscoverArgs,
  DiscoveredService,
  ServiceEndpoint,
  ServicePaymentMethod,
} from "./types.js";

interface DiscoverResponse {
  services: Array<{
    slug: string;
    name: string;
    description: string | null;
    category: string;
    logoUrl: string | null;
    docsUrl: string | null;
    paymentMethods: ServicePaymentMethod[];
    endpoints: ServiceEndpoint[];
    preferredBaseUrl: string | null;
    policyAllowed: boolean;
  }>;
  count: number;
}

/**
 * Calls `GET /api/services` and returns the parsed list. The caller (the
 * `Canopy` client) supplies `agent_id` so the backend can apply policy-aware
 * filtering: services not on the agent's slug allowlist are filtered out by
 * default (or marked `policyAllowed: false` when `includeBlocked: true`).
 *
 * Each service's `preferredBaseUrl` is picked by treasury funding — the rail
 * whose chain has positive USDC. Use `fetch(preferredBaseUrl + endpoint.path)`
 * to call a service.
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
    category: s.category,
    logoUrl: s.logoUrl,
    docsUrl: s.docsUrl,
    paymentMethods: s.paymentMethods,
    endpoints: s.endpoints,
    preferredBaseUrl: s.preferredBaseUrl,
    policyAllowed: s.policyAllowed,
  }));
}
