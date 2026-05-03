import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../daemon/src/http/server';
import { Forwarder } from '../src/forward';

let server: ReturnType<typeof Bun.serve>;
let port: number;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  server = Bun.serve({ port: 0, fetch: app.fetch });
  port = server.port;
});
afterAll(() => server.stop());

test('Forwarder.call hits /api/rpc and returns the result', async () => {
  const fwd = new Forwarder({ baseUrl: `http://localhost:${port}`, clientSessionId: 'cs-1' });
  const result = await fwd.call('start_review', { projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] });
  expect((result as any).sessionId).toBeDefined();
});
