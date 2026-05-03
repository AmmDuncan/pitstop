import { createMemo, createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { Session, SseEvent } from '@pitstop/shared';
import { fetchActiveSession, openEventStream } from './client';

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

export function applyEvent(e: SseEvent): void {
  switch (e.type) {
    case 'state-snapshot':
    case 'state-changed':
      setSession('s', e.session);
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
      break;
    case 'complete':
      setSession('s', produce((s) => { if (s) s.status = 'complete'; }));
      break;
  }
}

/** Fetches the active session and opens an SSE stream. Returns a cleanup function. */
export async function bootstrap(projectRoot: string): Promise<() => void> {
  const initial = await fetchActiveSession(projectRoot);
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
