import { type Component, Show } from "solid-js";
import { postDrawerMoveDecision } from "../state/client";
import { type Position, pendingDrawerMove, setPendingDrawerMove, setPosition } from "../state/modes";
import { session } from "../state/store";

/** Drawer-internal overlay shown when an agent calls set_drawer with a
 *  position change. We never apply position changes silently — every
 *  right ↔ left, pinned ↔ floating, and floating snap-back is a visible
 *  "yank" the user didn't ask for. The agent's role is to *request* a
 *  move and explain why; the user accepts or declines. Visually mirrors
 *  SessionSwitchPrompt for consistency (see CSS .session-switch-*). */
const labelFor = (p: Position): string => (p === "floating" ? "FLOATING" : p.toUpperCase());

export const DrawerMovePrompt: Component = () => {
  const move = () => pendingDrawerMove();
  const sid = () => session.s?.id;

  const onStay = () => {
    const m = move();
    const id = sid();
    setPendingDrawerMove(null);
    if (m && id) postDrawerMoveDecision(id, { accepted: false, from: m.from, to: m.to });
  };

  const onMove = () => {
    const m = move();
    const id = sid();
    if (!m) return;
    setPosition(m.to);
    setPendingDrawerMove(null);
    if (id) postDrawerMoveDecision(id, { accepted: true, from: m.from, to: m.to });
  };

  return (
    <Show when={move()}>
      <div class="session-switch-backdrop" onClick={onStay}>
        <div
          class="session-switch-card"
          role="dialog"
          aria-label="Confirm drawer move"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="session-switch-eyebrow">DRAWER_MOVE_REQUESTED</div>
          <div class="session-switch-summary">
            <span class="session-switch-id">
              {labelFor(move()!.from)} → {labelFor(move()!.to)}
            </span>
          </div>
          <Show when={move()!.narration}>
            <p class="session-switch-body">{move()!.narration}</p>
          </Show>
          <Show when={!move()!.narration}>
            <p class="session-switch-body">The agent wants to reposition the drawer.</p>
          </Show>
          <div class="session-switch-actions">
            <button type="button" class="btn btn-primary" onClick={onMove}>
              MOVE
            </button>
            <button type="button" class="btn btn-secondary" onClick={onStay}>
              STAY
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
