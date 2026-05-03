import { type Component, onCleanup, onMount, createSignal } from 'solid-js';
import { bootstrap } from '../state/store';
import { Drawer } from './Drawer';

export const App: Component = () => {
  const [closer, setCloser] = createSignal<() => void>(() => {});
  onMount(async () => {
    const projectRoot =
      new URLSearchParams(window.location.search).get('walkthrough-project') ?? window.location.origin;
    const close = await bootstrap(projectRoot);
    setCloser(() => close);
  });
  onCleanup(() => closer()());
  return <Drawer />;
};
