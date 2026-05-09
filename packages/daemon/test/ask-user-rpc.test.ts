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
        items: [{ id: "01", title: "T", body: "B" }],
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

test("ask_user accepts a chatMirror that's at least as long as the question", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ask-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const question = "Should I prefill the cart with one item or three?";
  const chatMirror =
    "I need to know how to prefill the cart:\n  - ONE: a single item\n  - THREE: three items";
  const { status, body } = await rpc(app, "ask_user", {
    sessionId: session.id,
    question,
    chatMirror,
    options: [{ label: "ONE" }, { label: "THREE" }],
  });
  expect(status).toBe(200);
  expect(body).toEqual({ ok: true });
});

test("ask_user rejects a missing chatMirror", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ask-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const { status } = await rpc(app, "ask_user", {
    sessionId: session.id,
    question: "Should I do X?",
    options: [{ label: "YES" }, { label: "NO" }],
  });
  expect(status).toBe(500);
});

test("ask_user rejects a chatMirror shorter than the question (the 'see drawer' cop-out case)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ask-"));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const { status, body } = await rpc(app, "ask_user", {
    sessionId: session.id,
    question: "Should I prefill the cart with one item or three?",
    chatMirror: "see drawer",
    options: [{ label: "ONE" }, { label: "THREE" }],
  });
  expect(status).toBe(500);
  expect(JSON.stringify(body)).toContain("chatMirror");
});
