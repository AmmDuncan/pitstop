import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonOpts } from './server';
import { Store } from '../store/sessions';
import { Bus } from './sse';
import { ItemZ, SessionStatusZ } from '@walkthrough/shared';

const CreateZ = z.object({
  projectRoot: z.string(),
  branch: z.string().optional(),
  items: z.array(ItemZ.omit({ index: true }).partial({ id: true, attachments: true })),
  clientSessionId: z.string().optional(),
});

const StatusBodyZ = z.object({ status: SessionStatusZ });

export function mountRoutes(app: Hono, opts: DaemonOpts) {
  const store = new Store(opts.dataDir);
  const bus = new Bus();

  app.post('/api/sessions', async (c) => {
    const parsed = CreateZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

    const existing = await store.getActive(parsed.data.projectRoot);
    if (existing && existing.status !== 'idle') {
      return c.json({ error: 'ALREADY_ACTIVE', sessionId: existing.id }, 409);
    }
    const session = await store.create(parsed.data as Parameters<typeof store.create>[0]);
    bus.publish(session.id, { type: 'state-snapshot', session });
    return c.json(session, 201);
  });

  app.get('/api/sessions/active', async (c) => {
    const projectRoot = c.req.query('projectRoot');
    if (!projectRoot) return c.json({ error: 'projectRoot required' }, 400);
    const session = await store.getActive(projectRoot);
    if (!session) return c.json({ error: 'NO_ACTIVE_SESSION' }, 404);
    return c.json(session);
  });

  app.get('/api/sessions/:id', async (c) => {
    const session = await store.get(c.req.param('id'));
    if (!session) return c.json({ error: 'NOT_FOUND' }, 404);
    return c.json(session);
  });

  app.post('/api/sessions/:id/status', async (c) => {
    const parsed = StatusBodyZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);
    const session = await store.update(c.req.param('id'), (s) => ({ ...s, status: parsed.data.status }));
    bus.publish(session.id, { type: 'state-changed', session });
    return c.json(session);
  });

  Object.assign(app, { _store: store, _bus: bus });
}
