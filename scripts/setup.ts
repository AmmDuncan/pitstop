#!/usr/bin/env bun
import { existsSync } from "node:fs";
/**
 * setup.ts — one-shot installer for a fresh pitstop checkout.
 *
 * Run from the repo root after `bun install`:
 *   bun run setup
 *
 * What it does:
 *   1. Build the mcp-adapter dist bundle (node-targeted, ESM).
 *   2. Build the inject drawer bundle.
 *   3. Patch ~/.claude.json to register the MCP server (dedup-safe).
 *   4. Patch ~/.claude/settings.json to install the UserPromptSubmit hook
 *      (dedup-safe).
 *   5. Print the per-project drawer script tag for the user to wire in.
 *
 * Idempotent: re-running on an already-set-up machine is a no-op except for
 * fresh dist rebuilds (which are quick and harmless).
 *
 * Does NOT:
 *   - Restart Claude Code (impossible from a child process). Reminder printed.
 *   - Wire the drawer into the user's dev app. The right wiring varies per
 *     framework; we print the snippet at the end and let them paste.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { $ } from "bun";

const REPO_ROOT = resolve(import.meta.dir, "..");
const HOME = homedir();
const CLAUDE_JSON = join(HOME, ".claude.json");
const SETTINGS_JSON = join(HOME, ".claude", "settings.json");
const ADAPTER_DIST = join(REPO_ROOT, "packages/mcp-adapter/dist/index.js");
const HOOK_SCRIPT = join(REPO_ROOT, "packages/scripts/pitstop-context.sh");
const SESSION_ID_HOOK = join(REPO_ROOT, "packages/scripts/pitstop-session-id.sh");

function step(msg: string) {
  console.log(`\n▸ ${msg}`);
}
function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function note(msg: string) {
  console.log(`  · ${msg}`);
}
function warn(msg: string) {
  console.log(`  ⚠ ${msg}`);
}

async function readJson(path: string): Promise<any> {
  if (!existsSync(path)) return {};
  const text = await readFile(path, "utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function writeJson(path: string, data: any): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

// ─── 1. Build dist bundles ────────────────────────────────────────────────
async function assertBuilt(target: string) {
  if (!existsSync(target)) {
    throw new Error(
      `build claimed success but ${target} is missing. ` +
        `This usually means the underlying command exited 0 without producing output. ` +
        `Try \`bun run --cwd packages/inject build\` directly to surface the error.`,
    );
  }
}

step("building mcp-adapter dist (node-targeted ESM)");
await $`bun build packages/mcp-adapter/src/index.ts --outfile packages/mcp-adapter/dist/index.js --target=node --format=esm`
  .cwd(REPO_ROOT)
  .quiet();
await assertBuilt(join(REPO_ROOT, "packages/mcp-adapter/dist/index.js"));
ok(`packages/mcp-adapter/dist/index.js`);

// `bun --cwd <dir> run <script>` silently no-ops on Bun 1.3.13 (prints the
// script list with exit 0 instead of executing). Use `bun run --cwd <dir>`
// instead, which Bun parses correctly.
step("building inject drawer bundle");
await $`bun run --cwd ${REPO_ROOT}/packages/inject build`.quiet();
await assertBuilt(join(REPO_ROOT, "packages/inject/dist/inject.js"));
ok(`packages/inject/dist/inject.js`);

// ─── 2. Register MCP server in ~/.claude.json ──────────────────────────────
step(`registering MCP server in ${CLAUDE_JSON}`);
const claudeConfig = await readJson(CLAUDE_JSON);
claudeConfig.mcpServers ??= {};
const desired = {
  type: "stdio" as const,
  command: "node",
  args: [ADAPTER_DIST],
};
const existing = claudeConfig.mcpServers.pitstop;
if (existing && JSON.stringify(existing) === JSON.stringify(desired)) {
  ok("already registered (path matches)");
} else {
  if (existing) note(`replacing existing entry (was: ${existing.command} ${existing.args?.[0] ?? ""})`);
  claudeConfig.mcpServers.pitstop = desired;
  await writeJson(CLAUDE_JSON, claudeConfig);
  ok("registered");
}

// ─── 3. Install hooks ─────────────────────────────────────────────────────
step(`installing hooks in ${SETTINGS_JSON}`);
const settings = await readJson(SETTINGS_JSON);
settings.hooks ??= {};
type HookEntry = { hooks: Array<{ type: string; command: string }> };

function installHook(eventName: string, scriptPath: string, label: string) {
  settings.hooks[eventName] ??= [];
  const list = settings.hooks[eventName] as HookEntry[];
  const already = list.some((entry) => entry.hooks?.some((h) => h.command === scriptPath));
  if (already) {
    ok(`${label}: already installed`);
    return false;
  }
  list.push({ hooks: [{ type: "command", command: scriptPath }] });
  ok(`${label}: installed`);
  return true;
}

// UserPromptSubmit: surfaces unread responses as context on every prompt.
// SessionStart: captures CC session id so the MCP adapter can bind for pokes —
// CC doesn't pass it via env or JSON-RPC, so the hook is the bridge.
const promptHookAdded = installHook("UserPromptSubmit", HOOK_SCRIPT, "UserPromptSubmit (unread-context)");
const sessionHookAdded = installHook("SessionStart", SESSION_ID_HOOK, "SessionStart (bind session-id)");
if (promptHookAdded || sessionHookAdded) {
  await writeJson(SETTINGS_JSON, settings);
}

// ─── 4. Sanity-check Claude Code presence ─────────────────────────────────
step("checking for Claude Code CLI");
try {
  await $`which claude`.quiet();
  ok("claude found on PATH");
} catch {
  warn("`claude` not found on PATH — install Claude Code, then restart your shell.");
}

// ─── 5. Final instructions ────────────────────────────────────────────────
console.log(`
${"─".repeat(60)}
✓ pitstop is set up.

Two things you still need to do manually:

  1. Restart Claude Code (or open a new session) so it loads the
     pitstop MCP server. Verify:

       claude mcp list | grep pitstop
       # pitstop: node ${ADAPTER_DIST} - ✓ Connected

  2. Wire the drawer into your dev app. Add this script tag to its
     HTML during dev (Vite/Nuxt/Next.js/SvelteKit/Astro/plain HTML
     all work — wherever the tag fits):

       <script
         src="http://localhost:7773/inject.js?pitstop-project=<absolute-path-to-your-project>"
         defer
       ></script>

     Replace <absolute-path-to-your-project> with the project root.

Then ask the agent: "Start a pitstop review."
${"─".repeat(60)}
`);
