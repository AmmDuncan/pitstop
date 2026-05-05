import { createEffect, createRoot, createSignal } from "solid-js";

type Position = "right" | "left" | "floating";
type Side = "right" | "left";
type Size = "standard" | "compact" | "strip";
export type Theme = "dark" | "light";

const KEY = "pitstop.modes.v1";

type Modes = {
  position: Position;
  /** Dock preference, used when un-floating. Always tracked even while floating. */
  side: Side;
  size: Size;
  width: number;
  height: number;
  floatingTop: number;
  floatingLeft: number;
  theme: Theme;
};

function systemTheme(): Theme {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

const DEFAULTS: Modes = {
  position: "right",
  side: "right",
  size: "standard",
  width: 504,
  height: 600,
  floatingTop: 80,
  floatingLeft: 80,
  theme: "dark",
};

function load(): Modes {
  const fresh: Modes = { ...DEFAULTS, theme: systemTheme() };
  if (typeof localStorage === "undefined") return fresh;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<Modes> & { theme?: string };
    // Pre-v0.3.27 'auto' migrates to whatever the system prefers right now,
    // then sticks (the user can flip later).
    const theme: Theme = parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : systemTheme();
    // `side` is new in v0.3.27. If absent, derive from position so legacy users
    // who docked left still un-float to left.
    const side: Side =
      parsed.side === "left" || parsed.side === "right"
        ? parsed.side
        : parsed.position === "left"
          ? "left"
          : "right";
    return { ...fresh, ...parsed, theme, side };
  } catch {}
  return fresh;
}

const initial = load();
export const [position, setPosition] = createSignal<Position>(initial.position);
export const [side, setSide] = createSignal<Side>(initial.side);
export const [size, setSize] = createSignal<Size>(initial.size);
export const [width, setWidth] = createSignal(initial.width);
export const [height, setHeight] = createSignal(initial.height);
export const [floatingTop, setFloatingTop] = createSignal(initial.floatingTop);
export const [floatingLeft, setFloatingLeft] = createSignal(initial.floatingLeft);
export const [theme, setTheme] = createSignal<Theme>(initial.theme);

/** True while the user is actively dragging the floating drawer or pulling a
 *  resize handle. Drawer.tsx adds a `resizing` class while this is true so
 *  CSS can suppress the width/height transition (otherwise every pixel-
 *  level pointer delta lerps over 220ms and the drag feels laggy). */
export const [interactiveResize, setInteractiveResize] = createSignal(false);

createRoot(() => {
  createEffect(() => {
    const m: Modes = {
      position: position(),
      side: side(),
      size: size(),
      width: width(),
      height: height(),
      floatingTop: floatingTop(),
      floatingLeft: floatingLeft(),
      theme: theme(),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(m));
    } catch {}
  });

  // Expose the drawer's current width on :root as --pitstop-drawer-width.
  // Always set, regardless of pinned/floating state — host pages can read it
  // if they want to know how much screen pitstop is occupying. This was the
  // anchor point for the v0.3.27–v0.3.35 reflow mode (host opt-in via
  // `right: var(--pitstop-drawer-width, 0)` on slideovers etc.); reflow itself
  // was retired in v0.3.36 because of layout-citizen issues, but the var
  // stays exposed in case reflow ever comes back or hosts find other uses.
  if (typeof document !== "undefined") {
    // One-time cleanup for users upgrading from v0.3.35 or earlier with
    // reflow on — strip any stale body/html padding their last session left.
    document.documentElement.style.removeProperty("padding-left");
    document.documentElement.style.removeProperty("padding-right");
    document.body.style.removeProperty("padding-left");
    document.body.style.removeProperty("padding-right");
  }
  createEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--pitstop-drawer-width", `${width()}px`);
  });
});


/**
 * Flip the dock side (right ↔ left).
 * While pinned, also moves the drawer to the new side immediately.
 * While floating, only updates the stored preference — the drawer stays
 * floating but will dock to the new side next time it un-floats.
 */
export function togglePinSide() {
  const next: Side = side() === "right" ? "left" : "right";
  setSide(next);
  if (position() !== "floating") setPosition(next);
}

/**
 * Toggle floating ↔ pinned.
 * Floating → pinned docks to the current `side` preference.
 * Pinned → floating remembers the current side first so un-floating returns there.
 */
export function toggleFloat() {
  const p = position();
  if (p === "floating") {
    setPosition(side());
    return;
  }
  setSide(p);
  setPosition("floating");
}

/**
 * Binary toggle between `standard` and `compact`. `strip` is reached only via
 * the dedicated minimize button or the empty-state collapse — keeping it out
 * of the cycle means the size button can't strand the user in a mode where
 * it's no longer visible.
 */
export function toggleSize() {
  setSize(size() === "standard" ? "compact" : "standard");
}

export function toggleTheme() {
  setTheme(theme() === "dark" ? "light" : "dark");
}
