import { createEffect, createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "./components/App";
import { theme } from "./state/modes";

class PitstopDrawer extends HTMLElement {
  connectedCallback() {
    // Stable identifier so any tool inspecting the obscuring element of a
    // blocked click (Playwright, agent-browser, etc.) can recognize this
    // host as pitstop's drawer and react accordingly (e.g. via set_drawer).
    this.setAttribute("data-pitstop", "drawer");
    const root = this.attachShadow({ mode: "open" });
    render(() => <App />, root);
    const isDrawerEvent = (e: Event): boolean => {
      if (e.target === this) return true;
      // For focus events, also check relatedTarget — focusout fires on the
      // outgoing element with relatedTarget pointing at the new focus target.
      // We need to swallow focusout from host-app elements when focus is
      // moving into the drawer, otherwise Reka's FocusScope yanks focus back.
      const re = (e as FocusEvent).relatedTarget;
      if (re === this) return true;
      return false;
    };
    const swallow = (e: Event) => {
      if (isDrawerEvent(e)) {
        e.stopImmediatePropagation();
      }
    };
    for (const t of [
      "click",
      "dblclick",
      "mousedown",
      "mouseup",
      "pointerdown",
      "pointerup",
      "touchstart",
      "touchend",
      "contextmenu",
      "wheel",
      "keydown",
      "keyup",
      "focusin",
      "focusout",
    ]) {
      document.addEventListener(t, swallow);
    }

    createRoot(() => {
      createEffect(() => {
        this.classList.toggle("theme-light", theme() === "light");
      });
    });
  }
}

if (!customElements.get("pitstop-drawer")) {
  customElements.define("pitstop-drawer", PitstopDrawer);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(new PitstopDrawer()));
  } else {
    document.body.appendChild(new PitstopDrawer());
  }
}
