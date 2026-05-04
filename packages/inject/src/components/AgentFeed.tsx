import { type Component, For, Show, createSignal, createEffect } from 'solid-js';
import { session } from '../state/store';

const FEED_SIZE = 5;
const FLASH_DURATION_MS = 1500;

/** Bottom-of-drawer feed of the agent's recent narrations.
 *  Reads `session.agentActivity`, surfaces the last `FEED_SIZE` `mark_addressing`
 *  entries newest-first, fades older entries by rank. Beyond that, an inline
 *  expander reveals the full session history (capped at 50 by the daemon ring
 *  buffer) in a scrollable list. */
export const AgentFeed: Component = () => {
  const [expanded, setExpanded] = createSignal(false);
  const [flashing, setFlashing] = createSignal(false);

  const all = () => {
    const entries = (session.s?.agentActivity ?? [])
      .filter((e) => e.narration && (e.tool === 'mark_addressing' || e.tool === 'ask_user'));
    return entries.slice().reverse();
  };

  const visible = () => (expanded() ? all() : all().slice(0, FEED_SIZE));
  const olderCount = () => Math.max(0, all().length - FEED_SIZE);

  // Flash the newest line briefly when a new entry arrives, so the user
  // notices the feed is live. Tracks the last-seen `at` timestamp; when it
  // changes, sets a short-lived `flashing` flag that the rendered top line
  // picks up via classList.
  let lastSeenAt = -1;
  createEffect(() => {
    const top = all()[0];
    if (!top) return;
    if (top.at === lastSeenAt) return;
    if (lastSeenAt !== -1) {
      // Genuinely new entry (not the initial snapshot).
      setFlashing(true);
      setTimeout(() => setFlashing(false), FLASH_DURATION_MS);
    }
    lastSeenAt = top.at;
  });

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
                classList={{ 'is-fresh': i() === 0 && flashing() }}
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
