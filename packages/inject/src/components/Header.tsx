import { type Component, createSignal, onCleanup, onMount, Show } from "solid-js";
import { baseUrl } from "../state/client";
import {
  toggleSize,
  floatingLeft,
  floatingTop,
  position,
  setFloatingLeft,
  setFloatingTop,
  setSize,
  side,
  size,
  theme,
  toggleFloat,
  togglePinSide,
  toggleTheme,
} from "../state/modes";
import { currentItemIdx, session, setHelpOpen } from "../state/store";
import {
  KebabIcon,
  MinimizeIcon,
  PadlockIcon,
  PositionIcon,
  SizeIcon,
  ThemeIcon,
} from "./Icons";
import { StatusTag, derivePill } from "./StatusTag";

/** Pixel width below which secondary controls collapse into the kebab menu.
 *  Tuned so the standard 504px drawer keeps everything inline; compact +
 *  long branch labels push past it. */
const NARROW_THRESHOLD = 440;

export const Header: Component = () => {
  const pill = () => derivePill(session.s);
  const total = () => session.s?.items.length ?? 0;
  const current = () => Math.min(currentItemIdx() + 1, total());

  const [headerWidth, setHeaderWidth] = createSignal(9999);
  const [kebabOpen, setKebabOpen] = createSignal(false);
  let headerRef: HTMLElement | undefined;
  let kebabWrapRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!headerRef) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setHeaderWidth(entry.contentRect.width);
    });
    ro.observe(headerRef);
    onCleanup(() => ro.disconnect());

    // Click-outside to close kebab — bound at document level inside the
    // shadow root so it sees clicks anywhere in the drawer chrome.
    const onDocClick = (e: MouseEvent) => {
      if (!kebabOpen()) return;
      const target = e.target as Node | null;
      if (kebabWrapRef && target && !kebabWrapRef.contains(target)) {
        setKebabOpen(false);
      }
    };
    document.addEventListener("click", onDocClick, true);
    onCleanup(() => document.removeEventListener("click", onDocClick, true));
  });

  // Trigger collapse on either narrow header or compact size — both legitimate
  // squeeze cases per spec. Items hop back inline when neither holds.
  const secondaryCollapsed = () => headerWidth() < NARROW_THRESHOLD || size() === "compact";

  const onRetry = async () => {
    if (!session.s) return;
    try {
      await fetch(`${baseUrl}/api/sessions/${session.s.id}/retry-poke`, { method: "POST" });
    } catch (err) {
      console.error("retry-poke failed", err);
    }
  };

  // Floating-drawer drag uses pointer events with implicit capture so the
  // release fires reliably even when the cursor leaves the browser window or
  // crosses iframe/shadow boundaries mid-drag.
  const onHeaderPointerDown = (e: PointerEvent) => {
    if (position() !== "floating") return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, a, [role="button"]')) return;

    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const startTop = floatingTop();
    const startLeft = floatingLeft();

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dy = ev.clientY - startY;
      const dx = ev.clientX - startX;
      setFloatingTop(Math.max(0, startTop + dy));
      setFloatingLeft(Math.max(0, startLeft + dx));
    };
    const release = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("lostpointercapture", release);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  const sideTitle = () =>
    `Drawer on ${side()} · Click to move to ${side() === "right" ? "left" : "right"}`;
  const padlockTitle = () =>
    position() === "floating"
      ? `Drawer floating · Click to dock to ${side()}`
      : "Drawer pinned · Click to float";
  const themeTitle = () =>
    `Theme: ${theme()} · Click to switch to ${theme() === "dark" ? "light" : "dark"}`;
  const sizeTitle = () =>
    `Size: ${size()} · Click to switch to ${size() === "standard" ? "compact" : "standard"}`;

  const closeKebabAfter = (fn: () => void) => () => {
    fn();
    setKebabOpen(false);
  };

  return (
    <header
      ref={headerRef}
      class="dheader"
      onPointerDown={onHeaderPointerDown}
      classList={{ draggable: position() === "floating" }}
    >
      <div class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16">
          <rect x="0" y="0" width="12" height="12" fill="currentColor" />
          <rect x="12" y="12" width="12" height="12" fill="currentColor" />
        </svg>
      </div>
      <div class="name-block">
        <div class="name">PITSTOP</div>
        <div class="ctx" title={session.s?.branch ?? session.s?.projectRoot ?? "—"}>
          {session.s?.branch ?? session.s?.projectRoot ?? "—"}
        </div>
      </div>
      <Show when={total() > 0}>
        <span class="counter">
          <span class="counter-cur">{String(current()).padStart(2, "0")}</span>
          <span class="counter-sep">/</span>
          <span class="counter-total">{String(total()).padStart(2, "0")}</span>
        </span>
      </Show>
      <Show when={pill().state !== "complete"}>
        <StatusTag pill={pill()} onRetry={onRetry} />
      </Show>

      {/* Anchoring group: position + padlock sit adjacent — both control where
          the drawer is docked. Position hides while floating (no side applies). */}
      <Show when={position() !== "floating"}>
        <button class="x-btn pos-btn" onClick={togglePinSide} title={sideTitle()}>
          <PositionIcon />
        </button>
      </Show>
      <button class="x-btn padlock-btn" onClick={toggleFloat} title={padlockTitle()}>
        <PadlockIcon />
      </button>

      {/* Size cycle — its own concern (binary standard ↔ compact). */}
      <button class="x-btn size-btn" onClick={toggleSize} title={sizeTitle()}>
        <SizeIcon />
      </button>

      {/* Secondary pair — inline at full width, swept into kebab when collapsed. */}
      <Show when={!secondaryCollapsed()}>
        <button class="x-btn theme-btn" onClick={toggleTheme} title={themeTitle()}>
          <ThemeIcon />
        </button>
        <button
          class="x-btn help-btn"
          onClick={() => setHelpOpen(true)}
          title="Show keyboard shortcuts"
        >
          ?
        </button>
      </Show>

      <Show when={secondaryCollapsed()}>
        <div class="kebab-wrap" ref={kebabWrapRef}>
          <button
            class="x-btn kebab-btn"
            classList={{ open: kebabOpen() }}
            onClick={() => setKebabOpen(!kebabOpen())}
            title="More controls"
          >
            <KebabIcon />
          </button>
          <Show when={kebabOpen()}>
            <div class="kebab-menu" role="menu">
              <button
                class="kebab-item"
                onClick={closeKebabAfter(toggleTheme)}
                role="menuitem"
              >
                <span class="kebab-glyph">
                  <ThemeIcon />
                </span>
                <span>Theme · {theme()}</span>
              </button>
              <button
                class="kebab-item"
                onClick={closeKebabAfter(() => setHelpOpen(true))}
                role="menuitem"
              >
                <span class="kebab-glyph">?</span>
                <span>Help</span>
              </button>
            </div>
          </Show>
        </div>
      </Show>

      <button class="x-btn min-btn" onClick={() => setSize("strip")} title="Minimize to strip">
        <MinimizeIcon />
      </button>
    </header>
  );
};
