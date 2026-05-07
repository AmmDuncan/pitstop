import { type Component, Show, createSignal, onCleanup, onMount } from "solid-js";
import { fetchMostRecentActiveSession, openProjectEventStream } from "../state/client";
import { installKeyboard } from "../state/keyboard";
import {
  bootstrap,
  closer,
  isSessionSwitchDismissed,
  session,
  setCloser,
  setPendingSessionSwitch,
  setStaleAdapterWarning,
  switchToSession,
} from "../state/store";
import { Drawer } from "./Drawer";

const projectRootFromScript = ((): string | null => {
  if (typeof document === "undefined") return null;
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (!src) return null;
  try {
    return new URL(src).searchParams.get("pitstop-project");
  } catch {
    return null;
  }
})();

const POLL_INTERVAL_MS = 12_000;

/** When the drawer was injected with no project hint (browser extension /
 *  bookmarklet / proxy) AND there's no active session yet, we don't want a
 *  bright "no active review" panel cluttering every localhost tab. Stay
 *  invisible and poll for a session to appear; mount the drawer the moment
 *  one does. Tabs with an active session, and tabs that explicitly wired the
 *  drawer with `?pitstop-project=`, render normally. */
export const App: Component = () => {
  const [bootstrapped, setBootstrapped] = createSignal(false);
  let poller: ReturnType<typeof setInterval> | null = null;

  const projectRoot =
    projectRootFromScript ??
    (window as unknown as { __PITSTOP_PROJECT__?: string }).__PITSTOP_PROJECT__ ??
    new URLSearchParams(window.location.search).get("pitstop-project") ??
    null;
  const isExtensionMode = projectRoot === null;

  const tryBootstrap = async () => {
    try {
      const close = await bootstrap(projectRoot);
      setCloser(() => close);
      if (session.s) {
        setBootstrapped(true);
        if (poller) {
          clearInterval(poller);
          poller = null;
        }
      }
    } catch {
      // Daemon likely down. In extension mode we'll silently keep polling;
      // in script-tag mode the user wired this themselves and will see
      // a console error in their dev app.
    }
  };

  let lobbyClose: (() => void) | null = null;

  // Always-on project lobby. Reacts to incoming `session-hello` based on
  // the current bind state:
  //   - no session bound       → bootstrap into the new one (initial mount path)
  //   - same session id        → ignore (state-snapshot SSE already covered it)
  //   - already dismissed      → ignore (user said STAY for this id earlier)
  //   - current is complete    → auto-switch (no surprise — old is done)
  //   - current is still active → set pending; drawer renders the switch prompt
  // Replaces the v0.3.42 "re-arm only on complete" effect with this single
  // handler so kill-and-restart flows (where the agent never called
  // complete_review) also get a chance to switch instead of being stuck.
  const openLobby = () => {
    if (lobbyClose || !projectRoot || isExtensionMode) return;
    lobbyClose = openProjectEventStream(projectRoot, async (e) => {
      if (e.type === "stale-adapter") {
        setStaleAdapterWarning({
          adapterVersion: e.adapterVersion,
          daemonVersion: e.daemonVersion,
        });
        return;
      }
      if (e.type !== "session-hello") return;
      const incoming = e.session;
      if (session.s?.id === incoming.id) return;
      if (isSessionSwitchDismissed(incoming.id)) return;
      if (!session.s || session.s.status === "complete") {
        // Auto-switch path: nothing to lose.
        closer()();
        const close = switchToSession(incoming);
        setCloser(() => close);
        setBootstrapped(true);
        return;
      }
      // Active session in flight — let the user decide.
      setPendingSessionSwitch(incoming);
    });
  };

  onMount(async () => {
    await tryBootstrap();
    openLobby();
    if (!session.s && isExtensionMode) {
      // Extension mode: no projectRoot, so we can't subscribe to a project
      // lobby. Fall back to polling for any active session to appear.
      poller = setInterval(async () => {
        try {
          const found = await fetchMostRecentActiveSession();
          if (found) await tryBootstrap();
        } catch {
          // Daemon may be down. Keep polling silently.
        }
      }, POLL_INTERVAL_MS);
    } else {
      setBootstrapped(true);
    }

    installKeyboard(() => {
      const host = document.querySelector("pitstop-drawer");
      const root = (host as unknown as { shadowRoot: ShadowRoot | null } | null)?.shadowRoot ?? null;
      return (root?.querySelector("textarea.cbox") ?? null) as HTMLTextAreaElement | null;
    });
  });
  onCleanup(() => {
    closer()();
    if (poller) clearInterval(poller);
    lobbyClose?.();
  });

  return (
    <Show when={!isExtensionMode || bootstrapped()}>
      <Drawer />
    </Show>
  );
};
