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
 * Position icon — Lucide PanelLeft / PanelRight. Shows the drawer's
 * *current* docked side as a filled segment. Click flips to the other side.
 */
export const PositionIcon: Component = () => {
  const cur = () => side();
  return (
    <svg {...SVG_PROPS}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <Show when={cur() === "left"}>
        <rect x="3" y="3" width="6" height="18" fill="currentColor" stroke="none" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </Show>
      <Show when={cur() === "right"}>
        <rect x="15" y="3" width="6" height="18" fill="currentColor" stroke="none" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </Show>
    </svg>
  );
};

/**
 * Padlock — Lucide Lock / LockOpen.
 * Closed = drawer pinned to a side; open = drawer floating.
 * Click flips between the two; reflow pref persists across the flip.
 */
export const PadlockIcon: Component = () => {
  const isFloating = () => position() === "floating";
  return (
    <svg {...SVG_PROPS}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <Show when={!isFloating()}>
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </Show>
      <Show when={isFloating()}>
        <path d="M8 11V7a4 4 0 0 1 7.5-2" />
      </Show>
    </svg>
  );
};

/** Kebab — Lucide EllipsisVertical. NOT meatballs (horizontal). */
export const KebabIcon: Component = () => (
  <svg {...SVG_PROPS}>
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>
);

/** Size icon — full panel for standard, short panel for compact. Strip mode lives on the minimize button. */
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

/** Warning triangle — Lucide TriangleAlert. Used by StaleAdapterBanner. */
export const WarningIcon: Component = () => (
  <svg {...SVG_PROPS}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
