import { type Component, Show } from "solid-js";
import { position, side, size, theme } from "../state/modes";

const SVG_PROPS = {
  width: "16",
  height: "16",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.6",
  "stroke-linecap": "round" as const,
  "stroke-linejoin": "round" as const,
};

/**
 * Side icon — previews the side the drawer would move to on click.
 * Shows the opposite of the current `side` so the icon answers "where will this go?".
 */
export const SideIcon: Component = () => {
  // The destination side is the one we'd flip to.
  const dest = () => (side() === "right" ? "left" : "right");
  return (
    <svg {...SVG_PROPS}>
      <Show when={dest() === "right"}>
        <rect x="3" y="4" width="18" height="16" rx="1.5" />
        <rect x="14" y="4" width="7" height="16" rx="1.5" fill="currentColor" />
      </Show>
      <Show when={dest() === "left"}>
        <rect x="3" y="4" width="18" height="16" rx="1.5" />
        <rect x="3" y="4" width="7" height="16" rx="1.5" fill="currentColor" />
      </Show>
    </svg>
  );
};

/**
 * Float icon — shows the destination state on click.
 * Pinned → "pop out" glyph; floating → "dock" glyph (single panel returning to side).
 */
export const FloatIcon: Component = () => {
  const isFloating = () => position() === "floating";
  return (
    <svg {...SVG_PROPS}>
      <Show when={!isFloating()}>
        <rect x="3" y="3" width="13" height="11" rx="1.5" />
        <rect x="8" y="9" width="13" height="11" rx="1.5" fill="currentColor" stroke="none" />
        <rect x="8" y="9" width="13" height="11" rx="1.5" />
      </Show>
      <Show when={isFloating()}>
        <rect x="3" y="4" width="18" height="16" rx="1.5" />
        <rect x="3" y="4" width="18" height="16" rx="1.5" stroke="currentColor" />
      </Show>
    </svg>
  );
};

/** Size icon — varies by current size: full panel, short panel, or thin strip. */
export const SizeIcon: Component = () => {
  const s = () => size();
  return (
    <svg {...SVG_PROPS}>
      <Show when={s() === "standard"}>
        <rect x="3" y="5" width="18" height="14" rx="1.5" />
        <line x1="3" y1="9" x2="21" y2="9" />
      </Show>
      <Show when={s() === "compact"}>
        <rect x="3" y="8" width="18" height="8" rx="1.5" />
      </Show>
      <Show when={s() === "strip"}>
        <rect x="9" y="4" width="6" height="16" rx="1" />
      </Show>
    </svg>
  );
};

/** Theme icon — moon for dark, sun for light. */
export const ThemeIcon: Component = () => {
  const t = () => theme();
  return (
    <svg {...SVG_PROPS}>
      <Show when={t() === "dark"}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </Show>
      <Show when={t() === "light"}>
        <circle cx="12" cy="12" r="4" />
        <line x1="12" y1="2" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="22" />
        <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
        <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
        <line x1="2" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
        <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
      </Show>
    </svg>
  );
};

/** Minimize icon — horizontal bar at the bottom, reads as "collapse to strip". */
export const MinimizeIcon: Component = () => (
  <svg {...SVG_PROPS}>
    <line x1="5" y1="19" x2="19" y2="19" stroke-width="2" />
  </svg>
);
