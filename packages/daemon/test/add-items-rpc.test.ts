import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

async function createSession(app: ReturnType<typeof buildApp>) {
  const r = await app.fetch(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectRoot: "/tmp/p",
        items: [{ title: "first", body: "b" }],
      }),
    }),
  );
  return r.json();
}

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

test("add_items accepts the same shape as start_review (no id/index required)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const { status, body } = await rpc(app, "add_items", {
    sessionId: session.id,
    items: [
      { title: "second", body: "b2" },
      { title: "third", body: "b3", lookFor: ["x"] },
    ],
  });
  expect(status).toBe(200);
  expect(body).toEqual({ ok: true });

  const state = await rpc(app, "get_state", { sessionId: session.id });
  expect(state.body.items).toHaveLength(3);
  expect(state.body.items[1]).toMatchObject({ id: "02", index: 2, title: "second" });
  expect(state.body.items[2]).toMatchObject({ id: "03", index: 3, title: "third", lookFor: ["x"] });
});

test("add_items honors caller-supplied id when present", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const { status } = await rpc(app, "add_items", {
    sessionId: session.id,
    items: [{ id: "custom", title: "second", body: "b2" }],
  });
  expect(status).toBe(200);
  const state = await rpc(app, "get_state", { sessionId: session.id });
  expect(state.body.items[1]).toMatchObject({ id: "custom", index: 2 });
});
