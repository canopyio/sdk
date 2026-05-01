import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves the directory holding the snapshotted starter templates. After
 * `npm run build`, templates live at `dist/templates/<slug>` (copied by
 * scripts/copy-templates.mjs). For source-tree dev (running via tsx), we fall
 * back to the sibling `canopy-agent-starters/` directory at repo root.
 */
export function templatesRoot(): string {
  const inDist = path.join(SELF_DIR, "templates");
  // SELF_DIR for source dev: <repo>/sdk/create-canopy-agent/src
  // SELF_DIR for built CLI: <pkg>/dist
  const sourceFallback = path.resolve(
    SELF_DIR,
    "..",
    "..",
    "..",
    "canopy-agent-starters",
  );
  return existsSync(inDist) ? inDist : sourceFallback;
}

function existsSync(p: string): boolean {
  try {
    return Boolean(statSync(p, { throwIfNoEntry: false }));
  } catch {
    return false;
  }
}

const IGNORE = new Set([
  "node_modules",
  ".env",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".DS_Store",
]);

export interface ScaffoldArgs {
  starterSlug: string;
  destDir: string;
  projectName: string;
  env: Record<string, string>;
}

/**
 * Copies the starter directory tree into destDir, applies token replacements
 * to package.json (project name) and writes .env from the supplied env map.
 *
 * Throws if destDir already exists with content.
 */
export async function scaffold(args: ScaffoldArgs): Promise<void> {
  const root = templatesRoot();
  const src = path.join(root, args.starterSlug);

  const srcStat = await fs.stat(src).catch(() => null);
  if (!srcStat || !srcStat.isDirectory()) {
    throw new Error(`Template not found: ${src}`);
  }

  await fs.mkdir(args.destDir, { recursive: true });
  const existingEntries = await fs.readdir(args.destDir);
  if (existingEntries.length > 0) {
    throw new Error(
      `Destination ${args.destDir} is not empty. Pick a fresh path or remove it first.`,
    );
  }

  await copyTree(src, args.destDir);
  await rewritePackageJson(args.destDir, args.projectName);
  await writeEnv(args.destDir, args.env);
}

async function copyTree(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    // The build-time snapshot stores the per-starter ignore as `gitignore`
    // (see scripts/copy-templates.mjs) because npm pack strips `.gitignore`
    // from subdirectories. Restore the dot when scaffolding into a user's
    // project so they get a working `.gitignore` out of the box.
    const destName = entry.name === "gitignore" ? ".gitignore" : entry.name;
    const d = path.join(dest, destName);
    if (entry.isDirectory()) {
      await copyTree(s, d);
    } else if (entry.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}

async function rewritePackageJson(dir: string, projectName: string): Promise<void> {
  const pkgPath = path.join(dir, "package.json");
  const raw = await fs.readFile(pkgPath, "utf8").catch(() => null);
  if (!raw) return;
  let pkg: { name?: string; description?: string; [k: string]: unknown };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return;
  }
  pkg.name = projectName;
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}

async function writeEnv(dir: string, env: Record<string, string>): Promise<void> {
  const lines = Object.entries(env)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}=${v}`);
  if (lines.length === 0) return;
  await fs.writeFile(path.join(dir, ".env"), lines.join("\n") + "\n", "utf8");
}
