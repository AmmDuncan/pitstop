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

// Regression for the v0.3.65 race fix. Ten parallel narrate calls used to
// drop ~80% of beats — both because writeAtomic's tmp name collided when
// two writes hit the same millisecond, and because store.update read the
// file, mutated, and wrote back without serialization. With the per-id
// mutex + UUID tmp name, every call must persist.
test("store.update serializes concurrent writers — no narrations dropped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "race-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const created = await rpc(app, "start_review", {
    projectRoot: "/tmp/race",
    items: [{ title: "x", body: "x" }],
  });
  expect(created.status).toBe(200);
  const sid = created.body.sessionId;

  const N = 10;
  const calls = Array.from({ length: N }, (_, i) =>
    rpc(app, "narrate", { sessionId: sid, narration: `race-${i}` }),
  );
  const results = await Promise.all(calls);
  for (const r of results) {
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  }

  const state = await rpc(app, "get_state", { sessionId: sid });
  const narrations = (
    state.body.agentActivity as Array<{ tool: string; narration: string }>
  ).filter((a) => a.tool === "narrate");
  expect(narrations).toHaveLength(N);
  const seen = new Set(narrations.map((n) => n.narration));
  for (let i = 0; i < N; i++) expect(seen.has(`race-${i}`)).toBe(true);
});
