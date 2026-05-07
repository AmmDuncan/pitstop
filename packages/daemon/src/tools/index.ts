import { type ActivityEntry, ItemZ, type Session } from "@pitstop/shared";
import { z } from "zod";
import type { Bus } from "../http/sse";
import type { Store } from "../store/sessions";
import { wire_drawer } from "./wire-drawer";

/** Cap on the per-session agentActivity ring buffer. The drawer's AgentFeed
 *  only displays the most recent N entries; older ones are dropped here so
 *  session JSON files don't grow unboundedly. Centralized in one constant
 *  so a future change is one edit. */
const ACTIVITY_BUFFER = 50;
const appendActivity = (activities: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] =>
  [...activities, entry].slice(-ACTIVITY_BUFFER);

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
    if (existing && existing.status !== "idle") {
      throw new Error(`ALREADY_ACTIVE:${existing.id}`);
    }
    // If there's an existing idle-and-stale session for this projectRoot
    // (created but no responses, no agent activity), drop it before creating
    // the fresh one. Avoids the "graveyard of abandoned start_reviews" file
    // pile-up. We only do this for stale idle — idle sessions with responses
    // are real work the user might want preserved.
    if (
      existing &&
      existing.status === "idle" &&
      existing.responses.length === 0 &&
      existing.agentActivity.length === 0
    ) {
      await ctx.store.delete(existing.id);
    }

    const session = await ctx.store.create({
      ...p,
      devUrls: p.devUrls ?? [],
      clientSessionId: ctx.clientSessionId,
    } as any);
    ctx.bus.publish(session.id, { type: "state-snapshot", session });
    // Mirror the HTTP /api/sessions path: notify any drawer parked on the
    // project lobby (no session yet, OR the previous session just completed
    // and the drawer re-armed the lobby) so it can transition to this fresh
    // session without a tab reload. Without this publish, an MCP-driven
    // start_review is invisible to lobby subscribers.
    ctx.bus.publishToProject(session.projectRoot, { type: "session-hello", session });

    // Drawer-wiring sniff: if /inject.js has not been requested for this
    // projectRoot in the last 10 min, the agent should warn the user before
    // driving anything — they'll otherwise sit watching a session URL that
    // 404s with no clue why. Also catches the common bug where the agent
    // wired the drawer with a different projectRoot (e.g. /repo/apps/shop)
    // than it called start_review with (e.g. /repo) — the drawer fetches
    // /inject.js with its own key and the daemon won't bind the session.
    const lastSeen = ctx.drawerSeen?.get(p.projectRoot);
    const drawerLikelyConnected = lastSeen !== undefined && Date.now() - lastSeen < DRAWER_FRESHNESS_MS;
    let drawerStatus: { connected: true; lastSeenAt: number } | { connected: false; hint: string };
    if (drawerLikelyConnected) {
      drawerStatus = { connected: true as const, lastSeenAt: lastSeen! };
    } else {
      // Look for recently-seen projectRoots that are ancestors or descendants
      // of the requested one. These are almost always the agent calling
      // start_review and wire_drawer with mismatched paths.
      const now = Date.now();
      const seenRecently = Array.from(ctx.drawerSeen?.entries() ?? [])
        .filter(([root, ts]) => root !== p.projectRoot && now - ts < DRAWER_FRESHNESS_MS)
        .map(([root]) => root);
      const related = seenRecently.filter(
        (r) => r.startsWith(`${p.projectRoot}/`) || p.projectRoot.startsWith(`${r}/`),
      );
      if (related.length > 0) {
        drawerStatus = {
          connected: false as const,
          hint: `projectRoot mismatch likely — the session and the drawer must share the EXACT same projectRoot string for the drawer to bind. No /inject.js fetch seen for "${p.projectRoot}" in the last 10 minutes, but a drawer IS wired with a related path: ${related.map((r) => `"${r}"`).join(", ")}. Probable cause: start_review and wire_drawer were called with different projectRoots. Either retry start_review with one of the related paths above, or re-wire the drawer with "${p.projectRoot}". The drawer will sit on the empty start screen until they match.`,
        };
      } else {
        drawerStatus = {
          connected: false as const,
          hint:
            "No /inject.js fetch seen for this projectRoot in the last 10 minutes — the drawer probably is not wired into the dev app yet. " +
            `Call wire_drawer({ projectRoot: ${JSON.stringify(p.projectRoot)} }) — it returns the framework + two wiring options (committed conditional snippet vs local-only gitignored file) with exact snippets and file paths. Surface the options to the user via AskUserQuestion, then perform the file edit yourself. Do NOT paste raw snippets into the conversation and ask the user to do it.`,
        };
      }
    }

    // Surface a one-shot update offer. Agent reads this and decides whether
    // to ask the user "want me to run git pull && bun run setup?" — only on
    // the initial offer, not on subsequent calls during the same review.
    const { getUpdateStatus } = await import("../lifecycle/update-check");
    const updateStatus = getUpdateStatus();
    const update =
      updateStatus && updateStatus.updateAvailable && updateStatus.latest
        ? {
            current: updateStatus.current,
            latest: updateStatus.latest,
            releaseUrl: updateStatus.releaseUrl,
            installPath: updateStatus.installPath,
          }
        : undefined;

    return {
      sessionId: session.id,
      url: `${ctx.baseUrl}/?session=${session.id}`,
      drawerStatus,
      watcher: {
        command: `${ctx.scriptsDir}/pitstop-watch.sh ${session.id}`,
        description: `pitstop unread responses · session ${session.id}`,
        persistent: true,
      },
      // Hint: load these via ToolSearch up front so the agent doesn't
      // reach for AskUserQuestion (or do per-call ToolSearch latency)
      // mid-session. ask_user listed first because the steering against
      // AskUserQuestion only sticks if the agent has the tool loaded.
      toolsToPreload: [
        "mcp__pitstop__ask_user",
        "mcp__pitstop__narrate",
        "mcp__pitstop__mark_addressing",
        "mcp__pitstop__agent_address_comment",
        "mcp__pitstop__set_current_item",
        "mcp__pitstop__set_drawer",
        "mcp__pitstop__get_unread_responses",
        "mcp__pitstop__get_state",
        "mcp__pitstop__add_items",
        "mcp__pitstop__complete_review",
      ],
      ...(update ? { update } : {}),
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
    ctx.bus.publish(sessionId, { type: "item-added", sessionId, items });
    ctx.bus.publish(sessionId, { type: "state-changed", session });
    return { ok: true };
  },

  async get_state(ctx: Ctx, params: unknown) {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(params);
    // Single read via update — store.update throws "NOT_FOUND" if the session
    // doesn't exist, which the /api/rpc handler maps to 404. Updating
    // activity here is intentional; tool calls count as the agent showing up.
    const updated = await ctx.store.update(sessionId, (s) => ({
      ...s,
      lastAgentActivityAt: Date.now(),
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: "state-changed", session: updated });
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
      snapshot ? !snapshot.responses.find((q) => q.itemId === r.itemId && q.at === r.at)?.addressed : true,
    );
  },

  async narrate(ctx: Ctx, params: unknown) {
    const P = z.object({
      sessionId: z.string(),
      narration: z.string().min(1),
      itemId: z.string().optional(),
    });
    const { sessionId, narration, itemId } = P.parse(params);
    const at = Date.now();
    const entry = { at, tool: "narrate" as const, narration, itemId };
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      agentActivity: appendActivity(s.agentActivity, entry),
      lastAgentActivityAt: at,
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: "agent-activity", sessionId, entry });
    ctx.bus.publish(sessionId, { type: "state-changed", session });
    return { ok: true };
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
      tool: "mark_addressing",
      narration,
      itemId: itemId ?? undefined,
      // Default true keeps v0.3.13–v0.3.20 callers working unchanged.
      arrived: arrived ?? true,
    };
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      agentActivity: appendActivity(s.agentActivity, entry),
      lastAgentActivityAt: at,
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: "agent-activity", sessionId, entry });
    ctx.bus.publish(sessionId, { type: "state-changed", session });
    return { ok: true };
  },

  async agent_address_comment(ctx: Ctx, params: unknown) {
    const P = z.object({
      sessionId: z.string(),
      itemId: z.string(),
      narration: z.string().min(1),
    });
    const { sessionId, itemId, narration } = P.parse(params);
    const at = Date.now();
    const response = {
      itemId,
      kind: "agent-addressed" as const,
      body: narration,
      at,
      addressed: true,
    };
    const entry = { at, tool: "agent_address_comment", narration, itemId };
    // Validation lives inside the updater so we read the session once. Item-id
    // check throws from the closure; store.update propagates. NOT_FOUND comes
    // from store.update itself if the session doesn't exist.
    const session = await ctx.store.update(sessionId, (s) => {
      if (!s.items.some((it) => it.id === itemId)) throw new Error(`UNKNOWN_ITEM_ID:${itemId}`);
      return {
        ...s,
        responses: [...s.responses, response],
        agentActivity: appendActivity(s.agentActivity, entry),
        lastAgentActivityAt: at,
        pokeFailed: false,
      };
    });
    ctx.bus.publish(sessionId, { type: "agent-activity", sessionId, entry });
    ctx.bus.publish(sessionId, { type: "state-changed", session });
    return { ok: true };
  },

  async set_drawer(ctx: Ctx, params: unknown) {
    const P = z
      .object({
        sessionId: z.string(),
        position: z.enum(["right", "left", "floating"]).optional(),
        size: z.enum(["standard", "compact", "strip"]).optional(),
        narration: z.string().min(1),
      })
      .refine((p) => p.position !== undefined || p.size !== undefined, {
        message: "set_drawer requires at least one of position or size",
      });
    const { sessionId, position, size, narration } = P.parse(params);
    const at = Date.now();
    const entry = { at, tool: "set_drawer", narration };
    // No item-id validation needed; store.update throws NOT_FOUND on missing session.
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      agentActivity: appendActivity(s.agentActivity, entry),
      lastAgentActivityAt: at,
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: "agent-activity", sessionId, entry });
    ctx.bus.publish(sessionId, { type: "state-changed", session });
    ctx.bus.publish(sessionId, { type: "drawer-control", sessionId, position, size });
    return { ok: true };
  },

  async set_current_item(ctx: Ctx, params: unknown) {
    const P = z.object({ sessionId: z.string(), itemId: z.string() });
    const { sessionId, itemId } = P.parse(params);
    // Item-id check moves into the updater so we read the session once.
    const session = await ctx.store.update(sessionId, (s) => {
      if (!s.items.some((it) => it.id === itemId)) throw new Error(`UNKNOWN_ITEM_ID:${itemId}`);
      return {
        ...s,
        currentItemId: itemId,
        lastAgentActivityAt: Date.now(),
        pokeFailed: false,
      };
    });
    ctx.bus.publish(sessionId, { type: "state-changed", session });
    return { ok: true };
  },

  async wire_drawer(ctx: Ctx, params: unknown) {
    const result = await wire_drawer(params);
    // Cross-check active sessions: if any have a different projectRoot than
    // the one being wired, the agent has almost certainly called start_review
    // and wire_drawer with mismatched paths. Surface this LOUDLY so the agent
    // doesn't proceed to edit files for the wrong projectRoot.
    const all = await ctx.store.list();
    const mismatched = all.filter((s) => s.status !== "complete" && s.projectRoot !== result.projectRoot);
    if (mismatched.length > 0) {
      result.notes.unshift(
        `WARNING — projectRoot mismatch with active session(s): ${mismatched
          .map((s) => `"${s.projectRoot}" (session ${s.id})`)
          .join(
            ", ",
          )}. The session and the drawer must share the EXACT same projectRoot string to bind. After wiring with "${result.projectRoot}", the drawer will NOT render those sessions. Verify which path is correct: if "${result.projectRoot}" is the typo, retry wire_drawer with the matching path; if the existing session is wrong, complete_review or restart it with "${result.projectRoot}".`,
      );
    }
    return result;
  },

  async ask_user(ctx: Ctx, params: unknown) {
    const P = z.object({
      sessionId: z.string(),
      question: z.string().min(1),
      options: z
        .array(
          z.object({
            label: z.string().min(1),
            description: z.string().optional(),
          }),
        )
        .optional(),
      itemId: z.string().optional(),
    });
    const { sessionId, question, options, itemId } = P.parse(params);
    const at = Date.now();
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      pendingQuestion: { question, options: options ?? [], itemId, askedAt: at },
      // Push a feed entry so the question shows in the AgentFeed history too.
      agentActivity: appendActivity(s.agentActivity, {
        at,
        tool: "ask_user",
        narration: `❓ ${question}`,
        itemId,
      }),
      lastAgentActivityAt: at,
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, {
      type: "agent-activity",
      sessionId,
      entry: { at, tool: "ask_user", narration: `❓ ${question}`, itemId },
    });
    ctx.bus.publish(sessionId, { type: "state-changed", session });
    return { ok: true };
  },

  async complete_review(ctx: Ctx, params: unknown) {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(params);
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      status: "complete",
      lastAgentActivityAt: Date.now(),
      pokeFailed: false,
    }));
    // Publish events first (subscribers update their UI), THEN drop the file
    // — completed sessions have no consumer. See CHANGELOG v0.3.11.
    ctx.bus.publish(sessionId, { type: "complete", sessionId });
    ctx.bus.publish(sessionId, { type: "state-changed", session });
    await ctx.store.delete(sessionId);
    return { ok: true };
  },
};

export type ToolName = keyof typeof tools;
