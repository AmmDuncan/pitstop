import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

async function rpc(app: ReturnType<typeof buildApp>, method: string, params: unknown) {
  const r = await app.fetch(
    new Request("http://localhost/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
    }),
  );
  return { status: r.status, body: await r.json() };
}

// drawerStatus.live should be false when no SSE subscriber exists, even if
// /inject.js was fetched recently (the orphaned-tab case from the v0.3.66
// real-flow report). This is the exact pattern that previously sent agents
// narrating into the void.
test("start_review reports live:false when no SSE subscriber on the project lobby", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-"));
  const app = buildApp({ port: 0, dataDir: dir });
  // Simulate a recent /inject.js fetch — that's what populates drawerSeen
  // and would set connected:true under the old heuristic.
  await app.fetch(new Request("http://localhost/inject.js?pitstop-project=/p"));
  const r = await rpc(app, "start_review", {
    projectRoot: "/p",
    items: [{ title: "x", body: "x" }],
  });
  expect(r.status).toBe(200);
  expect(r.body.drawerStatus.connected).toBe(true);
  expect(r.body.drawerStatus.live).toBe(false);
  expect(r.body.drawerStatus.hint).toContain("DRAWER NOT LIVE");
  // Steering bullet must be present so the agent knows to pause.
  expect(r.body.activeSessionRules.drawerLiveCheck).toContain("drawerStatus.live");
});

test("start_review reports live:true when a project-lobby subscriber is connected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-"));
  const app = buildApp({ port: 0, dataDir: dir });
  // Open an SSE subscription on the project lobby. The Hono streamSSE handler
  // returns a Response whose body is an unended ReadableStream — keep a reader
  // alive so the subscription persists across the next RPC.
  const lobby = await app.fetch(
    new Request("http://localhost/api/projects/events?projectRoot=/p"),
  );
  const reader = lobby.body!.getReader();
  // Don't await reader.read() in full — just kick it off so the server-side
  // listener is registered. A microtask is enough to let Hono register.
  void reader.read();
  await new Promise((r) => setTimeout(r, 20));

  await app.fetch(new Request("http://localhost/inject.js?pitstop-project=/p"));
  const r = await rpc(app, "start_review", {
    projectRoot: "/p",
    items: [{ title: "x", body: "x" }],
  });
  expect(r.status).toBe(200);
  expect(r.body.drawerStatus.connected).toBe(true);
  expect(r.body.drawerStatus.live).toBe(true);
  expect(r.body.drawerStatus.hint).toBeUndefined();

  await reader.cancel();
});

test("get_state surfaces a fresh drawerStatus so agents can re-poll after asking the user to open their tab", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-"));
  const app = buildApp({ port: 0, dataDir: dir });
  await app.fetch(new Request("http://localhost/inject.js?pitstop-project=/p"));
  const created = await rpc(app, "start_review", {
    projectRoot: "/p",
    items: [{ title: "x", body: "x" }],
  });
  const sid = created.body.sessionId;
  // Initial: no subscriber → live:false.
  const beforeState = await rpc(app, "get_state", { sessionId: sid });
  expect(beforeState.body.drawerStatus.live).toBe(false);

  // User opens their tab → drawer subscribes to lobby.
  const lobby = await app.fetch(
    new Request("http://localhost/api/projects/events?projectRoot=/p"),
  );
  const reader = lobby.body!.getReader();
  void reader.read();
  await new Promise((r) => setTimeout(r, 20));

  const afterState = await rpc(app, "get_state", { sessionId: sid });
  expect(afterState.body.drawerStatus.live).toBe(true);

  await reader.cancel();
});
