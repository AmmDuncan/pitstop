import { type Component, For } from "solid-js";
import { baseUrl } from "../state/client";
import { session, setCurrentItemIdx, setSummaryOpen, unreviewedIndices } from "../state/store";

export const ReviewSummary: Component = () => {
  const total = () => session.s?.items.length ?? 0;
  const skipped = () => unreviewedIndices();
  const reviewed = () => total() - skipped().length;

  const onReviewSkipped = () => {
    const first = skipped()[0];
    if (first === undefined) return;
    setCurrentItemIdx(first);
    setSummaryOpen(false);
  };

  const onMarkDone = async () => {
    if (!session.s) return;
    if (skipped().length > 0) {
      const ok = window.confirm(
        `${skipped().length} item(s) still unreviewed. Mark session complete anyway?`,
      );
      if (!ok) return;
    }
    await fetch(`${baseUrl}/api/sessions/${session.s.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "complete" }),
    });
    setSummaryOpen(false);
  };

  return (
    <div class="review-summary">
      <div class="summary-stamp">REVIEW_SUMMARY</div>
      <div class="summary-stats">
        <span>
          <span class="v">{String(reviewed()).padStart(2, "0")}</span>_REVIEWED
        </span>
        <span class="sep">·</span>
        <span>
          <span class="v skipped">{String(skipped().length).padStart(2, "0")}</span>_SKIPPED
        </span>
        <span class="sep">·</span>
        <span>
          <span class="v">{String(total()).padStart(2, "0")}</span>_TOTAL
        </span>
      </div>
      <div class="summary-skipped-list">
        <For each={skipped()}>
          {(idx) => {
            const it = session.s?.items[idx];
            if (!it) return null;
            return (
              <div
                class="summary-skipped-row"
                onClick={() => {
                  setCurrentItemIdx(idx);
                  setSummaryOpen(false);
                }}
              >
                <span class="summary-skipped-num">{it.id}</span>
                <span class="summary-skipped-title">{it.title}</span>
              </div>
            );
          }}
        </For>
      </div>
      <div class="summary-actions">
        <button class="btn btn-primary" onClick={onReviewSkipped} disabled={skipped().length === 0}>
          REVIEW_SKIPPED <span class="kbd">↵</span>
        </button>
        <button class="btn btn-secondary" onClick={onMarkDone}>
          MARK_DONE
        </button>
      </div>
    </div>
  );
};
