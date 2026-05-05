import { expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

test("paused state suppresses pokes; resume fires summarizing poke", async () => {
  const fakeSpawn = mock(() => ({ unref: () => {}, pid: 100, on: () => {} }) as any);
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir, spawn: fakeSpawn as any });

  // Create session with clientSessionId
  const create = await app.fetch(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectRoot: "/tmp/p",
        items: [{ title: "T", body: "B" }],
        clientSessionId: "cs-1",
      }),
    }),
  );
  const session = await create.json();

  // Flip to paused
  await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    }),
  );

  // Submit a comment while paused — no poke should fire
  await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "01", kind: "comment", body: "first while paused" }),
    }),
  );
  expect(fakeSpawn).toHaveBeenCalledTimes(0);

  // Submit another comment while paused — still no poke
  await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "01", kind: "comment", body: "second while paused" }),
    }),
  );
  expect(fakeSpawn).toHaveBeenCalledTimes(0);

  // Resume: paused → active. Should fire ONE summarizing poke for the queue.
  await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    }),
  );
  expect(fakeSpawn).toHaveBeenCalledTimes(1);

  // Inspect the args — context should mention queued responses, not a single comment
  const lastCall = fakeSpawn.mock.calls.at(-1) as any[];
  const argv = lastCall[1] as string[];
  const ctx = argv[argv.length - 1]!;
  expect(ctx).toMatch(/queued|resumed|paused/i);
});

test("resume from paused with NO queued responses does not poke", async () => {
  const fakeSpawn = mock(() => ({ unref: () => {}, pid: 100, on: () => {} }) as any);
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir, spawn: fakeSpawn as any });
  const create = await app.fetch(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectRoot: "/tmp/p2",
        items: [{ title: "T", body: "B" }],
        clientSessionId: "cs-2",
      }),
    }),
  );
  const session = await create.json();
  await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    }),
  );
  // No comments submitted during pause
  await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    }),
  );
  expect(fakeSpawn).toHaveBeenCalledTimes(0);
});
