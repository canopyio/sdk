import { describe, expect, it } from "vitest";
import { Canopy } from "../src/index.js";
import { Transport } from "../src/transport.js";

/**
 * `canopy.getTools()` returns canonical tools — { name, description,
 * parameters (JSON Schema), execute }. We assert the shape and that the
 * `execute` callable hits the right wire path through the SDK.
 */

function fakeTransport(captured: { body?: unknown; path?: string; url?: string }) {
  const fakeFetch: typeof fetch = async (input, init) => {
    captured.body = init?.body ? JSON.parse(init.body as string) : undefined;
    captured.url = typeof input === "string" ? input : input.toString();
    captured.path = new URL(captured.url).pathname + new URL(captured.url).search;
    if (captured.path?.startsWith("/api/services")) {
      return new Response(JSON.stringify({ services: [], count: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        signature: "0xsig",
        tx_hash: "0xhash",
        agent_id: "agt_test",
        cost_usd: "$0.10",
        transaction_id: "tx_1",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return new Transport("https://www.trycanopy.ai", "ak_test_x", fakeFetch);
}

function newCanopy(transport: Transport) {
  const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
  (canopy as unknown as { transport: Transport }).transport = transport;
  return canopy;
}

describe("canopy.getTools()", () => {
  it("returns canonical CanopyTool[] for pay, discover, approve, deny", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const tools = canopy.getTools();
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "canopy_pay",
      "canopy_discover_services",
      "canopy_approve",
      "canopy_deny",
    ]);
    for (const t of tools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.execute).toBe("function");
      expect(t.parameters).toMatchObject({ type: "object" });
    }
  });

  it("canopy_pay parameters require `to` and `amountUsd`", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const [pay] = canopy.getTools();
    expect((pay.parameters as { required?: string[] }).required).toEqual(["to", "amountUsd"]);
  });

  it("canopy_pay.execute() hits /api/sign with the wire body", async () => {
    const captured: { body?: unknown; url?: string; path?: string } = {};
    const canopy = newCanopy(fakeTransport(captured));
    const [pay] = canopy.getTools();
    await pay.execute({ to: "0x" + "1".repeat(40), amountUsd: 0.1 });
    expect(captured.path).toBe("/api/sign");
    const body = captured.body as Record<string, unknown>;
    expect(body.agent_id).toBe("agt_test");
    expect(body.amount_usd).toBe(0.1);
    expect(body.type).toBe("raw_transaction");
  });

  it("canopy_discover_services.execute() hits /api/services with filters", async () => {
    const captured: { body?: unknown; url?: string; path?: string } = {};
    const canopy = newCanopy(fakeTransport(captured));
    const tools = canopy.getTools();
    const discover = tools.find((t) => t.name === "canopy_discover_services");
    expect(discover).toBeDefined();
    const result = await discover!.execute({ category: "data", query: "orderbook" });
    expect(captured.path).toContain("/api/services");
    expect(captured.path).toContain("category=data");
    expect(captured.path).toContain("q=orderbook");
    expect(captured.path).toContain("agent_id=agt_test");
    expect(Array.isArray(result)).toBe(true);
  });

  it("OpenAI wrap recipe produces a valid Chat Completions tool shape", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const tools = canopy.getTools();
    const openai = tools.map(({ execute, ...rest }) => ({ type: "function", function: rest }));
    expect(openai[0]).toMatchObject({
      type: "function",
      function: { name: "canopy_pay" },
    });
    expect(openai[0].function).not.toHaveProperty("execute");
  });

  it("Anthropic wrap recipe produces a valid Messages tool shape", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const tools = canopy.getTools();
    const anthropic = tools.map(({ execute, parameters, ...rest }) => ({
      ...rest,
      input_schema: parameters,
    }));
    expect(anthropic[0]).toMatchObject({
      name: "canopy_pay",
      input_schema: { type: "object" },
    });
    expect(anthropic[0]).not.toHaveProperty("parameters");
    expect(anthropic[0]).not.toHaveProperty("execute");
  });
});
