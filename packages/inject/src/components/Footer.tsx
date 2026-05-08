import { type Component, Show } from "solid-js";
import { patchSessionStatus } from "../state/client";
import { reviewingComplete, session, setReviewingComplete } from "../state/store";

export const Footer: Component = () => {
  const isPaused = () => session.s?.status === "paused";
  const isComplete = () => session.s?.status === "complete";

  const togglePause = async () => {
    if (!session.s) return;
    await patchSessionStatus(session.s.id, isPaused() ? "active" : "paused");
  };

  const onDone = async () => {
    if (!session.s) return;
    await patchSessionStatus(session.s.id, "complete");
  };

  // v0.3.58: dropped the OK / QUEUED / LEFT counts segment. Pip strip + the
  // header's `01/04` counter already carry "where am I in the review";
  // repeating the info here served no practical purpose.
  return (
    <footer class="dfooter">
      <div class="actions-r">
        <Show
          when={!isComplete()}
          fallback={
            <Show when={reviewingComplete()}>
              <button
                class="footer-btn"
                onClick={() => setReviewingComplete(false)}
                title="Return to the review-complete summary"
              >
                BACK_TO_SUMMARY
              </button>
            </Show>
          }
        >
          <button
            class="footer-btn"
            onClick={togglePause}
            title={
              isPaused()
                ? "Resume the review (drawer un-dims, agent picks up where it left off)"
                : "Pause the review (drawer dims, agent stops driving — reversible)"
            }
          >
            {isPaused() ? "RESUME" : "PAUSE"}
          </button>
          <button
            class="footer-btn"
            onClick={onDone}
            title="End the review session (final — flips status to REVIEW_COMPLETE)"
          >
            DONE
          </button>
        </Show>
      </div>
    </footer>
  );
};
