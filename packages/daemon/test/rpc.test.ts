import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

test("POST /api/rpc start_review creates a session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const r = await app.fetch(
    new Request("http://localhost/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-session-id": "cs-123" },
      body: JSON.stringify({
        method: "start_review",
        params: { projectRoot: "/tmp/p", items: [{ title: "T", body: "B" }] },
      }),
    }),
  );
  expect(r.status).toBe(200);
  const result = await r.json();
  expect(result.sessionId).toBeDefined();
  expect(result.url).toContain("localhost");
});
