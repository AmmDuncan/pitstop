import { render } from 'solid-js/web';
import { createEffect, createRoot } from 'solid-js';
import { App } from './components/App';
import { theme, resolvedTheme } from './state/modes';

class PitstopDrawer extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    render(() => <App />, root);

    // Stop drawer-originated events from leaking to host-app document
    // listeners (Reka click-outside detectors, host hotkeys, etc.) — without
    // breaking Solid's own event delegation, which is on document.
    //
    // Why document and not the host element: Solid delegates events on
    // document. If we stopPropagation at the host (bubble phase, between
    // shadow root and document), Solid's delegated handler never fires and
    // every `onClick` in the drawer goes dead.
    //
    // Why bubble phase + stopImmediatePropagation: capture phase would fire
    // before the inner target receives the event (kills focus, default
    // actions). Bubble phase fires AFTER inner handlers and after Solid's
    // delegated handler (which registered first, during render() above).
    // stopImmediatePropagation then halts every subsequent listener on
    // document — including any registered after this one (Reka modals,
    // host hotkeys, etc.).
    const host = this;
    const isDrawerEvent = (e: Event): boolean => {
      if (e.target === host) return true;
      // For focus events, also check relatedTarget — focusout fires on the
      // outgoing element with relatedTarget pointing at the new focus target.
      // We need to swallow focusout from host-app elements when focus is
      // moving into the drawer, otherwise Reka's FocusScope yanks focus back.
      const re = (e as FocusEvent).relatedTarget;
      if (re === host) return true;
      return false;
    };
    const swallow = (e: Event) => {
      if (isDrawerEvent(e)) {
        e.stopImmediatePropagation();
      }
    };
    for (const t of [
      'click', 'dblclick', 'mousedown', 'mouseup',
      'pointerdown', 'pointerup',
      'touchstart', 'touchend',
      'contextmenu', 'wheel',
      'keydown', 'keyup',
      'focusin', 'focusout',
    ]) {
      document.addEventListener(t, swallow);
    }

    const updateTheme = () => {
      this.classList.toggle('theme-light', resolvedTheme() === 'light');
    };

    createRoot(() => {
      createEffect(() => {
        theme(); // subscribe to signal changes
        updateTheme();
      });
    });

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
    }
  }
}

if (!customElements.get('pitstop-drawer')) {
  customElements.define('pitstop-drawer', PitstopDrawer);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(new PitstopDrawer()));
  } else {
    document.body.appendChild(new PitstopDrawer());
  }
}
