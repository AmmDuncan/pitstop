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
  /** When true and pinned, host page reflows around the drawer (body padding).
   *  When false (default), drawer overlays the page. Has no effect while floating. */
  reflow: boolean;
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
  reflow: false,
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
    const reflow = parsed.reflow === true;
    return { ...fresh, ...parsed, theme, side, reflow };
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
export const [reflow, setReflow] = createSignal<boolean>(initial.reflow);

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
      reflow: reflow(),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(m));
    } catch {}
  });

  // Reflow effect: when pinned + reflow on, push host-page padding on the
  // <html> element so the page visibly narrows by the drawer's width. The
  // body adapts naturally — padding both <html> AND <body> would double-count,
  // squeezing host content to half its intended width whenever the body has
  // its own max-width / margin: 0 auto layout. The CSS var is always exposed
  // on :root so host apps can anchor sticky/fixed elements to it even when
  // reflow is off (selective opt-in). Floating + strip clear the padding.
  // We always clear body inline padding too in case a previous build left it
  // stale on the page.
  createEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const body = document.body;
    const w = `${width()}px`;
    root.style.setProperty("--pitstop-drawer-width", w);
    body.style.removeProperty("padding-left");
    body.style.removeProperty("padding-right");

    const pinned = position() !== "floating";
    const stripped = size() === "strip";
    const active = pinned && reflow() && !stripped;

    if (!active) {
      root.style.removeProperty("padding-left");
      root.style.removeProperty("padding-right");
      return;
    }

    if (position() === "right") {
      root.style.setProperty("padding-right", "var(--pitstop-drawer-width)");
      root.style.removeProperty("padding-left");
    } else {
      root.style.setProperty("padding-left", "var(--pitstop-drawer-width)");
      root.style.removeProperty("padding-right");
    }
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

/**
 * Toggle reflow mode. Has visible effect only while pinned — flipping it while
 * floating updates the pref so docking later reflects the choice.
 */
export function toggleReflow() {
  setReflow(!reflow());
}
