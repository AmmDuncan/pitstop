import { z } from 'zod';
import { ItemZ, type Session } from '@pitstop/shared';
import type { Store } from '../store/sessions';
import type { Bus } from '../http/sse';

type Ctx = { store: Store; bus: Bus; baseUrl: string; clientSessionId?: string; scriptsDir: string };

const StartReviewZ = z.object({
  projectRoot: z.string(),
  branch: z.string().optional(),
  items: z.array(ItemZ.omit({ index: true }).partial({ id: true, attachments: true })),
});

export const tools = {
  async start_review(ctx: Ctx, params: unknown) {
    const p = StartReviewZ.parse(params);
    const existing = await ctx.store.getActive(p.projectRoot);
    if (existing && existing.status !== 'idle') {
      throw new Error(`ALREADY_ACTIVE:${existing.id}`);
    }
    const session = await ctx.store.create({ ...p, clientSessionId: ctx.clientSessionId } as any);
    ctx.bus.publish(session.id, { type: 'state-snapshot', session });
    return {
      sessionId: session.id,
      url: `${ctx.baseUrl}/?session=${session.id}`,
      watcher: {
        command: `${ctx.scriptsDir}/pitstop-watch.sh ${session.id}`,
        description: `pitstop unread responses · session ${session.id}`,
        persistent: true,
      },
    };
  },

  async add_items(ctx: Ctx, params: unknown) {
    const P = z.object({ sessionId: z.string(), items: z.array(ItemZ) });
    const { sessionId, items } = P.parse(params);
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      items: [...s.items, ...items.map((it, i) => ({ ...it, index: s.items.length + i + 1 }))],
      lastAgentActivityAt: Date.now(),
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: 'item-added', sessionId, items });
    ctx.bus.publish(sessionId, { type: 'state-changed', session });
    return { ok: true };
  },

  async get_state(ctx: Ctx, params: unknown) {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(params);
    const session = await ctx.store.get(sessionId);
    if (!session) throw new Error('NOT_FOUND');
    // Update activity (separate from get to avoid mutating on every internal read).
    const updated = await ctx.store.update(sessionId, (s) => ({
      ...s,
      lastAgentActivityAt: Date.now(),
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: 'state-changed', session: updated });
    return updated;
  },

  async get_unread_responses(ctx: Ctx, params: unknown) {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(params);
    let snapshot: Session | null = null;
    const session = await ctx.store.update(sessionId, (s) => {
      const unread = s.responses.filter((r) => !r.addressed);
      if (unread.length === 0) {
        snapshot = s;
        return { ...s, lastAgentActivityAt: Date.now(), pokeFailed: false };
      }
      return {
        ...s,
        responses: s.responses.map((r) => ({ ...r, addressed: true })),
        lastAgentActivityAt: Date.now(),
        pokeFailed: false,
      };
    });
    return session.responses.filter((r) =>
      snapshot
        ? !snapshot.responses.find((q) => q.itemId === r.itemId && q.at === r.at)?.addressed
        : true,
    );
  },

  async mark_addressing(ctx: Ctx, params: unknown) {
    const P = z.object({ sessionId: z.string(), itemId: z.string().nullable(), narration: z.string() });
    const { sessionId, itemId, narration } = P.parse(params);
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      agentActivity: [...s.agentActivity, { at: Date.now(), tool: 'mark_addressing', narration }].slice(-50),
      lastAgentActivityAt: Date.now(),
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: 'agent-activity', sessionId, entry: { at: Date.now(), tool: 'mark_addressing', narration } });
    ctx.bus.publish(sessionId, { type: 'state-changed', session });
    return { ok: true };
  },

  async set_current_item(ctx: Ctx, params: unknown) {
    const P = z.object({ sessionId: z.string(), itemId: z.string() });
    const { sessionId, itemId } = P.parse(params);
    const cur = await ctx.store.get(sessionId);
    if (!cur) throw new Error('NOT_FOUND');
    if (!cur.items.some((it) => it.id === itemId)) throw new Error(`UNKNOWN_ITEM_ID:${itemId}`);
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      currentItemId: itemId,
      lastAgentActivityAt: Date.now(),
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: 'state-changed', session });
    return { ok: true };
  },

  async complete_review(ctx: Ctx, params: unknown) {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(params);
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      status: 'complete',
      lastAgentActivityAt: Date.now(),
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: 'complete', sessionId });
    ctx.bus.publish(sessionId, { type: 'state-changed', session });
    return { ok: true };
  },
};

export type ToolName = keyof typeof tools;
