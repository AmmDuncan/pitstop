import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

test("GET /api/sessions/:id/events emits state-snapshot first", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  // create a session
  const cr = await app.fetch(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectRoot: "/tmp/p", items: [{ title: "T", body: "B" }] }),
    }),
  );
  const session = await cr.json();
  const res = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/events`));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  expect(text).toContain("event: state-snapshot");
  expect(text).toContain(session.id);
  reader.cancel();
});
