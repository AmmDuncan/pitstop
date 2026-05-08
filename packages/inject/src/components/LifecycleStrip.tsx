import { type Component, Show } from "solid-js";
import { elapsedFormatted, onPoke, pokeError, poking, stripState } from "../state/lifecycle";
import { reviewingComplete, session, summaryOpen } from "../state/store";

/**
 * Drawer-level lifecycle status row. Sits between AgentFeed and ActionArea
 * in the drawer grid; collapses to 0px when idle, animates to ~36px when
 * sending/poked/awaiting. Persists across item navigation (was per-item in
 * Detail.tsx prior to this lift, which made the status invisible after
 * LOOKS_GOOD auto-advanced).
 *
 * Rendering uses Show's function-child pattern for a reactive non-null
 * accessor — the bug we hit at v0.3.55 (capturing `const state = ss()` at
 * mount and never updating) is the reason for this shape.
 */
export const LifecycleStrip: Component = () => {
  // Hide the strip when the drawer is showing ReviewComplete or
  // ReviewSummary — the user is no longer driving the per-item review and
  // a stale "AWAITING CLAUDE" label would just be noise.
  const visible = () => {
    if (!stripState()) return false;
    const isComplete = session.s?.status === "complete";
    if (isComplete && !reviewingComplete()) return false;
    if (summaryOpen()) return false;
    return true;
  };
  // Read stripState() directly inside JSX rather than via Show's function-
  // child accessor — the accessor pattern returned an empty getter in
  // practice (label rendered blank, data-state missing) even though the
  // underlying signal had a value. Direct reactive reads work reliably.
  return (
    <div class="lifecycle-slot" classList={{ active: visible() }}>
      <Show when={visible()}>
        <div class="lifecycle-strip" data-state={stripState()?.kind}>
          <span class="lifecycle-dot" />
          <span class="lifecycle-label">{stripState()?.label}</span>
          {/* Driving narration (prose) sits beside the DRIVING label in
              normal-case sans — typography rule (mono uppercase = label,
              sans = prose) so a long narration wraps cleanly without the
              cramped uppercase-letter-spaced look. */}
          <Show when={stripState()?.narration}>
            <span class="lifecycle-narration">{stripState()?.narration}</span>
          </Show>
          {/* Elapsed counter on poked + awaiting; sending is too brief. */}
          <Show when={stripState()?.kind !== "sending"}>
            <span class="lifecycle-elapsed">{elapsedFormatted()}</span>
          </Show>
          {/* POKE only on AWAITING — re-poking during POKED is a no-op
              (daemon 409s the second /retry-poke while one's in flight). */}
          <Show when={stripState()?.kind === "awaiting"}>
            <button
              type="button"
              class="lifecycle-poke"
              onClick={onPoke}
              disabled={poking()}
              title="Poke Claude — re-engage if it seems stuck"
            >
              POKE
            </button>
          </Show>
        </div>
        <Show when={pokeError()}>
          <div class="lifecycle-error" role="alert">
            {pokeError()}
          </div>
        </Show>
      </Show>
    </div>
  );
};
