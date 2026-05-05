import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

let dir: string;
let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wt-"));
  app = buildApp({ port: 0, dataDir: dir });
});

const json = (path: string, init?: RequestInit) => app.fetch(new Request(`http://localhost${path}`, init));

test("POST /api/sessions creates a session", async () => {
  const res = await json("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectRoot: "/tmp/p",
      items: [{ title: "T1", body: "B1" }],
    }),
  });
  expect(res.status).toBe(201);
  const s = await res.json();
  expect(s.id).toBeDefined();
  expect(s.items[0].id).toBe("01");
});

test("POST /api/sessions returns 409 for active duplicate", async () => {
  const body = JSON.stringify({ projectRoot: "/tmp/p", items: [{ title: "T", body: "B" }] });
  const r1 = await json("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const created = await r1.json();
  // mark it active so it's a "duplicate"
  await app.fetch(
    new Request(`http://localhost/api/sessions/${created.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    }),
  );
  const r2 = await json("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  expect(r2.status).toBe(409);
});

test("GET /api/sessions/active returns the active session for a projectRoot", async () => {
  const created = await (
    await json("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectRoot: "/tmp/p", items: [{ title: "T", body: "B" }] }),
    })
  ).json();
  const res = await json(`/api/sessions/active?projectRoot=${encodeURIComponent("/tmp/p")}`);
  expect(res.status).toBe(200);
  const s = await res.json();
  expect(s.id).toBe(created.id);
  rmSync(dir, { recursive: true, force: true });
});
