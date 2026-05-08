import type { Session, SseEvent } from "@pitstop/shared";
import { createEffect, createMemo, createRoot, createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { fetchActiveSession, fetchMostRecentActiveSession, openEventStream } from "./client";
import { setPosition, setSize } from "./modes";

export const [session, setSession] = createStore<{ s: Session | null }>({ s: null });
export const [currentItemIdx, setCurrentItemIdx] = createSignal(0);

/** Cleanup function for the EventSource bound to the current session. Hoisted
 *  to module scope so both App.tsx (initial bootstrap, lobby auto-switch) and
 *  SessionSwitchPrompt (user-initiated switch) can swap the bound session
 *  cleanly without leaking SSE connections. */
export const [closer, setCloser] = createSignal<() => void>(() => {});

/** Indices of items that have no response yet (in order). */
export const unreviewedIndices = createMemo<number[]>(() => {
  const items = session.s?.items ?? [];
  const responses = session.s?.responses ?? [];
  const reviewed = new Set(responses.map((r) => r.itemId));
  return items.map((it, i) => (reviewed.has(it.id) ? -1 : i)).filter((i) => i >= 0);
});

/** Triggered by Detail when user approves the LAST item — opens the review summary. */
export const [summaryOpen, setSummaryOpen] = createSignal(false);

/** Toggled by `?` key or the header `?` button — shows the keymap overlay. */
export const [helpOpen, setHelpOpen] = createSignal(false);

/** True when the user has clicked REVIEW_ITEMS on the review-complete screen
 *  to go back and re-read items. Auto-resets whenever the session leaves the
 *  complete state, so a brand-new session never opens stuck in browse mode. */
export const [reviewingComplete, setReviewingComplete] = createSignal(false);
createRoot(() => {
  createEffect(() => {
    if (session.s?.status !== "complete") setReviewingComplete(false);
  });
});

/**
 * Approved/commented/left counts for the current session. Counts each item
 * once even when it carries both an approve AND a comment, so `left` can't
 * go negative (regression fixed in v0.3.6).
 *
 * `commented` excludes items the agent has since marked as addressed via
 * `agent_address_comment` — once the fix is in, the queue is no longer
 * pending the agent's action. The pip-strip still surfaces the
 * agent-addressed state via its own color so the user can re-approve.
 */
export const responseCounts = createMemo(() => {
  const items = session.s?.items ?? [];
  const responses = session.s?.responses ?? [];
  const approved = items.filter((i) =>
    responses.some((r) => r.itemId === i.id && r.kind === "approve"),
  ).length;
  const commented = items.filter((i) => {
    const itemResponses = responses.filter((r) => r.itemId === i.id);
    const hasOpenComment = itemResponses.some((r) => r.kind === "comment");
    const isAgentAddressed = itemResponses.some((r) => r.kind === "agent-addressed");
    return hasOpenComment && !isAgentAddressed;
  }).length;
  const addressedIds = new Set(responses.map((r) => r.itemId));
  const left = Math.max(0, items.length - addressedIds.size);
  return { approved, commented, left };
});

/**
 * Local UI state for "what's happening with the comment I just sent."
 * Agent-side activity (mark_addressing / add_items / etc.) takes priority in
 * the pill; this only fills the silence between SEND_COMMENT and the agent's
 * first MCP call.
 */
export const [submitState, setSubmitState] = createSignal<"idle" | "sending" | "poked">("idle");

let pokedClearTimer: ReturnType<typeof setTimeout> | null = null;
export function flagSent(): void {
  setSubmitState("poked");
  if (pokedClearTimer) clearTimeout(pokedClearTimer);
  // Safety: if the agent never wakes (poke silently failed, daemon down),
  // clear the waiting pill so the drawer doesn't lie indefinitely.
  pokedClearTimer = setTimeout(() => setSubmitState("idle"), 60_000);
}

export function applyEvent(e: SseEvent): void {
  switch (e.type) {
    case "state-snapshot":
    case "state-changed": {
      // Detect agent-activity growth even when the SSE arrived as state-changed
      // (not as the typed `agent-activity` event). Without this, missed bus
      // deliveries / reconnects / browser-tab throttling can leave submitState
      // stuck at "poked" indefinitely while the feed and pip colors update via
      // the snapshot reconcile. Compare lengths BEFORE the reconcile overwrites
      // the prior value.
      const prevActivityLen = session.s?.agentActivity?.length ?? 0;
      const newActivityLen = e.session.agentActivity?.length ?? 0;
      // `reconcile` does a deep diff against the existing store value and
      // properly REMOVES keys that disappeared (e.g. pendingQuestion when an
      // answer is submitted). Plain `setSession('s', e.session)` keeps the
      // current key in the store; reconcile fixes that.
      setSession("s", reconcile(e.session));
      if (newActivityLen > prevActivityLen) {
        setSubmitState("idle");
        if (pokedClearTimer) {
          clearTimeout(pokedClearTimer);
          pokedClearTimer = null;
        }
      }
      // Agent-authoritative cursor: when the daemon's session has a
      // currentItemId, snap the local cursor to match. This is how the
      // agent moves the user via set_current_item (Phase B).
      if (e.session.currentItemId) {
        const idx = e.session.items.findIndex((it) => it.id === e.session.currentItemId);
        if (idx >= 0 && idx !== currentItemIdx()) {
          setCurrentItemIdx(idx);
        }
      }
      break;
    }
    case "item-added":
      setSession(
        "s",
        produce((s) => {
          if (!s) return;
          const start = s.items.length;
          for (let i = 0; i < e.items.length; i++) {
            s.items.push({ ...e.items[i]!, index: start + i + 1 });
          }
        }),
      );
      break;
    case "agent-activity":
      setSession(
        "s",
        produce((s) => {
          s?.agentActivity.push(e.entry);
        }),
      );
      setSubmitState("idle");
      if (pokedClearTimer) {
        clearTimeout(pokedClearTimer);
        pokedClearTimer = null;
      }
      break;
    case "complete":
      setSession(
        "s",
        produce((s) => {
          if (s) s.status = "complete";
        }),
      );
      break;
    case "drawer-control":
      // Agent-driven chrome change via set_drawer. Persisted by the modes
      // effect so the drawer stays where the agent put it after reload.
      if (e.position) setPosition(e.position);
      if (e.size) setSize(e.size);
      break;
  }
}

/** Fetches the active session and opens an SSE stream. Returns a cleanup function.
 *  Pass `null` for `projectRoot` when the drawer is wired without a project hint
 *  (browser extension, bookmarklet, proxy) — bootstrap will then fall back to
 *  the most-recently-updated non-complete session across all roots. */
export async function bootstrap(projectRoot: string | null): Promise<() => void> {
  const initial = projectRoot ? await fetchActiveSession(projectRoot) : await fetchMostRecentActiveSession();
  if (initial) {
    setSession("s", initial);
    // Fresh session starts at item 0 — without this the cursor can carry
    // over from a previous session and land out-of-bounds when the next
    // one has fewer items.
    setCurrentItemIdx(0);
    return openEventStream(initial.id, applyEvent);
  }
  return () => {};
}

/**
 * Hot-swap the bound session without re-fetching from the API. Used when a
 * `session-hello` payload already carries the full session shape — saves a
 * round trip and avoids `fetchActiveSession`'s "first non-complete wins"
 * non-determinism when multiple non-complete sessions coexist for the
 * same projectRoot.
 */
export function switchToSession(s: Session): () => void {
  setSession("s", s);
  setCurrentItemIdx(0);
  return openEventStream(s.id, applyEvent);
}

/**
 * Pending switch prompt — set when a `session-hello` arrives on the project
 * lobby for a different session id while the current one is still active
 * (not complete). The drawer renders SessionSwitchPrompt; user picks
 * SWITCH or STAY. STAY adds the id to `dismissedSessionIds` so we don't
 * re-prompt for that specific session within this drawer mount. In-memory
 * Set, NOT localStorage — the offer is fresh on every page load.
 */
export const [pendingSessionSwitch, setPendingSessionSwitch] = createSignal<Session | null>(null);

const dismissedSessionIds = new Set<string>();
export function dismissPendingSessionSwitch(id: string): void {
  dismissedSessionIds.add(id);
  setPendingSessionSwitch(null);
}
export function isSessionSwitchDismissed(id: string): boolean {
  return dismissedSessionIds.has(id);
}

/**
 * Stale-adapter warning — set when the daemon detects the MCP adapter
 * subprocess is running an older version than itself. Drawer renders a
 * banner above the metabar telling the user to restart Claude Code so the
 * new dist is loaded. Dismissable per drawer mount; reload re-arms.
 */
export const [staleAdapterWarning, setStaleAdapterWarning] = createSignal<{
  adapterVersion: string;
  daemonVersion: string;
  adapterPid?: string;
} | null>(null);
export function dismissStaleAdapterWarning(): void {
  setStaleAdapterWarning(null);
}

/**
 * Per-item comment drafts. Survives component remount when the drawer collapses to strip
 * or position changes cause re-render. Cleared after successful submission.
 */
const draftMap = new Map<string, string>();
const [draftsVersion, bumpDrafts] = createSignal(0);

export function getDraft(itemId: string): string {
  draftsVersion();
  return draftMap.get(itemId) ?? "";
}

export function setDraft(itemId: string, body: string): void {
  if (body) draftMap.set(itemId, body);
  else draftMap.delete(itemId);
  bumpDrafts(draftsVersion() + 1);
}

export function clearDraft(itemId: string): void {
  draftMap.delete(itemId);
  bumpDrafts(draftsVersion() + 1);
}
