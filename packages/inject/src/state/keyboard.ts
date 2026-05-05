import { onCleanup } from "solid-js";
import { submitResponse } from "./client";
import { toggleFloat, togglePinSide, toggleSize, toggleTheme } from "./modes";
import {
  currentItemIdx,
  helpOpen,
  session,
  setCurrentItemIdx,
  setHelpOpen,
  setSummaryOpen,
  summaryOpen,
  unreviewedIndices,
} from "./store";

type Handler = (e: KeyboardEvent) => boolean | void;

/** Walks activeElement chains through shadow roots to find the truly focused element. */
function deepActiveElement(): Element | null {
  let el: Element | null = document.activeElement;
  while (el && (el as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot?.activeElement) {
    el = (el as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot.activeElement;
  }
  return el;
}

function isTextInputFocused(): boolean {
  const el = deepActiveElement();
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT" || (el as HTMLElement).isContentEditable === true;
}

export function installKeyboard(getCommentEl: () => HTMLTextAreaElement | null) {
  const next = () => {
    if (!session.s) return;
    if (summaryOpen()) {
      setSummaryOpen(false);
      return;
    }
    setCurrentItemIdx(Math.min(session.s.items.length - 1, currentItemIdx() + 1));
  };
  const prev = () => {
    if (summaryOpen()) {
      setSummaryOpen(false);
      return;
    }
    setCurrentItemIdx(Math.max(0, currentItemIdx() - 1));
  };

  const handlers: Record<string, Handler> = {
    j: next,
    ArrowDown: next,
    k: prev,
    ArrowUp: prev,
    Enter: (e) => {
      if (isTextInputFocused()) return false;
      if (!session.s) return;
      // From summary view, Enter = REVIEW_SKIPPED (jump to first skipped, dismiss summary).
      if (summaryOpen()) {
        const first = unreviewedIndices()[0];
        if (first !== undefined) setCurrentItemIdx(first);
        setSummaryOpen(false);
        e.preventDefault();
        return;
      }
      const item = session.s.items[currentItemIdx()];
      if (!item) return;
      submitResponse(session.s.id, { itemId: item.id, kind: "approve" }).then(next);
      e.preventDefault();
    },
    c: (e) => {
      const ta = getCommentEl();
      if (ta) {
        ta.focus();
        e.preventDefault();
      }
    },
    Escape: (e) => {
      // Only consume Escape when the drawer actually has something to dismiss.
      // Otherwise let it bubble — the user might be closing a host-app modal.
      if (helpOpen()) {
        setHelpOpen(false);
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (isTextInputFocused()) {
        getCommentEl()?.blur();
        e.stopPropagation();
        e.preventDefault();
      }
    },
    "?": (e) => {
      setHelpOpen(!helpOpen());
      e.preventDefault();
    },
    "[": togglePinSide,
    "]": toggleFloat,
    "=": toggleSize,
    "+": toggleSize,
    t: () => toggleTheme(),
  };

  const onKey = (e: KeyboardEvent) => {
    if (helpOpen() && e.key !== "?" && e.key !== "Escape") return;
    if (e.metaKey && e.key === "Enter") {
      // When the textarea is focused, its own onKeyDown drives the submit
      // through Detail's onComment (with proper submitState lifecycle).
      // Skipping here avoids a duplicate POST.
      if (isTextInputFocused()) return;
      const ta = getCommentEl();
      const body = ta?.value.trim();
      if (session.s && body) {
        const item = session.s.items[currentItemIdx()];
        if (item) {
          submitResponse(session.s.id, { itemId: item.id, kind: "comment", body });
          if (ta) ta.value = "";
        }
      }
      return;
    }
    // Don't capture single-key shortcuts while the user is typing — in our own
    // textarea or any input on the host page. Escape and ⌘⏎ remain reachable.
    if (isTextInputFocused() && e.key !== "Escape") return;
    const h = handlers[e.key];
    if (h) h(e);
  };
  // Capture phase: fires while the event is travelling down to its target,
  // before the drawer host's bubble-phase stopPropagation barrier kicks in.
  // This way the drawer's own shortcuts work for keys originating inside the
  // drawer, while the host element still swallows the event afterwards so
  // host-app keyboard listeners never see it.
  window.addEventListener("keydown", onKey, true);
  onCleanup(() => window.removeEventListener("keydown", onKey, true));
}
