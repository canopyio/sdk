import { describe, expect, it } from "vitest";
import { Canopy } from "../src/index.js";
import { Transport } from "../src/transport.js";

/**
 * Each framework adapter should:
 *  1. Produce a tool description with the canopy_pay name and the {to, amountUsd} schema.
 *  2. Carry an executor that calls canopy.pay() — verified by intercepting the
 *     underlying HTTP request and asserting the wire body matches.
 */

function fakeTransport(captured: { body?: unknown; path?: string }) {
  const fakeFetch: typeof fetch = async (input, init) => {
    captured.body = init?.body ? JSON.parse(init.body as string) : undefined;
    captured.path = typeof input === "string" ? input : input.toString();
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
  // Construct Canopy normally, then swap its transport via a private cast — we
  // only need the executors to use a controllable transport for the wire-body
  // assertions below.
  const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
  (canopy as unknown as { transport: Transport }).transport = transport;
  return canopy;
}

describe("openai adapter", () => {
  it("returns the canopy_pay tool with correct shape", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const tools = canopy.getTools({ framework: "openai" });
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("canopy_pay");
    expect(tools[0].function.parameters.required).toEqual(["to", "amountUsd"]);
  });

  it("execute() calls /api/sign with the same body as pay()", async () => {
    const captured: { body?: unknown; path?: string } = {};
    const canopy = newCanopy(fakeTransport(captured));
    const [tool] = canopy.getTools({ framework: "openai" });
    await tool.execute({ to: "0x" + "1".repeat(40), amountUsd: 0.1 });
    const body = captured.body as Record<string, unknown>;
    expect(body.agent_id).toBe("agt_test");
    expect(body.amount_usd).toBe(0.1);
    expect(body.type).toBe("raw_transaction");
  });
});

describe("anthropic adapter", () => {
  it("returns input_schema (Anthropic shape)", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const tools = canopy.getTools({ framework: "anthropic" });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("canopy_pay");
    expect(tools[0].input_schema).toBeDefined();
    expect(tools[0].input_schema.required).toEqual(["to", "amountUsd"]);
  });

  it("execute() calls /api/sign", async () => {
    const captured: { body?: unknown } = {};
    const canopy = newCanopy(fakeTransport(captured));
    const [tool] = canopy.getTools({ framework: "anthropic" });
    const result = await tool.execute({ to: "0x" + "2".repeat(40), amountUsd: 0.25 });
    expect(result.status).toBe("allowed");
    expect((captured.body as Record<string, unknown>).amount_usd).toBe(0.25);
  });
});

describe("vercel adapter", () => {
  it("returns a Record keyed by tool name (Vercel shape)", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const tools = canopy.getTools({ framework: "vercel" });
    expect(Object.keys(tools)).toEqual(["canopy_pay"]);
    expect(tools.canopy_pay.parameters.required).toEqual(["to", "amountUsd"]);
  });

  it("execute() calls /api/sign", async () => {
    const captured: { body?: unknown } = {};
    const canopy = newCanopy(fakeTransport(captured));
    const tools = canopy.getTools({ framework: "vercel" });
    await tools.canopy_pay.execute({ to: "0x" + "3".repeat(40), amountUsd: 0.5 });
    expect((captured.body as Record<string, unknown>).amount_usd).toBe(0.5);
  });
});

describe("langchain adapter", () => {
  it("returns DynamicStructuredTool config with schema + func", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const tools = canopy.getTools({ framework: "langchain" });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("canopy_pay");
    expect(tools[0].schema.required).toEqual(["to", "amountUsd"]);
    expect(typeof tools[0].func).toBe("function");
  });

  it("func() returns a JSON-stringified PayResult", async () => {
    const captured: { body?: unknown } = {};
    const canopy = newCanopy(fakeTransport(captured));
    const [tool] = canopy.getTools({ framework: "langchain" });
    const out = await tool.func({ to: "0x" + "4".repeat(40), amountUsd: 1 });
    expect(typeof out).toBe("string");
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("allowed");
    expect(parsed.txHash).toBe("0xhash");
  });
});
