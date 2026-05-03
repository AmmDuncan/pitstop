import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store/sessions';

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-'));
  store = new Store(dir);
});

test('round-trip a session through disk', async () => {
  const created = await store.create({ projectRoot: '/tmp/p', items: [] });
  const loaded = await store.get(created.id);
  expect(loaded?.id).toBe(created.id);
  expect(loaded?.projectRoot).toBe('/tmp/p');
  expect(loaded?.status).toBe('idle');
  rmSync(dir, { recursive: true, force: true });
});

test('getActive returns the active session for a projectRoot', async () => {
  const a = await store.create({ projectRoot: '/tmp/p1', items: [] });
  await store.update(a.id, (s) => ({ ...s, status: 'active' }));
  await store.create({ projectRoot: '/tmp/p2', items: [] });
  const active = await store.getActive('/tmp/p1');
  expect(active?.id).toBe(a.id);
  rmSync(dir, { recursive: true, force: true });
});
