import type { Canopy } from "../client.js";

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export class AnthropicAdapter {
  constructor(private readonly canopy: Canopy) {}

  /**
   * Canopy's canonical tools shaped for Anthropic's Messages API —
   * `[{ name, description, input_schema }]`. Pass directly as `tools` on
   * `messages.create`.
   */
  tools(): AnthropicTool[] {
    return this.canopy.getTools().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  /**
   * Execute every Canopy `tool_use` block from an assistant message and
   * return Anthropic-shaped `tool_result` blocks. Wrap them in a user
   * message (`{ role: "user", content: <result-blocks> }`) and append for
   * the next turn.
   *
   * Non-`tool_use` blocks and blocks naming a non-Canopy tool are skipped.
   * Errors thrown by the underlying Canopy method are embedded as `{ error }`
   * JSON in the result content so the LLM can react.
   */
  async dispatch(
    content: AnthropicContentBlock[] | null | undefined,
  ): Promise<AnthropicToolResultBlock[]> {
    if (!content?.length) return [];
    const byName = new Map(this.canopy.getTools().map((t) => [t.name, t]));
    const out: AnthropicToolResultBlock[] = [];
    for (const block of content) {
      if (block.type !== "tool_use" || !block.id || !block.name) continue;
      const tool = byName.get(block.name);
      if (!tool) continue;
      let resultContent: string;
      try {
        const result = await tool.execute(block.input ?? {});
        resultContent = JSON.stringify(result ?? null);
      } catch (err) {
        resultContent = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
      out.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultContent,
      });
    }
    return out;
  }
}
