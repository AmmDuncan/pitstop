import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store/sessions';
import { Bus } from '../src/http/sse';
import { PokeWatch } from '../src/lifecycle/poke-watch';

test('PokeWatch flips pokeFailed when no agent activity lands within the window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-pw-'));
  const store = new Store(dir);
  const bus = new Bus();
  const session = await store.create({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] });
  await store.update(session.id, (s) => ({ ...s, pokePid: 99, pokeSpawnedAt: Date.now() }));

  const watch = new PokeWatch({ store, bus, windowMs: 30 });
  watch.arm(session.id);

  await new Promise((r) => setTimeout(r, 80));
  const after = await store.get(session.id);
  expect(after?.pokeFailed).toBe(true);
});

test('PokeWatch does not flip pokeFailed when agent activity lands in time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-pw-'));
  const store = new Store(dir);
  const bus = new Bus();
  const session = await store.create({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] });
  const spawnedAt = Date.now();
  await store.update(session.id, (s) => ({ ...s, pokePid: 99, pokeSpawnedAt: spawnedAt }));

  const watch = new PokeWatch({ store, bus, windowMs: 50 });
  watch.arm(session.id);

  // Simulate an MCP tool call landing — bumps lastAgentActivityAt past pokeSpawnedAt.
  await store.update(session.id, (s) => ({ ...s, lastAgentActivityAt: spawnedAt + 5 }));

  await new Promise((r) => setTimeout(r, 100));
  const after = await store.get(session.id);
  expect(after?.pokeFailed).toBeFalsy();
});

test('PokeWatch.clear cancels a pending watch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-pw-'));
  const store = new Store(dir);
  const bus = new Bus();
  const session = await store.create({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] });
  await store.update(session.id, (s) => ({ ...s, pokePid: 99, pokeSpawnedAt: Date.now() }));

  const watch = new PokeWatch({ store, bus, windowMs: 30 });
  watch.arm(session.id);
  watch.clear(session.id);

  await new Promise((r) => setTimeout(r, 80));
  const after = await store.get(session.id);
  expect(after?.pokeFailed).toBeFalsy();
});
