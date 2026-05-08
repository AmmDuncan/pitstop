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
  // Idle-by-default: with no active session the drawer is a thin strip. When a
  // session arrives we ephemerally lift to standard via setAutoExpanded so the
  // user sees the items without their persisted preference being overwritten.
  // Existing users keep whatever they previously persisted.
  size: "strip",
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

// `persistedSize` is what the user explicitly chose; `size()` is what the
// drawer renders. They diverge only while `autoExpanded` is true — i.e. a
// session arrived while the user was in `strip` and we lifted the display
// to `standard` for the duration of that session without touching localStorage.
const [persistedSize, setPersistedSize] = createSignal<Size>(initial.size);
const [autoExpanded, setAutoExpanded] = createSignal(false);
/** Currently displayed size. Lifts strip→standard while a session is active. */
export const size = (): Size =>
  autoExpanded() && persistedSize() === "strip" ? "standard" : persistedSize();
/** Explicit size change. Clears any auto-expansion override and persists. */
export function setSize(s: Size): void {
  setAutoExpanded(false);
  setPersistedSize(s);
}
/** App.tsx calls this when a session arrives — lift strip to standard ephemerally. */
export function liftIfStrip(): void {
  if (persistedSize() === "strip") setAutoExpanded(true);
}
/** App.tsx calls this when the session ends — fall back to the persisted preference. */
export function clearAutoExpand(): void {
  setAutoExpanded(false);
}

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
  // Collapse rapid signal changes (e.g. floatingTop/floatingLeft on every
  // pointermove during a drag) into one localStorage write per frame. Without
  // this, a fast drag could fire 60+ synchronous setItem calls per second on
  // the main thread. The latest snapshot wins regardless of when the rAF
  // callback fires.
  let pendingWrite: number | null = null;
  let latestSnapshot: Modes | null = null;
  createEffect(() => {
    latestSnapshot = {
      position: position(),
      side: side(),
      // Persist the user's explicit preference, NOT the auto-expanded display
      // size — otherwise the strip-by-default behavior gets clobbered the
      // first time a session lifts the drawer.
      size: persistedSize(),
      width: width(),
      height: height(),
      floatingTop: floatingTop(),
      floatingLeft: floatingLeft(),
      theme: theme(),
    };
    if (pendingWrite !== null) return;
    pendingWrite = requestAnimationFrame(() => {
      pendingWrite = null;
      if (!latestSnapshot) return;
      try {
        localStorage.setItem(KEY, JSON.stringify(latestSnapshot));
      } catch {}
    });
  });

  // One-time cleanup for users upgrading from v0.3.35 or earlier with the
  // retired reflow mode on — strip any stale body/html padding their last
  // session left. removeProperty on a non-existent property is a no-op DOM
  // mutation, so it's safe to run pre-hydration without tripping React.
  if (typeof document !== "undefined") {
    document.documentElement.style.removeProperty("padding-left");
    document.documentElement.style.removeProperty("padding-right");
    document.body.style.removeProperty("padding-left");
    document.body.style.removeProperty("padding-right");
  }
  // The previous `--pitstop-drawer-width` var on :root was removed in
  // v0.3.67 — Next 15 flagged it as a hydration mismatch (the Solid effect
  // mutated <html>'s style attribute *after* React had hydrated). It was
  // an anchor point for the retired v0.3.36 reflow feature and had no
  // current consumers. If a host ever needs the width again, expose it on
  // the `<pitstop-drawer>` custom element instead — that element is not
  // SSR'd so mutations on it can't conflict with framework hydration.
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
