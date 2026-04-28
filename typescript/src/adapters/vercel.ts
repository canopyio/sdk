import type { Canopy } from "../client.js";

export interface VercelTool {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export class VercelAdapter {
  constructor(private readonly canopy: Canopy) {}

  /**
   * Canopy's canonical tools shaped for Vercel AI SDK (`ai`) — a
   * `Record<name, { description, parameters: JSONSchema, execute }>`. Pass
   * directly as `tools` on `generateText`, `streamText`, etc.
   *
   * The Vercel AI SDK runs the dispatch loop itself; no `dispatch()` helper
   * is needed.
   */
  tools(): Record<string, VercelTool> {
    return Object.fromEntries(
      this.canopy.getTools().map((t) => [
        t.name,
        {
          description: t.description,
          parameters: t.parameters,
          execute: t.execute,
        },
      ]),
    );
  }
}
