import { type Component, Show, createSignal, onCleanup, onMount } from "solid-js";
import { fetchMostRecentActiveSession } from "../state/client";
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

  onMount(async () => {
    await tryBootstrap();
    if (!session.s && isExtensionMode) {
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
  });

  return (
    <Show when={!isExtensionMode || bootstrapped()}>
      <Drawer />
    </Show>
  );
};
