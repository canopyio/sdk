#!/usr/bin/env node
import path from "node:path";
import { input, password, select, confirm } from "@inquirer/prompts";
import { CanopyApiClient, CanopyApiError, type OrgContext } from "./api.js";
import { scaffold } from "./scaffold.js";
import { STARTERS, type StarterDef } from "./starters.js";
import { bold, dim, fail, info, step, success, warn } from "./log.js";

interface ApprovalChoice {
  approval_required: boolean;
  approval_threshold_usd: number | null;
}

async function main(): Promise<void> {
  console.log("");
  step("Canopy starter scaffolder");
  info("Connect your Canopy org, pick a starter, get a runnable agent in ~30 seconds.\n");

  const argvName = process.argv[2];
  const projectName = (
    argvName ??
    (await input({
      message: "Project name:",
      default: "my-canopy-agent",
      validate: (v) => (v.trim().length > 0 ? true : "required"),
    }))
  ).trim();

  const destDir = path.resolve(process.cwd(), projectName);

  // 1. Pick starter
  const sortedStarters = [...STARTERS].sort(
    (a, b) => Number(b.recommendedFirst ?? false) - Number(a.recommendedFirst ?? false),
  );
  const starterSlug: string = await select({
    message: "Pick a starter:",
    choices: sortedStarters.map((s) => ({
      name: s.recommendedFirst ? `${s.label}  (Recommended)` : s.label,
      value: s.slug,
      description: s.shortDescription,
    })),
  });
  const starter = STARTERS.find((s) => s.slug === starterSlug)!;

  // 2. Connect to Canopy org via API key
  console.log("");
  info(
    `Connect to your Canopy org. You can find your API key here:\n   ${dim("https://trycanopy.ai/dashboard/settings#api-keys")}`,
  );
  const apiKey = (
    await password({
      message: "Org API key (ak_live_…):",
      validate: (v) =>
        v.trim().startsWith("ak_") || v.trim().startsWith("ak_live_")
          ? true
          : "expected an ak_live_… key",
    })
  ).trim();

  const client = new CanopyApiClient(apiKey);
  let org: OrgContext;
  try {
    org = await client.me();
  } catch (err) {
    if (err instanceof CanopyApiError && err.status === 401) {
      fail("Invalid or revoked API key. Get a fresh one from the dashboard.");
    } else {
      fail(`Failed to validate API key: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }

  if (!org.treasury_provisioned) {
    fail(
      `Org "${org.org_name ?? org.org_id}" has no treasury provisioned yet. Open the dashboard once to finish setup, then re-run this command.`,
    );
    process.exit(1);
  }

  success(
    `Connected to "${bold(org.org_name ?? org.org_id)}" (treasury ${dim(shortenAddress(org.treasury_address!))})`,
  );

  // 3. Agent name
  const agentName = (
    await input({
      message: "Name your agent:",
      default: projectName,
      validate: (v) => (v.trim().length > 0 ? true : "required"),
    })
  ).trim();

  // 4. Show suggested policy + ask about approval
  console.log("");
  step(`Suggested policy preset for ${starter.slug}:`);
  printPolicyTable(starter);

  const approval = await pickApproval(starter);

  // 5. Confirm
  const ok = await confirm({
    message: `Create policy "${starter.policy.name}" + agent "${agentName}" in this org?`,
    default: true,
  });
  if (!ok) {
    info("Aborted before creating any resources.");
    process.exit(0);
  }

  // 6. POST /api/policies
  let policyId: string;
  try {
    const created = await client.createPolicy({
      ...starter.policy,
      approval_required: approval.approval_required,
      approval_threshold_usd: approval.approval_threshold_usd,
    });
    policyId = created.policy_id;
    success(`Created policy "${starter.policy.name}" (${dim(policyId)})`);
  } catch (err) {
    fail(`Failed to create policy: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // 7. POST /api/agents
  let agentId: string;
  try {
    const created = await client.createAgent(agentName, policyId);
    agentId = created.agentId;
    success(`Created agent "${agentName}" (${dim(agentId)})`);
  } catch (err) {
    fail(`Failed to create agent: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // 8. Anthropic API key
  console.log("");
  info(
    `Claude Agent SDK runs on Claude. Get a key here:\n   ${dim("https://console.anthropic.com/")}`,
  );
  const anthropicKey = (
    await password({
      message: "Anthropic API key (sk-ant-…) [leave empty to fill .env later]:",
    })
  ).trim();

  // 9. Scaffold project
  try {
    await scaffold({
      starterSlug: starter.slug,
      destDir,
      projectName,
      env: {
        CANOPY_API_KEY: apiKey,
        CANOPY_AGENT_ID: agentId,
        ANTHROPIC_API_KEY: anthropicKey,
      },
    });
    success(`Scaffolded ${dim(destDir)}`);
  } catch (err) {
    fail(
      `Scaffold failed: ${err instanceof Error ? err.message : String(err)}\n   Your Canopy agent + policy were created and are reusable — re-run with a fresh project name.`,
    );
    process.exit(1);
  }

  // 10. Next steps
  console.log("");
  step("🎉 Done.");
  console.log("");
  console.log(`   ${bold("cd " + projectName)}`);
  console.log(`   ${bold("npm install")}`);
  console.log(`   ${bold("npm start")}`);
  console.log("");
  info(`Edit your policy or pause the agent at:\n   https://trycanopy.ai/dashboard/agents/${agentId}`);
  if (!anthropicKey) {
    warn(
      `Don't forget to set ANTHROPIC_API_KEY in ${path.join(projectName, ".env")} before \`npm start\`.`,
    );
  }
}

function shortenAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function printPolicyTable(starter: StarterDef): void {
  const p = starter.policy;
  const allowlist =
    p.allowlist_addresses.length === 0
      ? "(empty — configure in dashboard before going past testing)"
      : p.allowlist_addresses.join(", ");
  console.log(`   • Spend cap            $${p.spend_cap_usd} / ${p.cap_period_hours}h`);
  if (p.approval_required && p.approval_threshold_usd != null) {
    console.log(`   • Approval threshold   $${p.approval_threshold_usd} single payment`);
  } else {
    console.log(`   • Approval threshold   none — all payments under cap auto-approve`);
  }
  console.log(`   • Allowlist            ${allowlist}`);
}

async function pickApproval(starter: StarterDef): Promise<ApprovalChoice> {
  const recommendedThreshold = starter.policy.approval_threshold_usd ?? 0;
  const choice = await select({
    message: "Approval threshold for single payments:",
    choices: [
      {
        name: starter.policy.approval_required
          ? `Recommended ($${recommendedThreshold} — payments above this need human approval)`
          : `Recommended (no approvals — auto-approve everything under the spend cap)`,
        value: "recommended",
      },
      {
        name: "No approvals needed (auto-approve everything under the spend cap)",
        value: "none",
      },
      {
        name: "Custom amount",
        value: "custom",
      },
    ],
  });

  if (choice === "recommended") {
    return {
      approval_required: starter.policy.approval_required,
      approval_threshold_usd: starter.policy.approval_threshold_usd,
    };
  }

  if (choice === "none") {
    return { approval_required: false, approval_threshold_usd: null };
  }

  const customStr = await input({
    message: "Approval threshold (USD):",
    default: String(recommendedThreshold),
    validate: (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? true : "must be a non-negative number";
    },
  });
  return {
    approval_required: true,
    approval_threshold_usd: Number(customStr),
  };
}

main().catch((err) => {
  if (err && err.name === "ExitPromptError") {
    info("Aborted.");
    process.exit(0);
  }
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
