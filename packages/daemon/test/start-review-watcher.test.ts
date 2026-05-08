import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

test("start_review returns a watcher block with the script command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir, scriptsDir: "/custom/scripts" });
  const r = await app.fetch(
    new Request("http://localhost/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "start_review",
        params: { projectRoot: "/tmp/p", items: [{ title: "A", body: "a" }] },
      }),
    }),
  );
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.sessionId).toBeTruthy();
  expect(body.url).toContain(`/?session=${body.sessionId}`);
  expect(body.watcher).toBeTruthy();
  expect(body.watcher.command).toBe(`/custom/scripts/pitstop-watch.sh ${body.sessionId}`);
  expect(body.watcher.description).toContain("pitstop");
  expect(body.watcher.description).toContain(body.sessionId);
  expect(body.watcher.persistent).toBe(true);
});

test("start_review uses default scriptsDir when not provided", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const r = await app.fetch(
    new Request("http://localhost/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "start_review",
        params: { projectRoot: "/tmp/p", items: [{ title: "A", body: "a" }] },
      }),
    }),
  );
  const body = await r.json();
  expect(body.watcher.command).toMatch(/packages\/scripts\/pitstop-watch\.sh /);
  expect(body.watcher.command).toContain(body.sessionId);
});

test("start_review rejects empty items array with a zod error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const r = await app.fetch(
    new Request("http://localhost/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "start_review",
        params: { projectRoot: "/tmp/p", items: [] },
      }),
    }),
  );
  expect(r.status).toBe(500);
  const body = await r.json();
  expect(body.error).toContain("at least 1");
});
