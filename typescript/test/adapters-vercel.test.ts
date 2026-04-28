import { describe, expect, it } from "vitest";
import { Canopy } from "../src/index.js";

describe("canopy.vercel.tools()", () => {
  it("returns a Record<name, { description, parameters, execute }> for the four canonical tools", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const tools = canopy.vercel.tools();
    const names = Object.keys(tools).sort();
    expect(names).toEqual(
      ["canopy_approve", "canopy_deny", "canopy_discover_services", "canopy_pay"].sort(),
    );
    for (const name of names) {
      const t = tools[name];
      expect(typeof t.description).toBe("string");
      expect(t.parameters).toMatchObject({ type: "object" });
      expect(typeof t.execute).toBe("function");
    }
  });

  it("preserves the canonical parameters JSON Schema for Vercel's tool runner", () => {
    const canopy = new Canopy({ apiKey: "ak_test_x", agentId: "agt_test" });
    const canonical = canopy.getTools().find((t) => t.name === "canopy_pay")!;
    const vercel = canopy.vercel.tools();
    expect(vercel.canopy_pay.parameters).toEqual(canonical.parameters);
    expect(vercel.canopy_pay.description).toBe(canonical.description);
  });
});
