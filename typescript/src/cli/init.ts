/**
 * `npx @canopy-ai/sdk init <code> [--base-url URL]` — redeem a one-time
 * install code from the Canopy dashboard. Writes `CANOPY_API_KEY` and
 * `CANOPY_AGENT_ID` to `.env.local` in the current directory and pings the
 * API to confirm the integration is live.
 *
 * The dashboard mints these codes from `/dashboard/install` (or a future
 * "Get install command" button). Codes are single-use and expire in 5 min.
 */

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { Canopy } from "../client.js";

const DEFAULT_BASE_URL = "https://www.trycanopy.ai";

interface RedeemResponse {
  api_key: string;
  agent_id: string;
  base_url: string | null;
}

interface ParsedArgs {
  code: string | null;
  baseUrl: string;
  envPath: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let baseUrl = process.env.CANOPY_BASE_URL ?? DEFAULT_BASE_URL;
  let envPath = ".env.local";
  let code: string | null = null;
  let help = false;
  // `npx @canopy-ai/sdk init <code>` arrives with "init" as the first arg;
  // skip it so positional parsing finds the code.
  const args = argv[0] === "init" ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--base-url") {
      baseUrl = args[++i] ?? baseUrl;
    } else if (a === "--env-file") {
      envPath = args[++i] ?? envPath;
    } else if (!code && !a.startsWith("-")) {
      code = a;
    }
  }
  return { code, baseUrl, envPath, help };
}

function usage(): string {
  return [
    "Usage: npx @canopy-ai/sdk init <code> [options]",
    "",
    "Redeems a one-time install code from the Canopy dashboard and writes",
    "CANOPY_API_KEY + CANOPY_AGENT_ID to .env.local in the current directory.",
    "",
    "Options:",
    "  --base-url URL    Override the Canopy API base URL",
    "                    (default: https://www.trycanopy.ai or $CANOPY_BASE_URL)",
    "  --env-file PATH   Write to a different file (default: .env.local)",
    "  -h, --help        Show this message",
    "",
    "Get a code: https://www.trycanopy.ai/dashboard → click an agent → Install.",
  ].join("\n");
}

async function redeem(baseUrl: string, code: string): Promise<RedeemResponse> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/install/${encodeURIComponent(code)}`;
  const res = await fetch(url, { method: "GET" });
  if (res.status === 404) {
    throw new Error("Install code not found. Generate a fresh one in the dashboard.");
  }
  if (res.status === 410) {
    throw new Error(
      "Install code already used or expired. Codes are single-use and last 5 minutes.",
    );
  }
  if (!res.ok) {
    throw new Error(`Install failed: HTTP ${res.status}`);
  }
  return (await res.json()) as RedeemResponse;
}

async function writeEnvFile(envPath: string, apiKey: string, agentId: string): Promise<void> {
  const fullPath = resolve(process.cwd(), envPath);
  let existing = "";
  try {
    existing = await fs.readFile(fullPath, "utf8");
  } catch {
    // file doesn't exist — fine, we'll create it
  }
  const lines = existing.split(/\r?\n/);
  const setLine = (key: string, value: string) => {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    const line = `${key}=${value}`;
    if (idx === -1) lines.push(line);
    else lines[idx] = line;
  };
  setLine("CANOPY_API_KEY", apiKey);
  setLine("CANOPY_AGENT_ID", agentId);

  // Ensure trailing newline.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  await fs.writeFile(fullPath, lines.join("\n") + "\n", { encoding: "utf8" });
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { code, baseUrl, envPath, help } = parseArgs(argv);
  if (help || !code) {
    process.stdout.write(usage() + "\n");
    return code ? 0 : 1;
  }

  process.stdout.write(`Redeeming install code at ${baseUrl}…\n`);
  let result: RedeemResponse;
  try {
    result = await redeem(baseUrl, code);
  } catch (err) {
    process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  await writeEnvFile(envPath, result.api_key, result.agent_id);
  process.stdout.write(`✓ Wrote CANOPY_API_KEY and CANOPY_AGENT_ID to ${envPath}\n`);

  // Auto-ping so the dashboard's install panel transitions to "Connected".
  try {
    const canopy = new Canopy({
      apiKey: result.api_key,
      agentId: result.agent_id,
      baseUrl: result.base_url ?? baseUrl,
    });
    const ping = await canopy.ping();
    process.stdout.write(
      `✓ Connected as agent "${ping.agent.name ?? ping.agent.id}" (${ping.latencyMs}ms)\n`,
    );
  } catch (err) {
    process.stderr.write(
      `! Saved credentials, but ping failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.stderr.write(
      "  Your `.env.local` is set up — try `canopy.ping()` from your app to debug.\n",
    );
    return 3;
  }

  process.stdout.write("Done. Open https://www.trycanopy.ai/dashboard to see your agent.\n");
  return 0;
}

// Export internals for tests; run when executed as a CLI.
export { parseArgs, writeEnvFile, redeem };

if (process.env.CANOPY_CLI_NO_AUTORUN !== "1") {
  main().then((code) => process.exit(code));
}
