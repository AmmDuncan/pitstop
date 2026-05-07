import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

test("GET /api/wired returns wired:false when drawer has never been seen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const res = await app.fetch(
    new Request(`http://localhost/api/wired?projectRoot=${encodeURIComponent("/tmp/p")}`),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.wired).toBe(false);
});

test("GET /api/wired returns wired:true after /inject.js is fetched for that projectRoot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  // Simulate the drawer fetching inject.js (sets drawerSeen for /tmp/p2)
  await app.fetch(new Request(`http://localhost/inject.js?pitstop-project=${encodeURIComponent("/tmp/p2")}`));
  const res = await app.fetch(
    new Request(`http://localhost/api/wired?projectRoot=${encodeURIComponent("/tmp/p2")}`),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.wired).toBe(true);
});

test("GET /api/wired returns 400 when projectRoot is missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const res = await app.fetch(new Request("http://localhost/api/wired"));
  expect(res.status).toBe(400);
});
