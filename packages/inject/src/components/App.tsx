import { type Component, onCleanup, onMount, createSignal } from 'solid-js';
import { bootstrap } from '../state/store';
import { installKeyboard } from '../state/keyboard';
import { Drawer } from './Drawer';

const projectRootFromScript = ((): string | null => {
  if (typeof document === 'undefined') return null;
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (!src) return null;
  try {
    return new URL(src).searchParams.get('pitstop-project');
  } catch {
    return null;
  }
})();

export const App: Component = () => {
  const [closer, setCloser] = createSignal<() => void>(() => {});
  onMount(async () => {
    const projectRoot =
      projectRootFromScript ??
      (window as unknown as { __PITSTOP_PROJECT__?: string }).__PITSTOP_PROJECT__ ??
      new URLSearchParams(window.location.search).get('pitstop-project') ??
      window.location.origin;
    const close = await bootstrap(projectRoot);
    setCloser(() => close);

    installKeyboard(() => {
      const host = document.querySelector('pitstop-drawer');
      const root = (host as unknown as { shadowRoot: ShadowRoot | null } | null)?.shadowRoot ?? null;
      return (root?.querySelector('textarea.cbox') ?? null) as HTMLTextAreaElement | null;
    });
  });
  onCleanup(() => closer()());
  return <Drawer />;
};
