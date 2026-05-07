import { type Component, Show } from "solid-js";
import {
  closer,
  dismissPendingSessionSwitch,
  pendingSessionSwitch,
  session,
  setCloser,
  switchToSession,
} from "../state/store";

/** Drawer-internal overlay shown when a `session-hello` arrives for a
 *  different session id while the current one is still active. User picks
 *  SWITCH (closes old SSE, binds to the new) or STAY (dismisses for the
 *  rest of this drawer mount; that specific id won't re-prompt). After a
 *  `complete_review` the drawer auto-switches without this prompt — only
 *  the kill-and-restart-without-completing case lands you here. */
export const SessionSwitchPrompt: Component = () => {
  const incoming = () => pendingSessionSwitch();

  const onStay = () => {
    const id = incoming()?.id;
    if (id) dismissPendingSessionSwitch(id);
  };

  const onSwitch = () => {
    const target = incoming();
    if (!target) return;
    closer()();
    const close = switchToSession(target);
    setCloser(() => close);
    dismissPendingSessionSwitch(target.id);
  };

  return (
    <Show when={incoming()}>
      <div class="session-switch-backdrop" onClick={onStay}>
        <div
          class="session-switch-card"
          role="dialog"
          aria-label="Switch to newer pitstop session"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="session-switch-eyebrow">NEWER_SESSION_AVAILABLE</div>
          <div class="session-switch-summary">
            <span class="session-switch-id">S#{incoming()!.id}</span>
            <span class="session-switch-meta">
              {incoming()!.items.length} item{incoming()!.items.length === 1 ? "" : "s"}
            </span>
          </div>
          <p class="session-switch-body">
            A new pitstop session was created for this projectRoot while you're still on{" "}
            <span class="mono">S#{session.s?.id}</span>. Switch to it, or stay where you are?
          </p>
          <div class="session-switch-actions">
            <button type="button" class="btn btn-primary" onClick={onSwitch}>
              SWITCH
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
