import { type Component, For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { session } from "../state/store";

const FEED_SIZE = 5;
const FLASH_DURATION_MS = 1500;
const FEED_DEFAULT_MAX = 120;
const FEED_MIN = 80;
const FEED_MAX = 400;

/** Bottom-of-drawer feed of the agent's recent narrations.
 *  Reads `session.agentActivity`, surfaces the last `FEED_SIZE` `mark_addressing`
 *  entries newest-first, fades older entries by rank. Beyond that, an inline
 *  expander reveals the full session history (capped at 50 by the daemon ring
 *  buffer) in a scrollable list. */
export const AgentFeed: Component = () => {
  const [expanded, setExpanded] = createSignal(false);
  const [flashing, setFlashing] = createSignal(false);
  const [feedMaxHeight, setFeedMaxHeight] = createSignal(FEED_DEFAULT_MAX);
  /** Timestamp watermark of the last entry the user has acknowledged.
   *  Anything with `at > lastInteractedAt` counts as unread. Initialized
   *  on first render so existing entries don't show as unread when the
   *  drawer first mounts; only entries that arrive AFTER the user's first
   *  view of the feed become unread. */
  const [lastInteractedAt, setLastInteractedAt] = createSignal(-1);

  /** Top-edge handle: drag UP to grow the feed, DOWN to shrink. Same pointer-
   *  capture pattern as the floating-drawer / resize-handle code so the
   *  release fires reliably even when the cursor leaves the viewport. */
  const onResizePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = feedMaxHeight();
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dy = startY - ev.clientY;
      setFeedMaxHeight(Math.max(FEED_MIN, Math.min(FEED_MAX, startH + dy)));
    };
    const release = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("lostpointercapture", release);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
      document.body.style.cursor = "";
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
    document.body.style.cursor = "ns-resize";
  };

  // Memoized — `all` is read from visible(), olderCount(), the watermark
  // createEffect, unreadCount(), and markSeen() (5 sites). Without the memo,
  // each reactive read re-runs the filter+reverse on every state-changed SSE
  // event.
  const all = createMemo(() => {
    const entries = (session.s?.agentActivity ?? []).filter(
      (e) =>
        e.narration &&
        (e.tool === "mark_addressing" ||
          e.tool === "ask_user" ||
          e.tool === "set_drawer" ||
          e.tool === "agent_address_comment" ||
          e.tool === "narrate"),
    );
    return entries.slice().reverse();
  });

  const visible = () => (expanded() ? all() : all().slice(0, FEED_SIZE));
  const olderCount = () => Math.max(0, all().length - FEED_SIZE);

  // Flash the newest line briefly when a new entry arrives, so the user
  // notices the feed is live. Also seeds the unread watermark on init so
  // existing entries aren't reported as unread when the drawer mounts;
  // anything arriving AFTER init is unread until the user interacts.
  // The `hasInitialized` flag distinguishes the very first effect run
  // (snapshot of pre-existing state) from subsequent runs (new arrivals).
  let lastSeenAt = -1;
  let hasInitialized = false;
  createEffect(() => {
    const top = all()[0];
    if (!hasInitialized) {
      hasInitialized = true;
      // Seed watermark. If entries exist already, mark them all seen.
      // If none exist, watermark = 0 so any future entry counts as unread.
      setLastInteractedAt(top ? top.at : 0);
      lastSeenAt = top ? top.at : -1;
      return;
    }
    if (!top) return;
    if (top.at === lastSeenAt) return;
    // Genuinely new entry post-init — flash and let the unread counter pick
    // it up via lastInteractedAt being older than this entry's at.
    setFlashing(true);
    setTimeout(() => setFlashing(false), FLASH_DURATION_MS);
    lastSeenAt = top.at;
  });

  /** Count of entries newer than the user's last interaction. Drives the
   *  pulsing pip + "N NEW" tag on the CLAUDE eyebrow. */
  const unreadCount = () => {
    const entries = all();
    const since = lastInteractedAt();
    return entries.filter((e) => e.at > since).length;
  };

  const markSeen = () => {
    const top = all()[0];
    if (top) setLastInteractedAt(top.at);
  };

  return (
    <Show when={visible().length}>
      <div
        class="agent-feed"
        classList={{ expanded: expanded(), "has-older": olderCount() > 0 }}
        aria-live="polite"
        onMouseEnter={markSeen}
        onClick={markSeen}
      >
        <div
          class="agent-feed-resize"
          onPointerDown={onResizePointerDown}
          title="Drag to resize"
          aria-hidden="true"
        />
        <div class="agent-feed-label">
          <span>CLAUDE</span>
          <Show when={unreadCount() > 0}>
            <span class="agent-feed-pip" aria-hidden="true" />
            <span class="agent-feed-new">{unreadCount()} NEW</span>
          </Show>
        </div>
        <ol class="agent-feed-list" style={{ "max-height": `${feedMaxHeight()}px` }} onScroll={markSeen}>
          <For each={visible()}>
            {(entry, i) => (
              <li
                class="agent-feed-line"
                classList={{ "is-fresh": i() === 0 && flashing() }}
                data-rank={expanded() ? (i() === 0 ? 0 : undefined) : Math.min(i(), 4)}
                title={entry.narration}
              >
                {entry.narration}
              </li>
            )}
          </For>
        </ol>
        <Show when={olderCount() > 0 && !expanded()}>
          <button type="button" class="agent-feed-more" onClick={() => setExpanded(true)}>
            … +{olderCount()} older
          </button>
        </Show>
        <Show when={expanded()}>
          <button type="button" class="agent-feed-more" onClick={() => setExpanded(false)}>
            show less
          </button>
        </Show>
      </div>
    </Show>
  );
};
