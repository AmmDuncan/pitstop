import { Hono } from 'hono';
import { mountRoutes } from './routes';

export type DaemonOpts = { port: number; dataDir: string };

export function buildApp(opts: DaemonOpts) {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));
  mountRoutes(app, opts);
  return app;
}
