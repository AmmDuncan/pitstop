import { type Component, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { type UpdateStatusResponse, fetchUpdateStatus } from "../state/client";

const [updateStatus, setUpdateStatus] = createSignal<UpdateStatusResponse | null>(null);

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

  return (
    <Show when={updateStatus()?.updateAvailable && updateStatus()?.latest}>
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
            <p class="update-popover-foot">Restart the daemon after running the command.</p>
          </div>
        </Show>
      </span>
    </Show>
  );
};
