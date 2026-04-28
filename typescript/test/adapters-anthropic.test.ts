import { describe, expect, it } from "vitest";
import { Canopy } from "../src/index.js";
import { Transport } from "../src/transport.js";

interface SignBody {
  agent_id?: string;
  amount_usd?: number;
}

function fakeTransport(opts: {
  onSign?: (body: SignBody) => { status: number; body: unknown };
}) {
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    const body = init?.body ? (JSON.parse(init.body as string) as SignBody) : {};
    if (path === "/api/sign" && opts.onSign) {
      const { status, body: resBody } = opts.onSign(body);
      return new Response(JSON.stringify(resBody), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return new Transport("https://www.trycanopy.ai", "ak_test_x", fakeFetch);
}

function newCanopy(transport: Transport) {
  const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
  (canopy as unknown as { transport: Transport }).transport = transport;
  return canopy;
}

describe("canopy.anthropic.tools()", () => {
  it("returns Anthropic tool shape with input_schema (not parameters)", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const tools = canopy.anthropic.tools();
    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name)).toEqual([
      "canopy_pay",
      "canopy_discover_services",
      "canopy_approve",
      "canopy_deny",
    ]);
    for (const t of tools) {
      expect(t).toHaveProperty("input_schema");
      expect(t).not.toHaveProperty("parameters");
      expect(t).not.toHaveProperty("execute");
      expect(t.input_schema).toMatchObject({ type: "object" });
    }
  });
});

describe("canopy.anthropic.dispatch()", () => {
  it("returns [] when given no content blocks", async () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    expect(await canopy.anthropic.dispatch(null)).toEqual([]);
    expect(await canopy.anthropic.dispatch(undefined)).toEqual([]);
    expect(await canopy.anthropic.dispatch([])).toEqual([]);
  });

  it("dispatches a tool_use block and returns a tool_result block", async () => {
    const canopy = newCanopy(
      fakeTransport({
        onSign: () => ({
          status: 200,
          body: {
            signature: "0xsig",
            tx_hash: "0xhash",
            agent_id: "agt_test",
            cost_usd: "$0.05",
            transaction_id: "tx_1",
          },
        }),
      }),
    );
    const blocks = await canopy.anthropic.dispatch([
      {
        type: "tool_use",
        id: "tu_1",
        name: "canopy_pay",
        input: { to: "0x" + "1".repeat(40), amountUsd: 0.05 },
      },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("tool_result");
    expect(blocks[0].tool_use_id).toBe("tu_1");
    const parsed = JSON.parse(blocks[0].content) as { status: string };
    expect(parsed.status).toBe("allowed");
  });

  it("propagates pending_approval rich fields into the tool_result so the LLM can ask the user", async () => {
    const canopy = newCanopy(
      fakeTransport({
        onSign: () => ({
          status: 202,
          body: {
            status: "pending_approval",
            reason: "over threshold",
            approval_request_id: "ar_y2",
            transaction_id: "tx_pending_2",
            recipient_name: "Alchemy",
            amount_usd: 7.5,
            agent_name: "Trader",
            expires_at: "2026-04-29T12:00:00.000Z",
            chat_approval_enabled: true,
          },
        }),
      }),
    );
    const blocks = await canopy.anthropic.dispatch([
      {
        type: "tool_use",
        id: "tu_2",
        name: "canopy_pay",
        input: { to: "0x" + "2".repeat(40), amountUsd: 7.5 },
      },
    ]);
    const parsed = JSON.parse(blocks[0].content);
    expect(parsed).toMatchObject({
      status: "pending_approval",
      approvalId: "ar_y2",
      recipientName: "Alchemy",
      amountUsd: 7.5,
      agentName: "Trader",
      chatApprovalEnabled: true,
    });
  });

  it("skips text and other non-tool_use blocks", async () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const blocks = await canopy.anthropic.dispatch([
      { type: "text" },
      { type: "thinking" },
    ]);
    expect(blocks).toEqual([]);
  });

  it("skips tool_use blocks naming non-Canopy tools (host dispatches those)", async () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const blocks = await canopy.anthropic.dispatch([
      { type: "tool_use", id: "tu_x", name: "user_owned_tool", input: {} },
    ]);
    expect(blocks).toEqual([]);
  });
});
