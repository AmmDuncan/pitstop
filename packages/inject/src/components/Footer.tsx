import { type Component, createMemo } from 'solid-js';
import { session } from '../state/store';
import { baseUrl } from '../state/client';

export const Footer: Component = () => {
  const counts = createMemo(() => {
    const items = session.s?.items ?? [];
    const responses = session.s?.responses ?? [];
    const approved = items.filter((i) => responses.some((r) => r.itemId === i.id && r.kind === 'approve')).length;
    const commented = items.filter((i) => responses.some((r) => r.itemId === i.id && r.kind === 'comment')).length;
    const left = items.length - approved - commented;
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
        <button class="footer-btn" onClick={togglePause}>
          {isPaused() ? 'RESUME' : 'STOP'}
        </button>
        <button class="footer-btn" onClick={onDone}>
          DONE
        </button>
      </div>
    </footer>
  );
};
