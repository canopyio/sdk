import { describe, expect, it } from "vitest";
import { Canopy } from "../src/index.js";
import { CanopyApiError, CanopyConfigError } from "../src/errors.js";
import { Transport } from "../src/transport.js";

describe("config errors include dashboard URLs", () => {
  it("missing apiKey points to the API keys page", () => {
    try {
      new Canopy({ apiKey: "" });
      expect.fail("expected throw");
    } catch (err) {
      const e = err as CanopyConfigError;
      expect(e).toBeInstanceOf(CanopyConfigError);
      expect(e.dashboardUrl).toBe("https://www.trycanopy.ai/dashboard/settings");
      expect(e.message).toContain("https://www.trycanopy.ai/dashboard/settings");
    }
  });

  it("missing agentId on pay() points to the agents page", async () => {
    const canopy = new Canopy({ apiKey: "ak_test_x" });
    await expect(canopy.pay({ to: "0x" + "0".repeat(40), amountUsd: 1 })).rejects.toMatchObject({
      name: "CanopyConfigError",
      dashboardUrl: "https://www.trycanopy.ai/dashboard/agents",
    });
  });

  it("derives dashboard URLs from a custom baseUrl", () => {
    try {
      new Canopy({ apiKey: "", baseUrl: "http://localhost:3000" });
      expect.fail("expected throw");
    } catch (err) {
      const e = err as CanopyConfigError;
      expect(e.dashboardUrl).toBe("http://localhost:3000/dashboard/settings");
    }
  });
});

describe("API errors include dashboard URLs by status", () => {
  function transportWith(status: number, body: unknown, baseUrl = "https://www.trycanopy.ai") {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    return new Transport(baseUrl, "ak_test_x", fakeFetch);
  }

  it("401 → API keys page", async () => {
    const t = transportWith(401, { error: "invalid api key" });
    await expect(t.request({ method: "GET", path: "/api/ping" })).rejects.toMatchObject({
      name: "CanopyApiError",
      status: 401,
      dashboardUrl: "https://www.trycanopy.ai/dashboard/settings",
    });
  });

  it("403 outside expectStatuses → API keys page", async () => {
    const t = transportWith(403, { error: "forbidden" });
    await expect(t.request({ method: "GET", path: "/api/resolve" })).rejects.toMatchObject({
      status: 403,
      dashboardUrl: "https://www.trycanopy.ai/dashboard/settings",
    });
  });

  it("404 on agents path → agents page", async () => {
    const t = transportWith(404, { error: "agent not found" });
    await expect(
      t.request({ method: "GET", path: "/api/agents/agt_missing/budget" }),
    ).rejects.toMatchObject({
      status: 404,
      dashboardUrl: "https://www.trycanopy.ai/dashboard/agents",
    });
  });

  it("500 → no dashboard URL", async () => {
    const t = transportWith(500, { error: "boom" });
    await expect(t.request({ method: "GET", path: "/api/ping" })).rejects.toMatchObject({
      status: 500,
      dashboardUrl: undefined,
    });
  });

  it("error message includes the deep-link when present", async () => {
    const t = transportWith(401, { error: "expired" });
    try {
      await t.request({ method: "GET", path: "/api/ping" });
      expect.fail("expected throw");
    } catch (err) {
      const e = err as CanopyApiError;
      expect(e.message).toContain("expired");
      expect(e.message).toContain("https://www.trycanopy.ai/dashboard/settings");
    }
  });
});
