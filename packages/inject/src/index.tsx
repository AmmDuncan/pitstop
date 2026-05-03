import { render } from 'solid-js/web';
import { createEffect, createRoot } from 'solid-js';
import { App } from './components/App';
import { theme, resolvedTheme } from './state/modes';

class WalkthroughDrawer extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    render(() => <App />, root);

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

if (!customElements.get('walkthrough-drawer')) {
  customElements.define('walkthrough-drawer', WalkthroughDrawer);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(new WalkthroughDrawer()));
  } else {
    document.body.appendChild(new WalkthroughDrawer());
  }
}
