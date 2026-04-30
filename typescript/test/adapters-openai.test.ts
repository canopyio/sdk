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
    if (path.startsWith("/api/approvals/") && path.endsWith("/decide-by-agent")) {
      return new Response(
        JSON.stringify({
          decision: "approved",
          transaction_id: "tx_99",
          tx_hash: "0xapproved",
          signature: "0xsig",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return new Transport("https://trycanopy.ai", "ak_test_x", fakeFetch);
}

function newCanopy(transport: Transport) {
  const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
  (canopy as unknown as { transport: Transport }).transport = transport;
  return canopy;
}

describe("canopy.openai.tools()", () => {
  it("returns ChatCompletionTool[] for the four canonical tools", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const tools = canopy.openai.tools();
    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.function.name)).toEqual([
      "canopy_pay",
      "canopy_discover_services",
      "canopy_approve",
      "canopy_deny",
    ]);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(typeof t.function.description).toBe("string");
      expect(t.function.parameters).toMatchObject({ type: "object" });
      expect(t).not.toHaveProperty("execute");
    }
  });
});

describe("canopy.openai.dispatch()", () => {
  it("returns [] when given no tool calls", async () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    expect(await canopy.openai.dispatch(null)).toEqual([]);
    expect(await canopy.openai.dispatch(undefined)).toEqual([]);
    expect(await canopy.openai.dispatch([])).toEqual([]);
  });

  it("dispatches an allowed canopy_pay and returns a tool message", async () => {
    const canopy = newCanopy(
      fakeTransport({
        onSign: () => ({
          status: 200,
          body: {
            signature: "0xsig",
            tx_hash: "0xhash",
            agent_id: "agt_test",
            cost_usd: "$0.10",
            transaction_id: "tx_1",
          },
        }),
      }),
    );
    const messages = await canopy.openai.dispatch([
      {
        id: "call_1",
        function: {
          name: "canopy_pay",
          arguments: JSON.stringify({ to: "0x" + "1".repeat(40), amountUsd: 0.1 }),
        },
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("tool");
    expect(messages[0].tool_call_id).toBe("call_1");
    const parsed = JSON.parse(messages[0].content) as { status: string; txHash: string };
    expect(parsed.status).toBe("allowed");
    expect(parsed.txHash).toBe("0xhash");
  });

  it("propagates pending_approval rich fields into the tool message so the LLM can ask the user", async () => {
    const canopy = newCanopy(
      fakeTransport({
        onSign: () => ({
          status: 202,
          body: {
            status: "pending_approval",
            reason: "Amount $7.50 exceeds approval threshold of $5",
            approval_request_id: "ar_x9",
            transaction_id: "tx_pending_1",
            recipient_name: "Alchemy",
            recipient_address: "0x" + "2".repeat(40),
            amount_usd: 7.5,
            agent_name: "Trader",
            expires_at: "2026-04-29T12:00:00.000Z",
            chat_approval_enabled: true,
          },
        }),
      }),
    );
    const messages = await canopy.openai.dispatch([
      {
        id: "call_2",
        function: {
          name: "canopy_pay",
          arguments: JSON.stringify({ to: "0x" + "2".repeat(40), amountUsd: 7.5 }),
        },
      },
    ]);
    const parsed = JSON.parse(messages[0].content);
    expect(parsed).toMatchObject({
      status: "pending_approval",
      approvalId: "ar_x9",
      transactionId: "tx_pending_1",
      reason: "Amount $7.50 exceeds approval threshold of $5",
      recipientName: "Alchemy",
      amountUsd: 7.5,
      agentName: "Trader",
      expiresAt: "2026-04-29T12:00:00.000Z",
      chatApprovalEnabled: true,
    });
  });

  it("can resolve a pending approval via canopy_approve in the same dispatch loop (chat-native)", async () => {
    const canopy = newCanopy(fakeTransport({}));
    const messages = await canopy.openai.dispatch([
      {
        id: "call_3",
        function: {
          name: "canopy_approve",
          arguments: JSON.stringify({ approval_id: "ar_x9" }),
        },
      },
    ]);
    const parsed = JSON.parse(messages[0].content);
    expect(parsed.decision).toBe("approved");
    expect(parsed.txHash).toBe("0xapproved");
  });

  it("skips tool calls naming non-Canopy tools (host loop dispatches those)", async () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const messages = await canopy.openai.dispatch([
      {
        id: "call_other",
        function: { name: "user_owned_tool", arguments: "{}" },
      },
    ]);
    expect(messages).toEqual([]);
  });

  it("embeds errors as { error } JSON in the tool message instead of throwing", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("server boom", {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    const canopy = newCanopy(
      new Transport("https://trycanopy.ai", "ak_test_x", fakeFetch),
    );
    const messages = await canopy.openai.dispatch([
      {
        id: "call_err",
        function: {
          name: "canopy_pay",
          arguments: JSON.stringify({ to: "0x" + "1".repeat(40), amountUsd: 0.1 }),
        },
      },
    ]);
    expect(messages).toHaveLength(1);
    const parsed = JSON.parse(messages[0].content) as { error?: string };
    expect(typeof parsed.error).toBe("string");
  });
});
