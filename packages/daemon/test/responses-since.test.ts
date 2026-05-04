import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

async function createSessionWithResponses(app: any) {
  const cr = await app.fetch(new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] }),
  }));
  const session = await cr.json();
  // Submit two responses
  await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '01', kind: 'approve' }),
  }));
  // Ensure distinct `at` timestamps so the since= filter test isn't flaky on fast hardware.
  await new Promise((r) => setTimeout(r, 2));
  await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '01', kind: 'comment', body: 'hello' }),
  }));
  return session.id;
}

test('GET /responses returns all when no filters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const id = await createSessionWithResponses(app);
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${id}/responses`));
  expect(r.status).toBe(200);
  const list = await r.json();
  expect(list.length).toBe(2);
});

test('GET /responses?unaddressed=true filters to !addressed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const id = await createSessionWithResponses(app);
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${id}/responses?unaddressed=true`));
  expect(r.status).toBe(200);
  const list = await r.json();
  expect(list.length).toBe(2);
  expect(list.every((x: any) => x.addressed === false)).toBe(true);
});

test('GET /responses?since=<ts> filters to at > ts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const id = await createSessionWithResponses(app);
  // Fetch all, grab first timestamp
  const all = await (await app.fetch(new Request(`http://localhost/api/sessions/${id}/responses`))).json();
  const firstTs = all[0].at;
  // since=firstTs should exclude the first one (strict >)
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${id}/responses?since=${firstTs}`));
  const filtered = await r.json();
  expect(filtered.length).toBe(1);
  expect(filtered[0].at).toBeGreaterThan(firstTs);
});

test('GET /responses returns 404 for unknown session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const r = await app.fetch(new Request(`http://localhost/api/sessions/missing/responses`));
  expect(r.status).toBe(404);
});

test('GET /responses returns ascending by `at`', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const id = await createSessionWithResponses(app);
  const list = await (await app.fetch(new Request(`http://localhost/api/sessions/${id}/responses`))).json();
  for (let i = 1; i < list.length; i++) {
    expect(list[i].at).toBeGreaterThanOrEqual(list[i - 1].at);
  }
});
