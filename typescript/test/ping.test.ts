import { describe, expect, it } from "vitest";
import { Canopy } from "../src/index.js";

describe("canopy.ping()", () => {
  function withMockedFetch(
    handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ) {
    const original = globalThis.fetch;
    globalThis.fetch = handler as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  it("requires agentId and points to the agents page if missing", async () => {
    const canopy = new Canopy({ apiKey: "ak_test_x" });
    await expect(canopy.ping()).rejects.toMatchObject({
      name: "CanopyConfigError",
      dashboardUrl: "https://trycanopy.ai/dashboard/agents",
    });
  });

  it("returns the structured response from /api/ping", async () => {
    const restore = withMockedFetch(async (url) => {
      expect(url).toBe("https://trycanopy.ai/api/ping");
      return new Response(
        JSON.stringify({
          ok: true,
          agent: {
            id: "agt_test",
            name: "Trader",
            status: "active",
            policy_id: "pol_1",
            policy_name: "trading.default",
          },
          org: { name: "Acme", treasury_address: "0xfeed" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
      const result = await canopy.ping();
      expect(result.ok).toBe(true);
      expect(result.agent.id).toBe("agt_test");
      expect(result.agent.policyName).toBe("trading.default");
      expect(result.org.name).toBe("Acme");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      restore();
    }
  });

  it("falls back to legacy flat fields if structured agent/org missing", async () => {
    const restore = withMockedFetch(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          agent_id: "agt_test",
          agent_name: "Trader",
          status: "active",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
      const result = await canopy.ping();
      expect(result.agent.id).toBe("agt_test");
      expect(result.agent.name).toBe("Trader");
      expect(result.agent.status).toBe("active");
      expect(result.agent.policyName).toBeNull();
    } finally {
      restore();
    }
  });

  it("propagates CanopyApiError on bad key", async () => {
    const restore = withMockedFetch(async () =>
      new Response(JSON.stringify({ error: "invalid key" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    try {
      const canopy = new Canopy({ apiKey: "ak_bad", agentId: "agt_test" });
      await expect(canopy.ping()).rejects.toMatchObject({
        name: "CanopyApiError",
        status: 401,
        dashboardUrl: "https://trycanopy.ai/dashboard/settings",
      });
    } finally {
      restore();
    }
  });
});
