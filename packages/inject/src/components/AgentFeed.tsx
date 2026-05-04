import { type Component, For, Show } from 'solid-js';
import { session } from '../state/store';

const FEED_SIZE = 5;

/** Bottom-of-drawer feed of the agent's recent narrations.
 *  Reads `session.agentActivity` and surfaces the last few `mark_addressing`
 *  entries so the user can see what Claude has been doing without tabbing
 *  back to the terminal. Newest first; older entries fade. */
export const AgentFeed: Component = () => {
  const recent = () => {
    const entries = (session.s?.agentActivity ?? [])
      .filter((e) => e.tool === 'mark_addressing' && e.narration)
      .slice(-FEED_SIZE);
    return entries.slice().reverse();
  };

  return (
    <Show when={recent().length}>
      <div class="agent-feed" aria-live="polite">
        <div class="agent-feed-label">CLAUDE</div>
        <ol class="agent-feed-list">
          <For each={recent()}>
            {(entry, i) => (
              <li class="agent-feed-line" data-rank={i()}>
                {entry.narration}
              </li>
            )}
          </For>
        </ol>
      </div>
    </Show>
  );
};
