import { type Component, Show } from "solid-js";
import { dismissStaleAdapterWarning, staleAdapterWarning } from "../state/store";

/** Shown when the daemon detects the MCP adapter subprocess is running an
 *  older version than itself — meaning Claude Code didn't actually restart
 *  the subprocess on the last "restart" and any new MCP code on disk
 *  (env-var fixes, new tool descriptions, etc.) won't take effect until
 *  the user does a *full* CC quit + relaunch. The banner lives above the
 *  metabar so it's the first thing the user sees, dismissable per drawer
 *  mount via the small ×. */
export const StaleAdapterBanner: Component = () => {
  const w = () => staleAdapterWarning();
  return (
    <Show when={w()}>
      <div class="stale-adapter-banner" role="alert">
        <span class="stale-adapter-icon" aria-hidden="true">
          ⚠
        </span>
        <span class="stale-adapter-msg">
          MCP adapter is <span class="mono">v{w()!.adapterVersion}</span>, daemon is{" "}
          <span class="mono">v{w()!.daemonVersion}</span> — fully quit Claude Code (Cmd+Q) and
          relaunch so the new adapter loads.
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
  );
};
