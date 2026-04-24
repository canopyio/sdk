import type { Transport } from "./transport.js";
import { CanopyApiError } from "./errors.js";

interface ResolveResponse {
  address?: string;
  entity?: unknown;
}

/**
 * Resolves an entity-registry slug (e.g. `agentic.market/anthropic`) to an
 * on-chain address via `/api/resolve`. Throws if the entity isn't found.
 */
export async function resolveEntity(transport: Transport, slug: string): Promise<string> {
  const { body } = await transport.request<ResolveResponse>({
    method: "GET",
    path: `/api/resolve?entity=${encodeURIComponent(slug)}`,
    expectStatuses: [200],
  });
  if (!body.address) {
    throw new CanopyApiError(200, `Entity "${slug}" has no resolved address`, body);
  }
  return body.address;
}
