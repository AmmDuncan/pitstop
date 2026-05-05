import type { Component } from "solid-js";
import { setSize } from "../state/modes";
import { responseCounts, session, setReviewingComplete } from "../state/store";

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export const ReviewComplete: Component = () => {
  const duration = () => {
    const s = session.s;
    if (!s) return "—";
    return formatDuration(s.updatedAt - s.createdAt);
  };

  const onReviewItems = () => setReviewingComplete(true);
  const onClose = () => setSize("strip");

  return (
    <div class="review-complete">
      <div class="rc-stamp">REVIEW_COMPLETE</div>
      <div class="rc-stats">
        <span>
          <span class="v">{String(responseCounts().approved).padStart(2, "0")}</span>_APPROVED
        </span>
        <span class="sep">·</span>
        <span>
          <span class="v">{String(responseCounts().commented).padStart(2, "0")}</span>_COMMENTED
        </span>
        <span class="sep">·</span>
        <span>
          <span class="v">{String(responseCounts().left).padStart(2, "0")}</span>_LEFT
        </span>
      </div>
      <div class="rc-time">T = {duration()}</div>
      <div class="rc-actions">
        <button class="btn btn-secondary" onClick={onReviewItems}>
          REVIEW_ITEMS
        </button>
        <button class="btn btn-primary" onClick={onClose}>
          CLOSE
        </button>
      </div>
    </div>
  );
};
