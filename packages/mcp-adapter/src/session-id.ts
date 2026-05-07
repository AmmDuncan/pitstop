import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves the Claude Code session id that owns this MCP adapter process.
 * Used by the daemon to target `claude --resume <id>` pokes when the user
 * comments in the drawer. Tried in order:
 *
 *   1. Env var override — manual `CLAUDE_CODE_SESSION_ID=...` for dev/testing.
 *      Also keeps `CLAUDE_SESSION_ID` working as a legacy fallback.
 *   2. Hook file — `~/.claude/pitstop/cc-session-<ppid>.txt`, written by the
 *      `SessionStart` hook installed by `bun run setup`. Deterministic
 *      per-CC, robust against multi-CC concurrency in the same cwd.
 *   3. Transcript scan — most-recently-modified `.jsonl` in
 *      `~/.claude/projects/<encoded-cwd>/`, whose filename IS the session
 *      id. Best-effort fallback for users who haven't run setup; works
 *      because CC writes per-session transcripts and the active session is
 *      the one being appended to.
 *
 * Resolved per-call (not cached) so a new CC session driving the same
 * pitstop sees its own id flow through; the daemon's rebind logic reattaches
 * the session record to whoever's currently calling.
 */
export function resolveClientSessionId(): string | undefined {
  const env = process.env.CLAUDE_CODE_SESSION_ID ?? process.env.CLAUDE_SESSION_ID;
  if (env) return env;

  const hookFile = join(homedir(), ".claude", "pitstop", `cc-session-${process.ppid}.txt`);
  try {
    const id = readFileSync(hookFile, "utf-8").trim();
    if (id) return id;
  } catch {}

  try {
    const encoded = process.cwd().replace(/\//g, "-");
    const dir = join(homedir(), ".claude", "projects", encoded);
    let bestId: string | undefined;
    let bestMtime = 0;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const m = statSync(join(dir, f)).mtimeMs;
      if (m > bestMtime) {
        bestMtime = m;
        bestId = f.slice(0, -".jsonl".length);
      }
    }
    return bestId;
  } catch {}

  return undefined;
}
