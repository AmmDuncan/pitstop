import { type Component, Show } from 'solid-js';
import { session, currentItemIdx, unreviewedIndices, setHelpOpen } from '../state/store';
import { StatusTag, derivePill } from './StatusTag';
import { baseUrl } from '../state/client';
import {
  position,
  size,
  setSize,
  theme,
  cycleTheme,
  cyclePosition,
  cycleSize,
  floatingTop,
  setFloatingTop,
  floatingLeft,
  setFloatingLeft,
} from '../state/modes';
import { PositionIcon, SizeIcon, ThemeIcon, MinimizeIcon } from './Icons';

export const Header: Component = () => {
  const pill = () => derivePill(session.s);
  const total = () => session.s?.items.length ?? 0;
  const current = () => Math.min(currentItemIdx() + 1, total());
  const skippedCount = () => {
    const reviewed = (session.s?.responses ?? []).length;
    if (reviewed === 0) return 0;
    return unreviewedIndices().filter((i) => i < currentItemIdx()).length;
  };

  const onRetry = async () => {
    if (!session.s) return;
    try {
      await fetch(`${baseUrl}/api/sessions/${session.s.id}/retry-poke`, { method: 'POST' });
    } catch (err) {
      console.error('retry-poke failed', err);
    }
  };

  // Floating-drawer drag uses pointer events with implicit capture so the
  // release fires reliably even when the cursor leaves the browser window or
  // crosses iframe/shadow boundaries mid-drag. The previous mousemove/mouseup
  // listeners on `window` could miss the up event in those cases, leaving the
  // drawer glued to the cursor until the user clicked again.
  const onHeaderPointerDown = (e: PointerEvent) => {
    if (position() !== 'floating') return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, a, [role="button"]')) return;

    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const startTop = floatingTop();
    const startLeft = floatingLeft();

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dy = ev.clientY - startY;
      const dx = ev.clientX - startX;
      setFloatingTop(Math.max(0, startTop + dy));
      setFloatingLeft(Math.max(0, startLeft + dx));
    };
    const release = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointercancel', release);
      el.removeEventListener('lostpointercapture', release);
      try { el.releasePointerCapture(e.pointerId); } catch {}
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  return (
    <header class="dheader" onPointerDown={onHeaderPointerDown} classList={{ draggable: position() === 'floating' }}>
      <div class="mark">W</div>
      <div>
        <div class="name">PITSTOP</div>
        <div class="ctx">{session.s?.branch ?? session.s?.projectRoot ?? '—'}</div>
      </div>
      <Show when={total() > 0}>
        <span class="counter">
          <span class="counter-cur">{String(current()).padStart(2, '0')}</span>
          <span class="counter-sep">/</span>
          <span class="counter-total">{String(total()).padStart(2, '0')}</span>
          <Show when={skippedCount() > 0}>
            <span class="counter-skipped">· {String(skippedCount()).padStart(2, '0')}_SKIPPED</span>
          </Show>
        </span>
      </Show>
      <StatusTag pill={pill()} onRetry={onRetry} />
      <button class="x-btn pos-btn" onClick={cyclePosition} title={`Position: ${position()}. Click to cycle (right/left/floating)`}><PositionIcon /></button>
      <button class="x-btn size-btn" onClick={cycleSize} title={`Size: ${size()}. Click to cycle (standard/compact/strip)`}><SizeIcon /></button>
      <button class="x-btn theme-btn" onClick={cycleTheme} title={`Theme: ${theme()}. Click to cycle (auto/dark/light)`}><ThemeIcon /></button>
      <button class="x-btn help-btn" onClick={() => setHelpOpen(true)} title="Show keyboard shortcuts">?</button>
      <button class="x-btn min-btn" onClick={() => setSize('strip')} title="Minimize to strip"><MinimizeIcon /></button>
    </header>
  );
};
