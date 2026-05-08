import { type Component, Show } from "solid-js";
import { dismissStaleAdapterWarning, staleAdapterWarning } from "../state/store";
import { WarningIcon } from "./Icons";

/** Shown when the daemon detects the MCP adapter subprocess is running an
 *  older version than itself — meaning Claude Code didn't actually restart
 *  the subprocess on the last "restart" and any new MCP code on disk
 *  (env-var fixes, new tool descriptions, etc.) won't take effect until
 *  the user does a *full* CC quit + relaunch. Renders as a slim row in
 *  the drawer's grid (above the metabar), dismissable per drawer mount. */
export const StaleAdapterBanner: Component = () => {
  const w = () => staleAdapterWarning();
  // Always render the slot wrapper so the parent grid keeps a stable
  // child count — without it, when the banner is empty, Solid's <Show>
  // returns nothing and every child below shifts up by one grid row,
  // throwing off the whole drawer layout.
  return (
    <div class="stale-adapter-slot">
      <Show when={w()}>
        <div class="stale-adapter-banner" role="alert">
          <span class="stale-adapter-icon" aria-hidden="true">
            <WarningIcon />
          </span>
          <span class="stale-adapter-msg">
            MCP adapter
            <Show when={w()!.adapterPid}>
              {" "}
              <span class="stale-adapter-tag">pid {w()!.adapterPid}</span>
            </Show>{" "}
            is <span class="stale-adapter-tag">v{w()!.adapterVersion}</span>, daemon is{" "}
            <span class="stale-adapter-tag">v{w()!.daemonVersion}</span>.{" "}
            <Show
              when={w()!.adapterPid}
              fallback="To get them in sync, you'll want to fully quit Claude Code (Cmd+Q) and relaunch."
            >
              To get them in sync, you'll want to run{" "}
              <code class="stale-adapter-cmd">kill {w()!.adapterPid}</code> and relaunch Claude Code.
            </Show>
          </span>
          <button
            type="button"
            class="stale-adapter-dismiss"
            onClick={dismissStaleAdapterWarning}
            title="Dismiss for this session"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      </Show>
    </div>
  );
};
