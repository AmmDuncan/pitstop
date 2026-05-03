import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

test('POST /responses persists + broadcasts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const cr = await app.fetch(new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] }),
  }));
  const session = await cr.json();
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '01', kind: 'approve' }),
  }));
  expect(r.status).toBe(202);
  const updated = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}`));
  const s = await updated.json();
  expect(s.responses).toHaveLength(1);
  expect(s.responses[0].kind).toBe('approve');
  expect(s.responses[0].addressed).toBe(false);
});
