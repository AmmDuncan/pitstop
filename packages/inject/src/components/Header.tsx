import { type Component, Show } from 'solid-js';
import { session, currentItemIdx, pokeStatus, unreviewedIndices } from '../state/store';
import { StatusTag, derivePill } from './StatusTag';

export const Header: Component = () => {
  const pill = () => derivePill(session.s, pokeStatus());
  const total = () => session.s?.items.length ?? 0;
  const current = () => Math.min(currentItemIdx() + 1, total());
  const skippedCount = () => {
    const reviewed = (session.s?.responses ?? []).length;
    if (reviewed === 0) return 0;
    return unreviewedIndices().filter((i) => i < currentItemIdx()).length;
  };

  return (
    <header class="dheader">
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
      <StatusTag pill={pill()} />
      <button class="x-btn">×</button>
    </header>
  );
};
