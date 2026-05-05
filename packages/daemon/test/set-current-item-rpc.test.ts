import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

async function createSession(app: any) {
  const cr = await app.fetch(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectRoot: "/tmp/p",
        items: [
          { title: "A", body: "a" },
          { title: "B", body: "b" },
        ],
      }),
    }),
  );
  return cr.json();
}

async function rpc(app: any, method: string, params: unknown) {
  const r = await app.fetch(
    new Request("http://localhost/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
    }),
  );
  return { status: r.status, body: await r.json() };
}

test("set_current_item RPC writes currentItemId and broadcasts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const events = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/events`));
  const reader = events.body!.getReader();
  await reader.read(); // drain initial snapshot

  const { status, body } = await rpc(app, "set_current_item", { sessionId: session.id, itemId: "02" });
  expect(status).toBe(200);
  expect(body).toEqual({ ok: true });

  const fetched = await (await app.fetch(new Request(`http://localhost/api/sessions/${session.id}`))).json();
  expect(fetched.currentItemId).toBe("02");

  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  expect(text).toContain("event: state-changed");
  expect(text).toContain('"currentItemId":"02"');
  reader.cancel();
});

test("set_current_item rejects unknown sessionId", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const { status, body } = await rpc(app, "set_current_item", { sessionId: "missing", itemId: "01" });
  expect(status).not.toBe(200);
  expect(JSON.stringify(body)).toContain("NOT_FOUND");
});

test("set_current_item rejects unknown itemId", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const { status, body } = await rpc(app, "set_current_item", { sessionId: session.id, itemId: "bogus" });
  expect(status).not.toBe(200);
  expect(JSON.stringify(body)).toContain("UNKNOWN_ITEM_ID");
});
