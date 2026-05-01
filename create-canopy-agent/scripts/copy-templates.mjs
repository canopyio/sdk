#!/usr/bin/env node
/**
 * Copy canopy-agent-starters/ into dist/templates/ so the published npm
 * package contains the snapshot the CLI will read at runtime. Skips
 * node_modules, lockfiles, and dotfiles.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(SELF_DIR, "..");
const REPO_ROOT = path.resolve(PKG_ROOT, "..", "..");
const SRC = path.join(REPO_ROOT, "canopy-agent-starters");
const DEST = path.join(PKG_ROOT, "dist", "templates");

const IGNORE = new Set([
  "node_modules",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".env",
  ".DS_Store",
]);

async function copyTree(src, dest) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    // npm pack strips `.gitignore` from subdirectories of published tarballs.
    // Rename to `gitignore` in the snapshot; the runtime scaffolder restores
    // the dot when copying into a user's project.
    const destName = entry.name === ".gitignore" ? "gitignore" : entry.name;
    const d = path.join(dest, destName);
    if (entry.isDirectory()) {
      await copyTree(s, d);
    } else if (entry.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}

async function main() {
  const stat = await fs.stat(SRC).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    console.error(`copy-templates: source not found at ${SRC}`);
    process.exit(1);
  }
  await fs.rm(DEST, { recursive: true, force: true });
  await copyTree(SRC, DEST);
  console.log(`copy-templates: snapshot at ${path.relative(PKG_ROOT, DEST)}`);
}

main().catch((err) => {
  console.error("copy-templates failed:", err);
  process.exit(1);
});
