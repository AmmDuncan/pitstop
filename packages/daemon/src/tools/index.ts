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

export const DRAWER_FRESHNESS_MS = 10 * 60 * 1000;

type DrawerStatus =
  | { connected: true; live: true; lastSeenAt: number }
  | { connected: true; live: false; lastSeenAt: number; hint: string }
  | { connected: false; live: false; hint: string };

/** Compute the drawerStatus block for a given projectRoot. Used by both
 *  start_review (initial pre-flight) and get_state (re-check after the
 *  agent tells the user to open their tab). `live` is the gold signal
 *  (active SSE subscriber); `connected` is the coarse 10-min-fetch fallback.
 *  See feat/drawer-live-check (v0.3.66) for the contract the agent is
 *  steered to follow. */
function computeDrawerStatus(
  ctx: Ctx,
  projectRoot: string,
  devUrls?: string[],
): DrawerStatus {
  const lastSeen = ctx.drawerSeen?.get(projectRoot);
  const connected = lastSeen !== undefined && Date.now() - lastSeen < DRAWER_FRESHNESS_MS;
  const live = ctx.bus.projectSubscriberCount(projectRoot) > 0;
  if (connected && live) {
    return { connected: true, live: true, lastSeenAt: lastSeen! };
  }
  if (connected && !live) {
    return {
      connected: true,
      live: false,
      lastSeenAt: lastSeen!,
      hint:
        "DRAWER NOT LIVE — pitstop saw /inject.js for this projectRoot recently, but no browser tab currently has an open SSE subscription. Almost always: the user's tab is closed, was navigated away, or the dev server died and the page failed to reload. " +
        "DO NOT proceed with narrate, mark_addressing, or ask_user — they will fire into the void and the user will not see them. " +
        `Tell the user: "Your pitstop drawer isn't live in any open tab. Make sure your dev server is running and open the app at ${devUrls?.[0] ?? "your dev URL"}, then say 'go' and I'll resume." Wait for them before continuing.`,
    };
  }
  // No fetch in window. Look for ancestor/descendant projectRoots — almost
  // always a wire_drawer / start_review path mismatch.
  const now = Date.now();
  const seenRecently = Array.from(ctx.drawerSeen?.entries() ?? [])
    .filter(([root, ts]) => root !== projectRoot && now - ts < DRAWER_FRESHNESS_MS)
    .map(([root]) => root);
  const related = seenRecently.filter(
    (r) => r.startsWith(`${projectRoot}/`) || projectRoot.startsWith(`${r}/`),
  );
  if (related.length > 0) {
    return {
      connected: false,
      live: false,
      hint: `projectRoot mismatch likely — the session and the drawer must share the EXACT same projectRoot string for the drawer to bind. No /inject.js fetch seen for "${projectRoot}" in the last 10 minutes, but a drawer IS wired with a related path: ${related.map((r) => `"${r}"`).join(", ")}. Probable cause: start_review and wire_drawer were called with different projectRoots. Either retry start_review with one of the related paths above, or re-wire the drawer with "${projectRoot}". The drawer will sit on the empty start screen until they match.`,
    };
  }
  return {
    connected: false,
    live: false,
    hint:
      "No /inject.js fetch seen for this projectRoot in the last 10 minutes — the drawer probably is not wired into the dev app yet. " +
      `Call wire_drawer({ projectRoot: ${JSON.stringify(projectRoot)} }) — it returns the framework + two wiring options (committed conditional snippet vs local-only gitignored file) with exact snippets and file paths. Surface the options to the user via AskUserQuestion, then perform the file edit yourself. Do NOT paste raw snippets into the conversation and ask the user to do it.`,
  };
}

