import { type Component, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { fetchMostRecentActiveSession, openProjectEventStream } from "../state/client";
import { installKeyboard } from "../state/keyboard";
import { bootstrap, session } from "../state/store";
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
  const [closer, setCloser] = createSignal<() => void>(() => {});
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

  // Subscribe to the project lobby so we can pick up the next start_review
  // for this projectRoot — used both at first mount (no session yet) and
  // again after a session completes (so the drawer reconnects to the next
  // pitstop without a tab reload).
  const openLobby = () => {
    if (lobbyClose || !projectRoot || isExtensionMode) return;
    lobbyClose = openProjectEventStream(projectRoot, async (e) => {
      if (e.type === "session-hello") {
        lobbyClose?.();
        lobbyClose = null;
        // Close the SSE for the prior (completed) session before binding the
        // new one — otherwise its EventSource leaks until the tab reloads.
        closer()();
        await tryBootstrap();
      }
    });
  };

  // Re-arm the lobby whenever the bound session transitions to 'complete'.
  // Without this, the drawer is stuck on REVIEW_COMPLETE for the old session
  // and a fresh start_review on the same projectRoot has no subscriber.
  createEffect(() => {
    if (session.s?.status === "complete") openLobby();
  });

  onMount(async () => {
    await tryBootstrap();
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
      if (!session.s) openLobby();
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
