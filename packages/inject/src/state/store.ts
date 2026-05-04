import { createMemo, createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { Session, SseEvent } from '@pitstop/shared';
import { fetchActiveSession, fetchMostRecentActiveSession, openEventStream } from './client';

export const [session, setSession] = createStore<{ s: Session | null }>({ s: null });
export const [currentItemIdx, setCurrentItemIdx] = createSignal(0);

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

/**
 * Local UI state for "what's happening with the comment I just sent."
 * Agent-side activity (mark_addressing / add_items / etc.) takes priority in
 * the pill; this only fills the silence between SEND_COMMENT and the agent's
 * first MCP call.
 */
export const [submitState, setSubmitState] = createSignal<'idle' | 'sending' | 'poked'>('idle');

let pokedClearTimer: ReturnType<typeof setTimeout> | null = null;
export function flagSent(): void {
  setSubmitState('poked');
  if (pokedClearTimer) clearTimeout(pokedClearTimer);
  // Safety: if the agent never wakes (poke silently failed, daemon down),
  // clear the waiting pill so the drawer doesn't lie indefinitely.
  pokedClearTimer = setTimeout(() => setSubmitState('idle'), 60_000);
}

export function applyEvent(e: SseEvent): void {
  switch (e.type) {
    case 'state-snapshot':
    case 'state-changed':
      setSession('s', e.session);
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
    case 'item-added':
      setSession(
        's',
        produce((s) => {
          if (!s) return;
          const start = s.items.length;
          for (let i = 0; i < e.items.length; i++) {
            s.items.push({ ...e.items[i]!, index: start + i + 1 });
          }
        }),
      );
      break;
    case 'agent-activity':
      setSession('s', produce((s) => { s?.agentActivity.push(e.entry); }));
      setSubmitState('idle');
      if (pokedClearTimer) { clearTimeout(pokedClearTimer); pokedClearTimer = null; }
      break;
    case 'complete':
      setSession('s', produce((s) => { if (s) s.status = 'complete'; }));
      break;
  }
}

/** Fetches the active session and opens an SSE stream. Returns a cleanup function.
 *  Pass `null` for `projectRoot` when the drawer is wired without a project hint
 *  (browser extension, bookmarklet, proxy) — bootstrap will then fall back to
 *  the most-recently-updated non-complete session across all roots. */
export async function bootstrap(projectRoot: string | null): Promise<() => void> {
  const initial = projectRoot
    ? await fetchActiveSession(projectRoot)
    : await fetchMostRecentActiveSession();
  if (initial) {
    setSession('s', initial);
    return openEventStream(initial.id, applyEvent);
  }
  return () => {};
}

/**
 * Per-item comment drafts. Survives component remount when the drawer collapses to strip
 * or position changes cause re-render. Cleared after successful submission.
 */
const draftMap = new Map<string, string>();
const [draftsVersion, bumpDrafts] = createSignal(0);

export function getDraft(itemId: string): string {
  draftsVersion();
  return draftMap.get(itemId) ?? '';
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
