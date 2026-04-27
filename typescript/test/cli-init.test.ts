import { describe, expect, it, beforeAll } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

beforeAll(() => {
  // Suppress the auto-run so we can import the module purely for testing.
  process.env.CANOPY_CLI_NO_AUTORUN = "1";
});

describe("cli/init", () => {
  it("parses 'init <code>' and skips the subcommand keyword", async () => {
    const { parseArgs } = await import("../src/cli/init.js");
    const args = parseArgs(["init", "abc123"]);
    expect(args.code).toBe("abc123");
    expect(args.baseUrl).toBe("https://www.trycanopy.ai");
    expect(args.envPath).toBe(".env.local");
  });

  it("accepts --base-url and --env-file overrides", async () => {
    const { parseArgs } = await import("../src/cli/init.js");
    const args = parseArgs([
      "init",
      "code",
      "--base-url",
      "http://localhost:3000",
      "--env-file",
      ".env",
    ]);
    expect(args.baseUrl).toBe("http://localhost:3000");
    expect(args.envPath).toBe(".env");
  });

  it("recognizes --help and returns no code", async () => {
    const { parseArgs } = await import("../src/cli/init.js");
    const args = parseArgs(["--help"]);
    expect(args.help).toBe(true);
    expect(args.code).toBeNull();
  });

  it("writeEnvFile creates a new file with the two variables", async () => {
    const { writeEnvFile } = await import("../src/cli/init.js");
    const dir = await mkdtemp(join(tmpdir(), "canopy-cli-"));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await writeEnvFile(".env.local", "ak_test_x", "agt_y");
      const out = await readFile(join(dir, ".env.local"), "utf8");
      expect(out).toContain("CANOPY_API_KEY=ak_test_x");
      expect(out).toContain("CANOPY_AGENT_ID=agt_y");
      expect(out.endsWith("\n")).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it("writeEnvFile updates existing keys in place without dropping others", async () => {
    const { writeEnvFile } = await import("../src/cli/init.js");
    const dir = await mkdtemp(join(tmpdir(), "canopy-cli-"));
    await writeFile(
      join(dir, ".env.local"),
      "OTHER=keep\nCANOPY_API_KEY=ak_old\n",
      "utf8",
    );
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await writeEnvFile(".env.local", "ak_new", "agt_new");
      const out = await readFile(join(dir, ".env.local"), "utf8");
      expect(out).toContain("OTHER=keep");
      expect(out).toContain("CANOPY_API_KEY=ak_new");
      expect(out).toContain("CANOPY_AGENT_ID=agt_new");
      expect(out).not.toContain("ak_old");
    } finally {
      process.chdir(cwd);
    }
  });

  it("redeem returns the parsed install response", async () => {
    const { redeem } = await import("../src/cli/init.js");
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      expect(String(url)).toContain("/api/install/the-code");
      return new Response(
        JSON.stringify({ api_key: "ak_test_x", agent_id: "agt_y", base_url: null }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const result = await redeem("https://api.canopy.test", "the-code");
      expect(result.api_key).toBe("ak_test_x");
      expect(result.agent_id).toBe("agt_y");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("redeem throws a friendly error on 410 (used or expired)", async () => {
    const { redeem } = await import("../src/cli/init.js");
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Install code already used" }), {
        status: 410,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      await expect(redeem("https://api.canopy.test", "stale")).rejects.toThrow(
        /single-use|expired|already used/i,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
