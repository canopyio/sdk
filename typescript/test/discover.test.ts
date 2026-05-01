import { describe, expect, it } from "vitest";
import { Canopy } from "../src/index.js";

describe("canopy.discover()", () => {
  function withMockedFetch(
    handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ) {
    const original = globalThis.fetch;
    globalThis.fetch = handler as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  it("hits /api/services and returns the parsed services array", async () => {
    let capturedUrl: string | undefined;
    const restore = withMockedFetch(async (url) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          services: [
            {
              slug: "orderbook",
              name: "Orderbook Feed",
              description: "Live order book.",
              category: "data",
              logoUrl: null,
              docsUrl: null,
              paymentMethods: [
                {
                  realm: "orderbook.example",
                  baseUrl: "https://orderbook.example",
                  protocol: "x402",
                },
              ],
              endpoints: [
                {
                  method: "GET",
                  path: "/v1",
                  description: null,
                  priceAtomic: "10000",
                  currency: "USDC",
                  pricingModel: "fixed",
                  protocol: "x402",
                },
              ],
              preferredBaseUrl: "https://orderbook.example",
              policyAllowed: true,
            },
          ],
          count: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    try {
      const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
      const result = await canopy.discover({ category: "data", query: "orderbook" });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Orderbook Feed");
      expect(result[0].preferredBaseUrl).toBe("https://orderbook.example");
      expect(result[0].paymentMethods[0]?.protocol).toBe("x402");
      expect(result[0].policyAllowed).toBe(true);
      // Confirm the wire URL includes our filters and the auto-attached agent_id.
      expect(capturedUrl).toContain("category=data");
      expect(capturedUrl).toContain("q=orderbook");
      expect(capturedUrl).toContain("agent_id=agt_test");
    } finally {
      restore();
    }
  });

  it("works without an agentId (no agent_id in URL)", async () => {
    let capturedUrl: string | undefined;
    const restore = withMockedFetch(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ services: [], count: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const canopy = new Canopy({ apiKey: "ak_test_x" });
      const result = await canopy.discover();
      expect(result).toEqual([]);
      expect(capturedUrl).not.toContain("agent_id=");
    } finally {
      restore();
    }
  });

  it("forwards include_blocked and include_unverified flags", async () => {
    let capturedUrl: string | undefined;
    const restore = withMockedFetch(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ services: [], count: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
      await canopy.discover({ includeBlocked: true, includeUnverified: true, limit: 5 });
      expect(capturedUrl).toContain("include_blocked=true");
      expect(capturedUrl).toContain("include_unverified=true");
      expect(capturedUrl).toContain("limit=5");
    } finally {
      restore();
    }
  });

  it("accepts multiple categories", async () => {
    let capturedUrl: string | undefined;
    const restore = withMockedFetch(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ services: [], count: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const canopy = new Canopy({ apiKey: "ak_test_x" });
      await canopy.discover({ category: ["data", "api"] });
      expect(capturedUrl).toMatch(/category=data.*category=api|category=api.*category=data/);
    } finally {
      restore();
    }
  });
});
