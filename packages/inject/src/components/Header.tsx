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
  themeGlyph,
  cyclePosition,
  cycleSize,
  positionGlyph,
  sizeGlyph,
  floatingTop,
  setFloatingTop,
  floatingLeft,
  setFloatingLeft,
} from '../state/modes';

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

  const onHeaderMouseDown = (e: MouseEvent) => {
    if (position() !== 'floating') return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, a, [role="button"]')) return;

    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startTop = floatingTop();
    const startLeft = floatingLeft();

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const dx = ev.clientX - startX;
      setFloatingTop(Math.max(0, startTop + dy));
      setFloatingLeft(Math.max(0, startLeft + dx));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  return (
    <header class="dheader" onMouseDown={onHeaderMouseDown} classList={{ draggable: position() === 'floating' }}>
      <div class="mark">W</div>
      <div>
        <div class="name">WALKTHROUGH</div>
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
      <button class="x-btn pos-btn" onClick={cyclePosition} title={`Position: ${position()}. Click to cycle (right/left/floating)`}>{positionGlyph()}</button>
      <button class="x-btn size-btn" onClick={cycleSize} title={`Size: ${size()}. Click to cycle (standard/compact/strip)`}>{sizeGlyph()}</button>
      <button class="x-btn theme-btn" onClick={cycleTheme} title={`Theme: ${theme()}. Click to cycle (auto/dark/light)`}>{themeGlyph()}</button>
      <button class="x-btn help-btn" onClick={() => setHelpOpen(true)} title="Show keyboard shortcuts">?</button>
      <button class="x-btn min-btn" onClick={() => setSize('strip')} title="Minimize to strip">−</button>
    </header>
  );
};
