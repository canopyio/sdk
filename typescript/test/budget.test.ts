import { describe, expect, it } from "vitest";
import { Canopy } from "../src/index.js";

describe("canopy.budget()", () => {
  function withMockedFetch(
    handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ) {
    const original = globalThis.fetch;
    globalThis.fetch = handler as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  it("requires agentId", async () => {
    const canopy = new Canopy({ apiKey: "ak_test_x" });
    await expect(canopy.budget()).rejects.toMatchObject({
      name: "CanopyConfigError",
      dashboardUrl: "https://www.trycanopy.ai/dashboard/agents",
    });
  });

  it("hits /api/agents/{id}/budget and maps the response to camelCase", async () => {
    const restore = withMockedFetch(async (url) => {
      expect(url).toBe("https://www.trycanopy.ai/api/agents/agt_test/budget");
      return new Response(
        JSON.stringify({
          agent_id: "agt_test",
          cap_usd: 5,
          spent_usd: 1.25,
          remaining_usd: 3.75,
          period_hours: 24,
          period_resets_at: "2026-04-28T12:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
      const result = await canopy.budget();
      expect(result.capUsd).toBe(5);
      expect(result.spentUsd).toBe(1.25);
      expect(result.remainingUsd).toBe(3.75);
      expect(result.periodHours).toBe(24);
      expect(result.periodResetsAt).toBe("2026-04-28T12:00:00.000Z");
    } finally {
      restore();
    }
  });

  it("handles unbounded cap (no policy bound)", async () => {
    const restore = withMockedFetch(async () => {
      return new Response(
        JSON.stringify({
          agent_id: "agt_test",
          cap_usd: null,
          spent_usd: 0,
          remaining_usd: null,
          period_hours: 24,
          period_resets_at: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
      const result = await canopy.budget();
      expect(result.capUsd).toBeNull();
      expect(result.remainingUsd).toBeNull();
      expect(result.periodResetsAt).toBeNull();
    } finally {
      restore();
    }
  });
});
