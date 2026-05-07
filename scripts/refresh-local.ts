#!/usr/bin/env bun
import { $ } from "bun";

/**
 * refresh-local.ts — kill running pitstop processes so they pick up the
 * latest dist code on next spawn. Run after `bun run release X.Y.Z` (or
 * after `git pull && bun run setup` if updating from GitHub).
 *
 * What it does (automated):
 *   1. Kill the daemon — next MCP call auto-respawns from src.
 *   2. Kill every pitstop MCP subprocess so each Claude Code instance
 *      respawns its adapter from the freshly-built dist.
 *
 * What it CAN'T do (manual, listed at the end):
 *   3. Quit + relaunch each Claude Code instance. We can't kill your
 *      live conversations for you, so we list the running CC parent pids
 *      with their cwd so you know which to quit.
 *   4. Reload each dev tab with the drawer mounted.
 */

const log = (s: string) => console.log(s);
const ok = (s: string) => log(`  ✓ ${s}`);
const note = (s: string) => log(`  · ${s}`);

log("");
log("▸ killing daemon (auto-respawns on next MCP call)");
const daemonResult = await $`pkill -f "packages/daemon/src/index.ts"`.quiet().nothrow();
if (daemonResult.exitCode === 0) ok("daemon stopped");
else note("no running daemon to stop");

log("");
log("▸ killing pitstop MCP subprocesses");
const adapterCount = (
  await $`pgrep -f "mcp-adapter/dist/index.js" | wc -l`.text()
).trim();
const adapterResult = await $`pkill -f "mcp-adapter/dist/index.js"`.quiet().nothrow();
if (adapterResult.exitCode === 0) ok(`${adapterCount} adapter subprocess(es) stopped`);
else note("no running adapter subprocesses to stop");

log("");
log("▸ next steps (manual — we can't do these for you)");
log("");

// List running CC parent processes with cwd so the user can spot which to quit.
// macOS: lsof -p PID gives cwd via the `cwd` row.
const ccPids = (await $`pgrep -f "^claude " || pgrep -f "Claude.app"`.text())
  .trim()
  .split(/\s+/)
  .filter(Boolean);

if (ccPids.length === 0) {
  note("no running Claude Code instances detected");
} else {
  log("  Quit + relaunch each Claude Code instance you want refreshed:");
  for (const pid of ccPids) {
    const cmd = (await $`ps -o command= -p ${pid}`.text()).trim().slice(0, 60);
    const cwd = (await $`lsof -p ${pid}`.text())
      .split("\n")
      .find((line) => line.includes(" cwd "))
      ?.split(/\s+/)
      .pop();
    log(`    pid ${pid}  cwd=${cwd ?? "?"}  cmd=${cmd}…`);
  }
  log("");
  log("  CC's 'restart' isn't always a fresh process — only a full Cmd+Q");
  log("  (GUI app) or `kill <pid>` (CLI) is guaranteed to respawn the MCP");
  log("  subprocess against the freshly-built dist.");
}

log("");
log("  Then reload each dev tab with the drawer mounted (Cmd+R).");
log("");
log("✓ refresh-local done");
