import type { Canopy } from "../client.js";

export interface OpenAIChatCompletionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIToolCall {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export class OpenAIAdapter {
  constructor(private readonly canopy: Canopy) {}

  /**
   * Canopy's canonical tools shaped for OpenAI Chat Completions /
   * Responses APIs — `[{ type: "function", function: { name, description,
   * parameters } }]`. Pass directly as `tools` on `chat.completions.create`.
   */
  tools(): OpenAIChatCompletionTool[] {
    return this.canopy.getTools().map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Execute every Canopy tool call from an assistant message and return
   * results already shaped for the next `chat.completions.create` turn —
   * `[{ role: "tool", tool_call_id, content }]`. Append to your messages.
   *
   * Tool calls whose name isn't a Canopy tool are skipped (the host agent
   * loop dispatches those). Errors thrown by the underlying Canopy method
   * are embedded as `{ error }` JSON in the tool message so the LLM can
   * react instead of crashing the loop.
   */
  async dispatch(
    toolCalls: OpenAIToolCall[] | null | undefined,
  ): Promise<OpenAIToolMessage[]> {
    if (!toolCalls?.length) return [];
    const byName = new Map(this.canopy.getTools().map((t) => [t.name, t]));
    const out: OpenAIToolMessage[] = [];
    for (const call of toolCalls) {
      const tool = byName.get(call.function.name);
      if (!tool) continue;
      let content: string;
      try {
        const args = call.function.arguments
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {};
        const result = await tool.execute(args);
        content = JSON.stringify(result ?? null);
      } catch (err) {
        content = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
      out.push({ role: "tool", tool_call_id: call.id, content });
    }
    return out;
  }
}
