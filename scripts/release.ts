#!/usr/bin/env bun
/**
 * release.ts — bump all package versions, run tests, rebuild inject, tag, push.
 *
 * Usage:
 *   bun run release 0.1.1
 *   bun run release 0.2.0-beta.1
 */
import { readFile, writeFile } from "node:fs/promises";
import { $ } from "bun";

const PACKAGES = [
  "packages/daemon/package.json",
  "packages/inject/package.json",
  "packages/mcp-adapter/package.json",
  "packages/shared/package.json",
  "packages/vite-plugin/package.json",
];

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("Usage: bun run release <semver>");
  console.error("Example: bun run release 0.1.1");
  process.exit(1);
}

const tag = `v${version}`;

// 1. Working tree must be clean
const status = (await $`git status --porcelain`.text()).trim();
if (status) {
  console.error("Working tree is dirty. Commit or stash first:");
  console.error(status);
  process.exit(1);
}

// 2. Tag must not already exist
const existingTag = (await $`git tag -l ${tag}`.text()).trim();
if (existingTag) {
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
}

// 3. Tests must pass before we touch anything
console.log("▸ running tests...");
await $`bun test`.quiet();
console.log("  tests passed.\n");

// 4. Bump all package versions
console.log(`▸ bumping ${PACKAGES.length} packages → ${version}`);
for (const file of PACKAGES) {
  const pkg = JSON.parse(await readFile(file, "utf8"));
  pkg.version = version;
  await writeFile(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ${file}`);
}
console.log("");

// 5. Rebuild inject so the published bundle reflects this version
console.log("▸ rebuilding inject.js...");
await $`bun --cwd packages/inject run build`.quiet();
console.log("  rebuilt.\n");

// 5b. Rebuild mcp-adapter bundle (Claude Code launches this via node)
//
// Important: --target=node, not --target=bun. We hit a CC-2.1.126 issue where
// bun-launched MCP adapters complete the initialize handshake but never receive
// CC's subsequent tools/list request — bun's stdin handling on CC's anonymous
// pipe stalls after the first message. Launching the same bundle via node
// (any v18+) registers tools cleanly. Keep --target=node so a fresh checkout
// can `node packages/mcp-adapter/dist/index.js` without bun installed.
console.log("▸ rebuilding mcp-adapter bundle...");
await $`bun build packages/mcp-adapter/src/index.ts --outfile packages/mcp-adapter/dist/index.js --target=node --format=esm`.quiet();
console.log("  rebuilt.\n");

// 6. Commit, tag, push
console.log("▸ committing, tagging, pushing...");
await $`git add -A`;
await $`git commit -m ${`chore: release ${version}`}`;
await $`git tag ${tag}`;
await $`git push origin main --tags`;

console.log(`\n✓ released ${tag}`);
console.log(`  https://github.com/AmmDuncan/pitstop/releases/tag/${tag}`);
