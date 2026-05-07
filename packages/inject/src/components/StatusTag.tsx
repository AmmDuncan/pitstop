import type { Session } from "@pitstop/shared";
import { type Component, Show } from "solid-js";
import { submitState } from "../state/store";

export type PillState = "idle" | "working" | "addressing" | "writing" | "failed" | "complete";

export function derivePill(session: Session | null): { state: PillState; label: string } {
  if (!session) return { state: "idle", label: "" };
  if (session.status === "complete") return { state: "complete", label: "REVIEW_COMPLETE" };
  if (session.pokeFailed) return { state: "failed", label: "POKE_FAILED · CLICK_RETRY" };
  const last = session.agentActivity.at(-1);
  const fresh = last && Date.now() - last.at < 5000;
  if (fresh && last.tool === "mark_addressing")
    return { state: "addressing", label: last.narration ?? "ADDRESSING" };
  if (fresh && last.tool === "add_items") return { state: "writing", label: "WRITING_ITEMS" };
  if (fresh) return { state: "working", label: "PREPARING_NEXT" };
  // No fresh agent activity — show the local submit state so the user sees
  // "I sent it, the agent is being notified" instead of silence.
  const ss = submitState();
  if (ss === "sending") return { state: "working", label: "SENDING…" };
  if (ss === "poked") return { state: "working", label: "POKED_CLAUDE · WAITING" };
  return { state: "idle", label: "" };
}

export const StatusTag: Component<{ pill: ReturnType<typeof derivePill>; onRetry?: () => void }> = (
  props,
) => {
  // Narration-driven states (addressing/working/writing) are owned by the
  // AgentFeed at the bottom of the drawer — no need to also render a chip
  // up here. We only surface the StatusTag for states the feed doesn't
  // cover: failed (POKE_FAILED → click to retry) and complete.
  const renderable = () => props.pill.state === "failed" || props.pill.state === "complete";

  return (
    <Show when={renderable()}>
      <span
        class={`tag ${props.pill.state}`}
        onClick={props.pill.state === "failed" ? props.onRetry : undefined}
        style={props.pill.state === "failed" ? { cursor: "pointer" } : undefined}
      >
        <span class="dot-cell">
          <span class="static-dot" />
        </span>
        <span class="rule-cell" />
        <span class="label-cell">{props.pill.label}</span>
      </span>
    </Show>
  );
};
