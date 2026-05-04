import { z } from 'zod';
import { ItemZ, type Session } from '@pitstop/shared';
import type { Store } from '../store/sessions';
import type { Bus } from '../http/sse';
import { wire_drawer } from './wire-drawer';

type Ctx = {
  store: Store;
  bus: Bus;
  baseUrl: string;
  clientSessionId?: string;
  scriptsDir: string;
  /** projectRoot → epoch ms of the last `/inject.js` GET seen for it. Lets
   *  start_review tell the agent if the drawer probably isn't wired yet. */
  drawerSeen?: Map<string, number>;
};

const DRAWER_FRESHNESS_MS = 10 * 60 * 1000;

const StartReviewZ = z.object({
  projectRoot: z.string(),
  branch: z.string().optional(),
  /** Origins (e.g. http://localhost:3000) where this review's surfaces live.
   *  Lets the browser-extension drawer scope itself to the right tabs. */
  devUrls: z.array(z.string()).optional(),
  items: z.array(ItemZ.omit({ index: true }).partial({ id: true, attachments: true })),
});

export const tools = {
  async start_review(ctx: Ctx, params: unknown) {
    const p = StartReviewZ.parse(params);
    const existing = await ctx.store.getActive(p.projectRoot);
    if (existing && existing.status !== 'idle') {
      throw new Error(`ALREADY_ACTIVE:${existing.id}`);
    }
    // If there's an existing idle-and-stale session for this projectRoot
    // (created but no responses, no agent activity), drop it before creating
    // the fresh one. Avoids the "graveyard of abandoned start_reviews" file
    // pile-up. We only do this for stale idle — idle sessions with responses
    // are real work the user might want preserved.
    if (existing && existing.status === 'idle' &&
        existing.responses.length === 0 && existing.agentActivity.length === 0) {
      await ctx.store.delete(existing.id);
    }

    const session = await ctx.store.create({
      ...p,
      devUrls: p.devUrls ?? [],
      clientSessionId: ctx.clientSessionId,
    } as any);
    ctx.bus.publish(session.id, { type: 'state-snapshot', session });

    // Drawer-wiring sniff: if /inject.js has not been requested for this
    // projectRoot in the last 10 min, the agent should warn the user before
    // driving anything — they'll otherwise sit watching a session URL that
    // 404s with no clue why.
    const lastSeen = ctx.drawerSeen?.get(p.projectRoot);
    const drawerLikelyConnected = lastSeen !== undefined && Date.now() - lastSeen < DRAWER_FRESHNESS_MS;
    const drawerStatus = drawerLikelyConnected
      ? { connected: true as const, lastSeenAt: lastSeen! }
      : {
          connected: false as const,
          hint:
            'No /inject.js fetch seen for this projectRoot in the last 10 minutes — the drawer probably is not wired into the dev app yet. ' +
            `Call wire_drawer({ projectRoot: ${JSON.stringify(p.projectRoot)} }) — it returns the framework + two wiring options (committed conditional snippet vs local-only gitignored file) with exact snippets and file paths. Surface the options to the user via AskUserQuestion, then perform the file edit yourself. Do NOT paste raw snippets into the conversation and ask the user to do it.`,
        };

    return {
      sessionId: session.id,
      url: `${ctx.baseUrl}/?session=${session.id}`,
      drawerStatus,
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
    const P = z.object({
      sessionId: z.string(),
      itemId: z.string().nullable(),
      narration: z.string(),
      arrived: z.boolean().optional(),
    });
    const { sessionId, itemId, narration, arrived } = P.parse(params);
    const at = Date.now();
    const entry = {
      at,
      tool: 'mark_addressing',
      narration,
      itemId: itemId ?? undefined,
      // Default true keeps v0.3.13–v0.3.20 callers working unchanged.
      arrived: arrived ?? true,
    };
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      agentActivity: [...s.agentActivity, entry].slice(-50),
      lastAgentActivityAt: at,
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: 'agent-activity', sessionId, entry });
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

  async wire_drawer(_ctx: Ctx, params: unknown) {
    return wire_drawer(params);
  },

  async ask_user(ctx: Ctx, params: unknown) {
    const P = z.object({
      sessionId: z.string(),
      question: z.string().min(1),
      options: z.array(z.object({
        label: z.string().min(1),
        description: z.string().optional(),
      })).optional(),
      itemId: z.string().optional(),
    });
    const { sessionId, question, options, itemId } = P.parse(params);
    const at = Date.now();
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      pendingQuestion: { question, options: options ?? [], itemId, askedAt: at },
      // Push a feed entry so the question shows in the AgentFeed history too.
      agentActivity: [
        ...s.agentActivity,
        { at, tool: 'ask_user', narration: `❓ ${question}`, itemId },
      ].slice(-50),
      lastAgentActivityAt: at,
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, {
      type: 'agent-activity',
      sessionId,
      entry: { at, tool: 'ask_user', narration: `❓ ${question}`, itemId },
    });
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
    // Publish events first (subscribers update their UI), THEN drop the file
    // — completed sessions have no consumer. See CHANGELOG v0.3.11.
    ctx.bus.publish(sessionId, { type: 'complete', sessionId });
    ctx.bus.publish(sessionId, { type: 'state-changed', session });
    await ctx.store.delete(sessionId);
    return { ok: true };
  },
};

export type ToolName = keyof typeof tools;
