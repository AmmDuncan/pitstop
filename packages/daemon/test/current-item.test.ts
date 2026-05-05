import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

async function createSession(
  app: any,
  items = [
    { title: "A", body: "a" },
    { title: "B", body: "b" },
  ],
) {
  const cr = await app.fetch(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectRoot: "/tmp/p", items }),
    }),
  );
  return cr.json();
}

test("POST /current-item sets currentItemId for a known item", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const r = await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/current-item`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "02" }),
    }),
  );
  expect(r.status).toBe(200);
  // Verify persisted
  const fetched = await (await app.fetch(new Request(`http://localhost/api/sessions/${session.id}`))).json();
  expect(fetched.currentItemId).toBe("02");
});

test("POST /current-item rejects an unknown itemId with 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const r = await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/current-item`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "bogus" }),
    }),
  );
  expect(r.status).toBe(400);
});

test("POST /current-item returns 404 for unknown session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const r = await app.fetch(
    new Request("http://localhost/api/sessions/missing/current-item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "01" }),
    }),
  );
  expect(r.status).toBe(404);
});

test("POST /current-item rejects malformed body with 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const r = await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/current-item`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}), // missing itemId
    }),
  );
  expect(r.status).toBe(400);
});

test("POST /current-item broadcasts state-changed over SSE", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const eventsRes = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/events`));
  const reader = eventsRes.body!.getReader();
  // Drain the initial state-snapshot
  await reader.read();
  // Trigger the update
  await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/current-item`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "02" }),
    }),
  );
  // Read the next chunk from the SSE stream
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  expect(text).toContain("event: state-changed");
  expect(text).toContain('"currentItemId":"02"');
  reader.cancel();
});
