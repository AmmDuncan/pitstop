import { type Component, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { type UpdateStatusResponse, fetchUpdateStatus, submitResponse } from "../state/client";
import { session } from "../state/store";

const [updateStatus, setUpdateStatus] = createSignal<UpdateStatusResponse | null>(null);
/** Module-level so the metabar's right-slot logic (Drawer.tsx) can read it
 *  and let the CLAUDE# diagnostic chip take the slot once dismissed. Resets
 *  on drawer remount (no persistence — the offer is a fresh prompt every
 *  page load if the user hasn't acted on it yet). */
export const [updateDismissed, setUpdateDismissed] = createSignal(false);
/** True iff there's an actionable update offer the user hasn't dismissed. */
export const updateChipShown = () =>
  !updateDismissed() && Boolean(updateStatus()?.updateAvailable && updateStatus()?.latest);

/** Lazily fetch the update status the first time any drawer instance mounts.
 *  The result is cached in the daemon for its lifetime, so re-calling on
 *  reload is cheap. */
let initiated = false;
async function loadOnce() {
  if (initiated) return;
  initiated = true;
  const res = await fetchUpdateStatus();
  if (res) setUpdateStatus(res);
}

/** Small chip for the metabar's right slot. Renders only when an update is
 *  available; otherwise the slot stays empty. Click opens a popover with a
 *  pre-filled update command + release-notes link. */
export const UpdateChip: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  let wrapRef: HTMLSpanElement | undefined;

  onMount(() => {
    void loadOnce();

    const onDocClick = (e: MouseEvent) => {
      if (!open()) return;
      const t = e.target as Node | null;
      if (wrapRef && t && !wrapRef.contains(t)) setOpen(false);
    };
    document.addEventListener("click", onDocClick, true);
    onCleanup(() => document.removeEventListener("click", onDocClick, true));
  });

  const command = () => {
    const s = updateStatus();
    if (!s?.installPath) return "";
    return `cd ${s.installPath} && git pull && bun run setup`;
  };

  const onCopy = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(command());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  /** Send the update command to the bound agent so it runs the update for
   *  the user — same delivery channel as a comment, so the existing
   *  comment-poke path picks it up and spawns `claude --resume`. The body
   *  is human-readable; the agent handles it like any other inbound message. */
  const onAskAgent = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!session.s) return;
    const cmd = command();
    if (!cmd) return;
    const itemId = session.s.items[0]?.id;
    if (!itemId) return;
    const directive = `Pitstop update available: please run \`${cmd}\` and then restart the daemon. Once it's restarted, continue the review where we left off.`;
    try {
      await submitResponse(session.s.id, { itemId, kind: "comment", body: directive });
      setUpdateDismissed(true);
      setOpen(false);
    } catch (err) {
      console.error("update directive failed", err);
    }
  };

  const onDismiss = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setUpdateDismissed(true);
    setOpen(false);
  };

  return (
    <Show when={updateChipShown()}>
      <span class="update-chip-wrap" ref={wrapRef}>
        <button
          type="button"
          class="update-chip"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open());
          }}
          title={`Update available — daemon on ${updateStatus()!.current}, latest is ${updateStatus()!.latest}.`}
        >
          ↑ {updateStatus()!.latest}
        </button>
        <Show when={open()}>
          <div class="update-popover" role="dialog" aria-label="Pitstop update">
            <button
              type="button"
              class="update-popover-dismiss"
              onClick={onDismiss}
              title="Dismiss for this session"
              aria-label="Dismiss"
            >
              ×
            </button>
            <div class="update-popover-head">
              <span class="update-popover-eyebrow">UPDATE_AVAILABLE</span>
              <span class="update-popover-versions">
                v{updateStatus()!.current} → v{updateStatus()!.latest}
              </span>
            </div>
            <Show when={command()}>
              <pre class="update-popover-cmd">{command()}</pre>
            </Show>
            <div class="update-popover-actions">
              <Show when={command() && session.s}>
                <button type="button" class="update-popover-btn primary" onClick={onAskAgent}>
                  Update now
                </button>
              </Show>
              <Show when={command()}>
                <button type="button" class="update-popover-btn" onClick={onCopy}>
                  {copied() ? "Copied" : "Copy command"}
                </button>
              </Show>
              <Show when={updateStatus()?.releaseUrl}>
                <a
                  class="update-popover-btn"
                  href={updateStatus()!.releaseUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                >
                  Release notes
                </a>
              </Show>
            </div>
            <p class="update-popover-foot">
              "Update now" asks the bound agent to run it. Restart the daemon after.
            </p>
          </div>
        </Show>
      </span>
    </Show>
  );
};
