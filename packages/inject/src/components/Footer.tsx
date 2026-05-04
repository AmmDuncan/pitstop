import { type Component, createMemo } from 'solid-js';
import { session } from '../state/store';
import { baseUrl } from '../state/client';

export const Footer: Component = () => {
  const counts = createMemo(() => {
    const items = session.s?.items ?? [];
    const responses = session.s?.responses ?? [];
    const approved = items.filter((i) => responses.some((r) => r.itemId === i.id && r.kind === 'approve')).length;
    const commented = items.filter((i) => responses.some((r) => r.itemId === i.id && r.kind === 'comment')).length;
    // Pre-v0.3.6 this was `items.length - approved - commented` which double-
    // counted any item carrying both an approve AND a comment, so `left`
    // could go negative. Count distinct addressed item IDs once.
    const addressedIds = new Set(responses.map((r) => r.itemId));
    const left = Math.max(0, items.length - addressedIds.size);
    return { approved, commented, left };
  });

  const isPaused = () => session.s?.status === 'paused';

  const togglePause = async () => {
    if (!session.s) return;
    const next = isPaused() ? 'active' : 'paused';
    await fetch(`${baseUrl}/api/sessions/${session.s.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
  };

  const onDone = async () => {
    if (!session.s) return;
    await fetch(`${baseUrl}/api/sessions/${session.s.id}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'complete' }),
    });
  };

  return (
    <footer class="dfooter">
      <div class="counts">
        <span class="ok-c">
          <span class="v">{String(counts().approved).padStart(2, '0')}</span>_OK
        </span>
        <span class="am-c">
          <span class="v">{String(counts().commented).padStart(2, '0')}</span>_QUEUED
        </span>
        <span>
          <span class="v">{String(counts().left).padStart(2, '0')}</span>_LEFT
        </span>
      </div>
      <div class="actions-r">
        <button
          class="footer-btn"
          onClick={togglePause}
          title={isPaused() ? 'Resume the review (drawer un-dims, agent picks up where it left off)' : 'Pause the review (drawer dims, agent stops driving — reversible)'}
        >
          {isPaused() ? 'RESUME' : 'PAUSE'}
        </button>
        <button
          class="footer-btn"
          onClick={onDone}
          title="End the review session (final — flips status to REVIEW_COMPLETE)"
        >
          DONE
        </button>
      </div>
    </footer>
  );
};
