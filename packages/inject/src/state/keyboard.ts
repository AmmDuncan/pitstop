import { onCleanup } from 'solid-js';
import { session, currentItemIdx, setCurrentItemIdx } from './store';
import { submitResponse } from './client';
import { cyclePosition, cycleSize } from './modes';

type Handler = (e: KeyboardEvent) => boolean | void;

export function installKeyboard(getCommentEl: () => HTMLTextAreaElement | null) {
  const next = () => {
    if (!session.s) return;
    setCurrentItemIdx(Math.min(session.s.items.length - 1, currentItemIdx() + 1));
  };
  const prev = () => setCurrentItemIdx(Math.max(0, currentItemIdx() - 1));

  const handlers: Record<string, Handler> = {
    j: next,
    ArrowDown: next,
    k: prev,
    ArrowUp: prev,
    Enter: (e) => {
      if (document.activeElement === getCommentEl()) return false;
      if (!session.s) return;
      const item = session.s.items[currentItemIdx()];
      if (!item) return;
      submitResponse(session.s.id, { itemId: item.id, kind: 'approve' }).then(next);
      e.preventDefault();
    },
    c: (e) => {
      const ta = getCommentEl();
      if (ta) {
        ta.focus();
        e.preventDefault();
      }
    },
    Escape: () => {
      const ta = getCommentEl();
      if (document.activeElement === ta) ta?.blur();
    },
    '[': cyclePosition,
    ']': cyclePosition,
    '=': cycleSize,
    '+': cycleSize,
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey && e.key === 'Enter') {
      const ta = getCommentEl();
      const body = ta?.value.trim();
      if (session.s && body) {
        const item = session.s.items[currentItemIdx()];
        if (item) {
          submitResponse(session.s.id, { itemId: item.id, kind: 'comment', body });
          if (ta) ta.value = '';
        }
      }
      return;
    }
    const h = handlers[e.key];
    if (h) h(e);
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
}
