import { type Component, For, Show, createSignal } from 'solid-js';
import { session } from '../state/store';

const FEED_SIZE = 5;

/** Bottom-of-drawer feed of the agent's recent narrations.
 *  Reads `session.agentActivity`, surfaces the last `FEED_SIZE` `mark_addressing`
 *  entries newest-first, fades older entries by rank. Beyond that, an inline
 *  expander reveals the full session history (capped at 50 by the daemon ring
 *  buffer) in a scrollable list. */
export const AgentFeed: Component = () => {
  const [expanded, setExpanded] = createSignal(false);

  const all = () => {
    const entries = (session.s?.agentActivity ?? [])
      .filter((e) => e.tool === 'mark_addressing' && e.narration);
    return entries.slice().reverse();
  };

  const visible = () => (expanded() ? all() : all().slice(0, FEED_SIZE));
  const olderCount = () => Math.max(0, all().length - FEED_SIZE);

  return (
    <Show when={visible().length}>
      <div
        class="agent-feed"
        classList={{ expanded: expanded(), 'has-older': olderCount() > 0 }}
        aria-live="polite"
      >
        <div class="agent-feed-label">CLAUDE</div>
        <ol class="agent-feed-list">
          <For each={visible()}>
            {(entry, i) => (
              <li
                class="agent-feed-line"
                data-rank={expanded() ? (i() === 0 ? 0 : undefined) : Math.min(i(), 4)}
                title={entry.narration}
              >
                {entry.narration}
              </li>
            )}
          </For>
        </ol>
        <Show when={olderCount() > 0 && !expanded()}>
          <button
            type="button"
            class="agent-feed-more"
            onClick={() => setExpanded(true)}
          >
            … +{olderCount()} older
          </button>
        </Show>
        <Show when={expanded()}>
          <button
            type="button"
            class="agent-feed-more"
            onClick={() => setExpanded(false)}
          >
            show less
          </button>
        </Show>
      </div>
    </Show>
  );
};
