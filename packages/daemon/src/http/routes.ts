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

const ResponseInZ = z.object({
  itemId: z.string(),
  kind: z.enum(['approve', 'comment']),
  body: z.string().optional(),
});

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

  app.get('/api/sessions/:id/events', (c) => {
    const id = c.req.param('id');
    return new Response(
      new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const send = (event: string, data: unknown) => {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          // Initial snapshot
          const session = await store.get(id);
          if (!session) {
            send('error', { error: 'NOT_FOUND' });
            controller.close();
            return;
          }
          send('state-snapshot', { type: 'state-snapshot', session });
          // Live stream
          const unsub = bus.subscribe(id, (event) => send(event.type, event));
          // Heartbeat every 25s so proxies don't close the connection on idle
          const hb = setInterval(() => controller.enqueue(enc.encode(`: heartbeat\n\n`)), 25_000);
          c.req.raw.signal.addEventListener('abort', () => {
            clearInterval(hb);
            unsub();
            try { controller.close(); } catch {}
          });
        },
      }),
      { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } },
    );
  });

  app.post('/api/sessions/:id/responses', async (c) => {
    const id = c.req.param('id');
    const parsed = ResponseInZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

    const r = { ...parsed.data, at: Date.now(), addressed: false };
    const session = await store.update(id, (s) => ({ ...s, responses: [...s.responses, r] }));
    bus.publish(id, { type: 'state-changed', session });

    // Poke policy:
    //   - looks-good (kind === 'approve'): never poke
    //   - comment + paused: never poke (queues for resume)
    //   - comment + in-flight poke: piggy-back on existing
    //   - comment otherwise: spawn one poke; on exit, drain any queued comments
    const shouldPoke =
      r.kind === 'comment' &&
      session.status !== 'paused' &&
      !session.pokePid;

    if (shouldPoke) {
      const { ClaudeResumePoke } = await import('../poke/claude-resume');
      const poke = new ClaudeResumePoke({ spawn: opts.spawn });
      const ctx = `Walkthrough item ${r.itemId} got a new comment: ${r.body}. Read get_unread_responses(${id}) for the full list.`;
      try {
        const { pid, exited } = await poke.trigger({
          sessionId: id,
          clientSessionId: session.clientSessionId,
          context: ctx,
        });
        await store.update(id, (s) => ({ ...s, pokePid: pid, pokeSpawnedAt: Date.now() }));
        // When the poke subprocess exits: clear pokePid; if responses still unaddressed, fire one drain poke.
        exited.then(async () => {
          const updated = await store.update(id, (s) => ({ ...s, pokePid: undefined, pokeSpawnedAt: undefined }));
          const stillUnread = updated.responses.some((rr) => !rr.addressed);
          if (stillUnread && updated.status !== 'paused' && updated.clientSessionId) {
            const ctx2 = `Some responses queued while you were busy on session ${id}. Read get_unread_responses(${id}).`;
            try {
              const next = await poke.trigger({ sessionId: id, clientSessionId: updated.clientSessionId, context: ctx2 });
              await store.update(id, (s) => ({ ...s, pokePid: next.pid, pokeSpawnedAt: Date.now() }));
            } catch (err) {
              console.error('drain poke failed', err);
            }
          }
        });
      } catch (err) {
        console.error('poke failed', err);
      }
    }

    return c.json({ accepted: true }, 202);
  });

  const RpcZ = z.object({ method: z.string(), params: z.unknown() });
  app.post('/api/rpc', async (c) => {
    const parsed = RpcZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);
    const { tools } = await import('../tools');
    const fn = (tools as Record<string, Function>)[parsed.data.method];
    if (!fn) return c.json({ error: `UNKNOWN_TOOL: ${parsed.data.method}` }, 404);
    try {
      const clientSessionId = c.req.header('x-client-session-id') ?? undefined;
      const baseUrl = `http://localhost:${opts.port}`;
      const result = await fn({ store, bus, baseUrl, clientSessionId }, parsed.data.params);
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.startsWith('ALREADY_ACTIVE') ? 409 : msg === 'NOT_FOUND' ? 404 : 500;
      return c.json({ error: msg }, status);
    }
  });

  app.get('/inject.js', async () => {
    const file = Bun.file(new URL('../../../inject/dist/inject.js', import.meta.url));
    return new Response(file, { headers: { 'content-type': 'application/javascript', 'cache-control': 'no-cache' } });
  });

  Object.assign(app, { _store: store, _bus: bus });
}
