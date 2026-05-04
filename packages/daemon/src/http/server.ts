import { Hono } from 'hono';
import type { spawn as NodeSpawn } from 'node:child_process';
import type { PokeKind } from '@pitstop/shared';
import { mountRoutes } from './routes';

export type DaemonOpts = {
  port: number;
  dataDir: string;
  spawn?: typeof NodeSpawn;
  pokeKind?: PokeKind;
  scriptsDir?: string;
};

export function buildApp(opts: DaemonOpts) {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));
  mountRoutes(app, opts);
  return app;
}
