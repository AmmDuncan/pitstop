import { test, expect } from 'bun:test';
import { buildApp } from '../src/http/server';

test('GET /health returns ok', async () => {
  const app = buildApp({ port: 0, dataDir: '/tmp/walkthrough-test' });
  const res = await app.fetch(new Request('http://localhost/health'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
