import { type Component, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { bootstrap, session } from '../state/store';

export const App: Component = () => {
  const [closer, setCloser] = createSignal<() => void>(() => {});

  onMount(async () => {
    const projectRoot =
      new URLSearchParams(window.location.search).get('walkthrough-project') ?? window.location.origin;
    const close = await bootstrap(projectRoot);
    setCloser(() => close);
  });

  onCleanup(() => closer()());

  return (
    <Show
      when={session.s}
      fallback={
        <div
          style={{
            position: 'fixed',
            top: '12px',
            right: '12px',
            padding: '8px 12px',
            background: '#000',
            color: '#fff',
            'font-family': 'monospace',
            'font-size': '11px',
            'z-index': 999_999,
          }}
        >
          WALKTHROUGH · idle
        </div>
      }
    >
      <div
        style={{
          position: 'fixed',
          top: '12px',
          right: '12px',
          padding: '8px 12px',
          background: '#000',
          color: '#0f0',
          'font-family': 'monospace',
          'font-size': '11px',
          'z-index': 999_999,
        }}
      >
        WALKTHROUGH · {session.s?.items.length ?? 0} items · session {session.s?.id}
      </div>
    </Show>
  );
};
