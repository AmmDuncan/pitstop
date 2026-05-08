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
        items: [
          { id: "01", title: "Original title", body: "Original body", lookFor: ["bullet 1"] },
          { id: "02", title: "Second", body: "Second body" },
        ],
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

test("update_item patches the listed fields and leaves others untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const { status, body } = await rpc(app, "update_item", {
    sessionId: session.id,
    itemId: "01",
    patch: { body: "New body", lookFor: ["new bullet"], concerns: ["new concern"] },
  });
  expect(status).toBe(200);
  expect(body).toEqual({ ok: true });

  const fetched = await (await app.fetch(new Request(`http://localhost/api/sessions/${session.id}`))).json();
  const item = fetched.items.find((it: { id: string }) => it.id === "01");
  expect(item.title).toBe("Original title");
  expect(item.body).toBe("New body");
  expect(item.lookFor).toEqual(["new bullet"]);
  expect(item.concerns).toEqual(["new concern"]);
  // Sibling item untouched
  const sibling = fetched.items.find((it: { id: string }) => it.id === "02");
  expect(sibling.body).toBe("Second body");
});

test("update_item replaces array fields wholesale (not append)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  await rpc(app, "update_item", {
    sessionId: session.id,
    itemId: "01",
    patch: { lookFor: ["replaced bullet"] },
  });
  const fetched = await (await app.fetch(new Request(`http://localhost/api/sessions/${session.id}`))).json();
  const item = fetched.items.find((it: { id: string }) => it.id === "01");
  expect(item.lookFor).toEqual(["replaced bullet"]);
});

test("update_item rejects unknown itemId", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const { status, body } = await rpc(app, "update_item", {
    sessionId: session.id,
    itemId: "bogus",
    patch: { body: "x" },
  });
  expect(status).not.toBe(200);
  expect(JSON.stringify(body)).toContain("UNKNOWN_ITEM_ID");
});

test("update_item rejects empty patch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const { status } = await rpc(app, "update_item", {
    sessionId: session.id,
    itemId: "01",
    patch: {},
  });
  expect(status).not.toBe(200);
});

test("update_item rejects unknown sessionId", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const { status, body } = await rpc(app, "update_item", {
    sessionId: "missing",
    itemId: "01",
    patch: { body: "x" },
  });
  expect(status).not.toBe(200);
  expect(JSON.stringify(body)).toContain("NOT_FOUND");
});
