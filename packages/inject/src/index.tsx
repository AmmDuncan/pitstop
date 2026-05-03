import { render } from 'solid-js/web';
import { createEffect, createRoot } from 'solid-js';
import { App } from './components/App';
import { theme, resolvedTheme } from './state/modes';

class PitstopDrawer extends HTMLElement {
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

if (!customElements.get('pitstop-drawer')) {
  customElements.define('pitstop-drawer', PitstopDrawer);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(new PitstopDrawer()));
  } else {
    document.body.appendChild(new PitstopDrawer());
  }
}
