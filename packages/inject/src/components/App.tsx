import { type Component, onCleanup, onMount, createSignal } from 'solid-js';
import { bootstrap } from '../state/store';
import { installKeyboard } from '../state/keyboard';
import { Drawer } from './Drawer';

export const App: Component = () => {
  const [closer, setCloser] = createSignal<() => void>(() => {});
  onMount(async () => {
    const projectRoot =
      (window as unknown as { __WALKTHROUGH_PROJECT__?: string }).__WALKTHROUGH_PROJECT__ ??
      new URLSearchParams(window.location.search).get('walkthrough-project') ??
      window.location.origin;
    const close = await bootstrap(projectRoot);
    setCloser(() => close);

    installKeyboard(() => {
      const host = document.querySelector('walkthrough-drawer');
      const root = (host as unknown as { shadowRoot: ShadowRoot | null } | null)?.shadowRoot ?? null;
      return (root?.querySelector('textarea.cbox') ?? null) as HTMLTextAreaElement | null;
    });
  });
  onCleanup(() => closer()());
  return <Drawer />;
};