const StartReviewZ = z.object({
  projectRoot: z.string(),
  branch: z.string().optional(),
  /** Origins (e.g. http://localhost:3000) where this review's surfaces live.
   *  Lets the browser-extension drawer scope itself to the right tabs. */
  devUrls: z.array(z.string()).optional(),
  // A review with zero items has nothing for the user to walk — the drawer
  // would render an empty body. Reject up front rather than create a
  // ghost session that the agent then has to clean up.
  items: z.array(ItemZ.omit({ index: true }).partial({ id: true, attachments: true })).min(1),
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

    // Drawer pre-flight. See `computeDrawerStatus` JSDoc for the full
    // contract. Agent's job: only proceed past start_review when `live: true`.
    const drawerStatus = computeDrawerStatus(ctx, p.projectRoot, p.devUrls);

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
      // Cross-tool inversion table — read once at session start, sticks
      // better than steering buried in long tool descriptions. The mirror
      // dual-surface rule for narrate (last bullet) is the load-bearing
      // one: chat-only beats during a session never reach the user-in-
      // drawer, fail silently, look like the agent is hung.
      activeSessionRules: {
        drawerLiveCheck:
          "BEFORE narrating, asking, or marking arrival: check drawerStatus.live in this response. If false, the drawer is not mounted in any open tab — beats fire into the void. Tell the user to open their dev app + confirm the drawer is showing, then resume. Re-check by calling get_state; drawerStatus.live updates on subsequent calls' responses.",
        verificationSurface:
          'ANY surface the user needs to verify, check, or look at — call start_review or add_items, never "could you check this in the browser?"',
        conversationalBeat: "narrate(narration) — feed line, no state effects",
        surfaceArrival: "mark_addressing(itemId, narration[, arrived]) — pairs with set_current_item",
        blockingQuestion:
          "ask_user(question[, options]) — banner in drawer; pair with chat-mirror per its dual-surface rule",
        commentHandled:
          "agent_address_comment(itemId, narration) — flips pip to cyan ↻ when you've shipped/decided",
        chatAnswerToAskUser:
          "dismiss_pending_question(sessionId, answer?) — clears banner when user answered in chat instead of drawer",
        anyChatBeatTheUserInDrawerNeeds:
          "ALSO narrate it — the drawer is canonical for in-flight beats while a session is live; chat-only is invisible to the user. Mirror rule (cf. ask_user's drawer→chat dual-surface).",
      },
      // Hint: load these via ToolSearch up front so the agent doesn't
      // reach for AskUserQuestion (or do per-call ToolSearch latency)
      // mid-session. ask_user listed first because the steering against
      // AskUserQuestion only sticks if the agent has the tool loaded.
      toolsToPreload: [
        "mcp__pitstop__ask_user",
        "mcp__pitstop__dismiss_pending_question",
        "mcp__pitstop__narrate",
        "mcp__pitstop__mark_addressing",
        "mcp__pitstop__agent_address_comment",
        "mcp__pitstop__set_current_item",
        "mcp__pitstop__set_drawer",
        "mcp__pitstop__get_unread_responses",
        "mcp__pitstop__get_state",
        "mcp__pitstop__add_items",
        "mcp__pitstop__update_item",
        "mcp__pitstop__complete_review",
      ],
      ...(update ? { update } : {}),
    };
  },

  async update_item(ctx: Ctx, params: unknown) {
    const PatchZ = z
      .object({
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        lookFor: z.array(z.string()).optional(),
        concerns: z.array(z.string()).optional(),
        question: z.string().optional(),
      })
      .refine((p) => Object.keys(p).length > 0, {
        message: "patch must include at least one field",
      });
    const P = z.object({
      sessionId: z.string(),
      itemId: z.string(),
      patch: PatchZ,
    });
    const { sessionId, itemId, patch } = P.parse(params);
    // Item-id check inside the updater so we read the session once;
    // matches the pattern in set_current_item. store.update throws
    // "NOT_FOUND" if the session doesn't exist; the rpc handler maps
    // it to 404. UNKNOWN_ITEM_ID throws here when the patch targets a
    // missing item.
    const session = await ctx.store.update(sessionId, (s) => {
      if (!s.items.some((it) => it.id === itemId)) throw new Error(`UNKNOWN_ITEM_ID:${itemId}`);
      return {
        ...s,
        items: s.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
        lastAgentActivityAt: Date.now(),
        pokeFailed: false,
      };
    });
    ctx.bus.publish(sessionId, { type: "state-changed", session });
    return { ok: true };
  },

  async add_items(ctx: Ctx, params: unknown) {
    const P = z.object({
      sessionId: z.string(),
      items: z.array(ItemZ.omit({ index: true }).partial({ id: true, attachments: true })),
    });
    const { sessionId, items } = P.parse(params);
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      items: [
        ...s.items,
        ...items.map((it, i) => {
          const index = s.items.length + i + 1;
          return {
            ...it,
            id: it.id ?? String(index).padStart(2, "0"),
            index,
            tested: it.tested ?? [],
            attachments: it.attachments ?? [],
          };
        }),
      ],
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
    // Resuming agents land here without seeing start_review's response, so
    // they don't know there's a canonical watcher script. Returning it here
    // means cross-session resumes use pitstop-watch.sh (correct, line-safe)
    // instead of rolling their own SSE poller (awk pipe-buffering trap).
    // lastResponseAt is the freshness signal — get_state is a snapshot at
    // call time; the watcher is the way to monitor live changes.
    const lastResponseAt =
      updated.responses.length > 0
        ? updated.responses.reduce((max, r) => (r.at > max ? r.at : max), 0)
        : undefined;
    return {
      ...updated,
      lastResponseAt,
      // Re-check the drawer presence. Agents that paused on start_review's
      // `live: false` should poll this until it flips before resuming any
      // narrate / mark_addressing / ask_user calls.
      drawerStatus: computeDrawerStatus(ctx, updated.projectRoot, updated.devUrls),
      watcher: {
        command: `${ctx.scriptsDir}/pitstop-watch.sh ${updated.id}`,
        description: `pitstop unread responses · session ${updated.id}`,
        persistent: true,
      },
    };
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

  /**
   * Clear an in-flight `pendingQuestion` from the session. Use when the
   * user answered the question via chat instead of clicking an option in
   * the drawer — the agent has the answer, but pitstop has no idea
   * (the only normal clear path is an `answer`-kind response landing on
   * `/api/sessions/:id/responses`, which only the drawer's banner clicks
   * trigger). Without this, the drawer banner stays up indefinitely
   * looking unanswered.
   *
   * If `answer` is provided, also pushes an `answer`-kind response so the
   * session's history shows what the agent acted on (transparency for
   * future `get_state` reads + the drawer's response timeline).
   */
  async dismiss_pending_question(ctx: Ctx, params: unknown) {
    const P = z.object({
      sessionId: z.string(),
      answer: z.string().optional(),
    });
    const { sessionId, answer } = P.parse(params);
    const at = Date.now();
    const session = await ctx.store.update(sessionId, (s) => {
      if (!s.pendingQuestion) return s;
      const responses = answer
        ? [
            ...s.responses,
            {
              itemId: s.pendingQuestion.itemId ?? s.items[0]?.id ?? "",
              kind: "answer" as const,
              body: answer,
              questionText: s.pendingQuestion.question,
              at,
              addressed: true,
            },
          ]
        : s.responses;
      return {
        ...s,
        pendingQuestion: undefined,
        responses,
        lastAgentActivityAt: at,
        pokeFailed: false,
      };
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
