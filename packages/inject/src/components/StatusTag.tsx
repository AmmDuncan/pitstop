import { type Component, Show } from 'solid-js';
import type { Session } from '@pitstop/shared';
import { submitState } from '../state/store';

export type PillState = 'idle' | 'working' | 'addressing' | 'writing' | 'failed' | 'complete';

export function derivePill(session: Session | null): { state: PillState; label: string } {
  if (!session) return { state: 'idle', label: '' };
  if (session.status === 'complete') return { state: 'complete', label: 'REVIEW_COMPLETE' };
  if (session.pokeFailed) return { state: 'failed', label: 'POKE_FAILED · CLICK_RETRY' };
  const last = session.agentActivity.at(-1);
  const fresh = last && Date.now() - last.at < 5000;
  if (fresh && last.tool === 'mark_addressing') return { state: 'addressing', label: last.narration ?? 'ADDRESSING' };
  if (fresh && last.tool === 'add_items') return { state: 'writing', label: 'WRITING_ITEMS' };
  if (fresh) return { state: 'working', label: 'PREPARING_NEXT' };
  // No fresh agent activity — show the local submit state so the user sees
  // "I sent it, the agent is being notified" instead of silence.
  const ss = submitState();
  if (ss === 'sending') return { state: 'working', label: 'SENDING…' };
  if (ss === 'poked') return { state: 'working', label: 'POKED_CLAUDE · WAITING' };
  return { state: 'idle', label: '' };
}

export const StatusTag: Component<{ pill: ReturnType<typeof derivePill>; onRetry?: () => void }> = (props) => {
  // Narration-driven states (addressing/working/writing) are surfaced by the
  // AgentFeed at the bottom of the drawer — render a slim dot-only variant
  // here so the header stays content-light.
  const narrating = () =>
    props.pill.state === 'addressing' ||
    props.pill.state === 'working' ||
    props.pill.state === 'writing';

  return (
    <Show when={props.pill.state !== 'idle'}>
      <span
        class={`tag ${props.pill.state}`}
        classList={{ 'tag-slim': narrating() }}
        onClick={props.pill.state === 'failed' ? props.onRetry : undefined}
        style={props.pill.state === 'failed' ? { cursor: 'pointer' } : undefined}
        title={narrating() ? props.pill.label : undefined}
      >
        <span class="dot-cell">
          <span class={narrating() ? 'pulse-dot' : 'static-dot'} />
        </span>
        <Show when={!narrating()}>
          <span class="rule-cell" />
          <span class="label-cell">{props.pill.label}</span>
        </Show>
      </span>
    </Show>
  );
};
