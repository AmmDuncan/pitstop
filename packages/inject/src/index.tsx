import { render } from 'solid-js/web';
import { App } from './components/App';

class WalkthroughDrawer extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'closed' });
    render(() => <App />, root);
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
