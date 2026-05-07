import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveClientSessionId } from "../src/session-id";

/** Creates an isolated `~/.claude` tree under tmpdir and returns its root. */
function makeFakeHome(): string {
  return mkdtempSync(join(tmpdir(), "pitstop-sid-"));
}

function writeHookFile(home: string, ppid: number, sessionId: string): void {
  const dir = join(home, ".claude", "pitstop");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `cc-session-${ppid}.txt`), `${sessionId}\n`);
}

function writeTranscript(home: string, cwd: string, sessionId: string, mtime: number): void {
  const encoded = cwd.replace(/\//g, "-");
  const dir = join(home, ".claude", "projects", encoded);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, "{}\n");
  const seconds = mtime / 1000;
  utimesSync(path, seconds, seconds);
}

describe("resolveClientSessionId", () => {
  test("env CLAUDE_CODE_SESSION_ID wins over hook file and transcript", () => {
    const home = makeFakeHome();
    writeHookFile(home, 12345, "from-hook");
    writeTranscript(home, "/work/proj", "from-transcript", Date.now());
    const id = resolveClientSessionId({
      homeDir: home,
      cwd: "/work/proj",
      ppid: 12345,
      env: { CLAUDE_CODE_SESSION_ID: "from-env" },
    });
    expect(id).toBe("from-env");
  });

  test("legacy CLAUDE_SESSION_ID is honored when CLAUDE_CODE_SESSION_ID is unset", () => {
    const home = makeFakeHome();
    const id = resolveClientSessionId({
      homeDir: home,
      cwd: "/work/proj",
      ppid: 12345,
      env: { CLAUDE_SESSION_ID: "legacy" },
    });
    expect(id).toBe("legacy");
  });

  test("hook file at the matching ppid is read when env is empty", () => {
    const home = makeFakeHome();
    writeHookFile(home, 99999, "from-hook");
    const id = resolveClientSessionId({
      homeDir: home,
      cwd: "/work/proj",
      ppid: 99999,
      env: {},
    });
    expect(id).toBe("from-hook");
  });

  test("ppid mismatch falls through to transcript scan", () => {
    const home = makeFakeHome();
    writeHookFile(home, 11111, "wrong-ppid");
    writeTranscript(home, "/work/proj", "from-transcript", Date.now());
    const id = resolveClientSessionId({
      homeDir: home,
      cwd: "/work/proj",
      ppid: 22222,
      env: {},
    });
    expect(id).toBe("from-transcript");
  });

  test("transcript scan picks the most-recently-modified .jsonl", () => {
    const home = makeFakeHome();
    const now = Date.now();
    writeTranscript(home, "/work/proj", "older", now - 60_000);
    writeTranscript(home, "/work/proj", "newer", now);
    writeTranscript(home, "/work/proj", "oldest", now - 600_000);
    const id = resolveClientSessionId({
      homeDir: home,
      cwd: "/work/proj",
      ppid: 0,
      env: {},
    });
    expect(id).toBe("newer");
  });

  test("returns undefined when env, hook file, and transcript dir are all empty", () => {
    const home = makeFakeHome();
    const id = resolveClientSessionId({
      homeDir: home,
      cwd: "/never-touched",
      ppid: 0,
      env: {},
    });
    expect(id).toBeUndefined();
  });
});
