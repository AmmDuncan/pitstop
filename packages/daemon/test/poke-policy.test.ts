import { expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/server";

test("poke policy: comment fires poke, second comment piggybacks, looks-good silent", async () => {
  const fakeSpawn = mock(() => ({ unref: () => {}, pid: 99, on: () => {} }) as any);
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir, spawn: fakeSpawn as any });

  const create = await app.fetch(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectRoot: "/tmp/p",
        items: [{ title: "T", body: "B" }],
        clientSessionId: "cs-1",
      }),
    }),
  );
  const session = await create.json();

  // looks-good: no poke
  await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "01", kind: "approve" }),
    }),
  );
  expect(fakeSpawn).toHaveBeenCalledTimes(0);

  // first comment: poke fires
  await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "01", kind: "comment", body: "too tight" }),
    }),
  );
  expect(fakeSpawn).toHaveBeenCalledTimes(1);

  // second comment: in-flight, no second spawn
  await app.fetch(
    new Request(`http://localhost/api/sessions/${session.id}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "01", kind: "comment", body: "also dim the chip" }),
    }),
  );
  expect(fakeSpawn).toHaveBeenCalledTimes(1);
});
