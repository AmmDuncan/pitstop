import { type Component, Show, createSignal, onCleanup, onMount } from "solid-js";
import { baseUrl } from "../state/client";
import { startFloatDrag } from "../state/float-drag";
import {
  position,
  setSize,
  side,
  size,
  theme,
  toggleFloat,
  togglePinSide,
  toggleSize,
  toggleTheme,
} from "../state/modes";
import { currentItemIdx, session, setHelpOpen } from "../state/store";
import { KebabIcon, MinimizeIcon, PadlockIcon, PositionIcon, SizeIcon, ThemeIcon } from "./Icons";
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

  // v0.3.61: kebab collapse disabled. With the current count of secondary
  // buttons (just one), collapsing into a kebab when the drawer is narrow
  // wasn't earning its complexity — users hit the kebab to reach a single
  // button. Re-enable when we introduce more secondary controls; the
  // ResizeObserver / NARROW_THRESHOLD / kebabOpen plumbing stays in place
  // so flipping this back is a one-line change.
  const secondaryCollapsed = () => false;
  // Suppress unused warnings on the still-wired-but-dormant pieces.
  void headerWidth;
  void NARROW_THRESHOLD;

  const onRetry = async () => {
    if (!session.s) return;
    try {
      const r = await fetch(`${baseUrl}/api/sessions/${session.s.id}/retry-poke`, { method: "POST" });
      if (!r.ok) {
        // Surface the daemon's reason in the title attribute so a hover on
        // the failed pill explains itself. Pre-v0.3.43 this was silently
        // swallowed and the pill just kept saying POKE_FAILED · CLICK_RETRY
        // even when the retry was also failing for the same reason.
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        console.error("retry-poke failed:", body.error ?? `HTTP ${r.status}`);
      }
    } catch (err) {
      console.error("retry-poke failed", err);
    }
  };

  const sideTitle = () => `Drawer on ${side()} · Click to move to ${side() === "right" ? "left" : "right"}`;
  const padlockTitle = () =>
    position() === "floating"
      ? `Drawer floating · Click to dock to ${side()}`
      : "Drawer pinned · Click to float";
  const themeTitle = () => `Theme: ${theme()} · Click to switch to ${theme() === "dark" ? "light" : "dark"}`;
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
      onPointerDown={startFloatDrag}
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
        <button class="x-btn help-btn" onClick={() => setHelpOpen(true)} title="Show keyboard shortcuts">
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
              <button class="kebab-item" onClick={closeKebabAfter(toggleTheme)} role="menuitem">
                <span class="kebab-glyph">
                  <ThemeIcon />
                </span>
                <span>Theme · {theme()}</span>
              </button>
              <button class="kebab-item" onClick={closeKebabAfter(() => setHelpOpen(true))} role="menuitem">
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
