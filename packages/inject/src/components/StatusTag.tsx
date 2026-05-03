import { type Component, Show } from 'solid-js';
import type { Session } from '@walkthrough/shared';

export type PillState = 'idle' | 'working' | 'addressing' | 'writing' | 'failed' | 'complete';

export function derivePill(
  session: Session | null,
  pokeStatus: 'idle' | 'working' | 'failed',
): { state: PillState; label: string } {
  if (!session) return { state: 'idle', label: '' };
  if (session.status === 'complete') return { state: 'complete', label: 'REVIEW_COMPLETE' };
  if (pokeStatus === 'failed') return { state: 'failed', label: 'POKE_FAILED · CLICK_RETRY' };
  const last = session.agentActivity.at(-1);
  const fresh = last && Date.now() - last.at < 5000;
  if (fresh && last.tool === 'mark_addressing') return { state: 'addressing', label: last.narration ?? 'ADDRESSING' };
  if (fresh && last.tool === 'add_items') return { state: 'writing', label: 'WRITING_ITEMS' };
  if (fresh) return { state: 'working', label: 'PREPARING_NEXT' };
  return { state: 'idle', label: '' };
}

export const StatusTag: Component<{ pill: ReturnType<typeof derivePill> }> = (props) => (
  <Show when={props.pill.state !== 'idle'}>
    <span class={`tag ${props.pill.state}`}>
      <span class="dot-cell">
        <span
          class={
            props.pill.state === 'working' || props.pill.state === 'addressing' || props.pill.state === 'writing'
              ? 'pulse-dot'
              : 'static-dot'
          }
        />
      </span>
      <span class="rule-cell" />
      <span class="label-cell">{props.pill.label}</span>
    </span>
  </Show>
);
