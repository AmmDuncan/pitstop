import { type Component, For } from 'solid-js';
import { session, currentItemIdx, setCurrentItemIdx } from '../state/store';

type PipState = 'approved' | 'commented' | 'focused' | 'pending';

function glyphFor(state: PipState): string {
  return { approved: '✓', commented: '•', focused: '▸', pending: '·' }[state];
}

export const PipStrip: Component = () => {
  const items = () => session.s?.items ?? [];
  const responsesByItem = () => {
    const m = new Map<string, 'approved' | 'commented'>();
    for (const r of session.s?.responses ?? []) {
      const cur = m.get(r.itemId);
      if (r.kind === 'comment') m.set(r.itemId, 'commented');
      else if (cur !== 'commented') m.set(r.itemId, 'approved');
    }
    return m;
  };
  return (
    <div class="pips">
      <For each={items()}>
        {(item, i) => {
          const state = (): PipState => {
            if (i() === currentItemIdx()) return 'focused';
            return responsesByItem().get(item.id) ?? 'pending';
          };
          return (
            <div class={`pip ${state()}`} onClick={() => setCurrentItemIdx(i())}>
              <span class="glyph">{glyphFor(state())}</span>
              <span class="num">{String(item.index ?? i() + 1).padStart(2, '0')}</span>
            </div>
          );
        }}
      </For>
    </div>
  );
};
