#!/usr/bin/env bun
/**
 * release.ts — bump all package versions, run tests, rebuild inject, tag, push.
 *
 * Usage:
 *   bun run release 0.1.1
 *   bun run release 0.2.0-beta.1
 */
import { spawnSync } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
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

// 4. Draft a CHANGELOG entry from commit subjects since the last tag, then
//    open it in $EDITOR for the user to confirm/trim/edit before commit.
const lastTag = (await $`git describe --tags --abbrev=0`.text()).trim();
const commitsRaw = (await $`git log --pretty=format:%s ${lastTag}..HEAD`.text()).trim();
if (!commitsRaw) {
  console.error(`No commits since ${lastTag}. Nothing to release.`);
  process.exit(1);
}

const draftBullets = commitsRaw
  .split("\n")
  .filter((s) => s.trim() && !/^chore: release \d/.test(s))
  .map((s) => `- ${s}`)
  .join("\n");

const today = new Date().toISOString().slice(0, 10);
const draftSection = `## v${version} — ${today}\n\n${draftBullets}\n`;

const editor = process.env.EDITOR || process.env.VISUAL;
let finalSection: string;

if (editor) {
  const tmpFile = pathJoin(tmpdir(), `pitstop-release-${version}.md`);
  await writeFile(tmpFile, draftSection);
  console.log(`▸ drafting CHANGELOG entry...`);
  console.log(`  opening ${editor} — review/edit the bullets and save to continue.`);
  const result = spawnSync(editor, [tmpFile], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`  $EDITOR exited with status ${result.status}; aborting.`);
    await unlink(tmpFile).catch(() => {});
    process.exit(1);
  }
  finalSection = (await readFile(tmpFile, "utf8")).trim();
  await unlink(tmpFile).catch(() => {});
} else {
  console.error(
    "▸ drafting CHANGELOG entry needs $EDITOR (or $VISUAL) set so you can review the auto-derived bullets.",
  );
  console.error("  Set one (e.g. `export EDITOR=nano`) and re-run.");
  process.exit(1);
}

if (!finalSection.startsWith(`## v${version}`)) {
  console.error("CHANGELOG section header is missing or wrong; aborting.");
  process.exit(1);
}

// Prepend the new section to CHANGELOG.md (after the file header, before
// the most recent entry).
const changelogPath = "CHANGELOG.md";
const changelog = await readFile(changelogPath, "utf8");
const headerEnd = changelog.indexOf("\n## ");
if (headerEnd === -1) {
  console.error("Couldn't find any version section in CHANGELOG.md.");
  process.exit(1);
}
const newChangelog = `${changelog.slice(0, headerEnd + 1)}${finalSection}\n\n${changelog.slice(headerEnd + 1)}`;
await writeFile(changelogPath, newChangelog);
console.log("  CHANGELOG.md updated.\n");

// 5. Bump all package versions
console.log(`▸ bumping ${PACKAGES.length} packages → ${version}`);
for (const file of PACKAGES) {
  const pkg = JSON.parse(await readFile(file, "utf8"));
  pkg.version = version;
  await writeFile(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ${file}`);
}

// Sync the MCP server identity version string. The Server constructor in
// mcp-adapter/src/index.ts hardcodes a `version: "x.y.z"` literal; if it
// drifts from the package version, `claude mcp list` shows a stale tag and
// nothing else fails noisily. Patch it in place.
const adapterSrc = "packages/mcp-adapter/src/index.ts";
const adapterPattern = /(name:\s*"pitstop",\s*version:\s*")[\d.]+(")/;
const original = await readFile(adapterSrc, "utf8");
if (!adapterPattern.test(original)) {
  console.error(`  could not find Server({ name: "pitstop", version: ... }) literal in ${adapterSrc}`);
  process.exit(1);
}
const patched = original.replace(adapterPattern, `$1${version}$2`);
if (patched !== original) await writeFile(adapterSrc, patched);
console.log(`  ${adapterSrc} (Server version literal)`);
console.log("");

// 5. Rebuild inject so the published bundle reflects this version.
// `bun --cwd <dir> run <script>` silently no-ops on Bun 1.3.13 (prints the
// script list with exit 0 instead of executing). Use `bun run --cwd <dir>`.
console.log("▸ rebuilding inject.js...");
await $`bun run --cwd packages/inject build`.quiet();
const injectDist = "packages/inject/dist/inject.js";
if (!(await Bun.file(injectDist).exists())) {
  console.error(`  build claimed success but ${injectDist} is missing.`);
  process.exit(1);
}
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
const adapterDist = "packages/mcp-adapter/dist/index.js";
if (!(await Bun.file(adapterDist).exists())) {
  console.error(`  build claimed success but ${adapterDist} is missing.`);
  process.exit(1);
}
console.log("  rebuilt.\n");

// 6. Commit, tag, push
console.log("▸ committing, tagging, pushing...");
await $`git add -A`;
await $`git commit -m ${`chore: release ${version}`}`;
await $`git tag ${tag}`;
await $`git push origin main --tags`;

// 7. Create the GitHub release with the section body so the /releases page
//    matches CHANGELOG.md. Skip silently if `gh` isn't installed or auth'd.
const sectionBody = finalSection.replace(/^## v[\d.]+ — \d{4}-\d{2}-\d{2}\n+/, "").trim();
console.log("▸ creating GitHub release...");
const ghResult = spawnSync("gh", ["release", "create", tag, "--title", tag, "--notes", sectionBody], {
  stdio: "inherit",
});
if (ghResult.status !== 0) {
  console.warn(`  ⚠ gh release create returned ${ghResult.status} — continuing.`);
} else {
  console.log("  done.\n");
}

console.log(`✓ released ${tag}`);
console.log(`  https://github.com/AmmDuncan/pitstop/releases/tag/${tag}`);
