import { createSignal, createEffect, createRoot } from 'solid-js';

type Position = 'right' | 'left' | 'floating';
type Size = 'standard' | 'compact' | 'strip';
export type Theme = 'auto' | 'dark' | 'light';

const KEY = 'pitstop.modes.v1';

type Modes = {
  position: Position;
  size: Size;
  width: number;
  height: number;
  floatingTop: number;
  floatingLeft: number;
  theme: Theme;
};

const DEFAULTS: Modes = {
  position: 'right',
  size: 'standard',
  width: 504,
  height: 600,
  floatingTop: 80,
  floatingLeft: 80,
  theme: 'auto',
};

function load(): Modes {
  if (typeof localStorage === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULTS;
}

const initial = load();
export const [position, setPosition] = createSignal<Position>(initial.position);
export const [size, setSize] = createSignal<Size>(initial.size);
export const [width, setWidth] = createSignal(initial.width);
export const [height, setHeight] = createSignal(initial.height);
export const [floatingTop, setFloatingTop] = createSignal(initial.floatingTop);
export const [floatingLeft, setFloatingLeft] = createSignal(initial.floatingLeft);
export const [theme, setTheme] = createSignal<Theme>(initial.theme);

createRoot(() => {
  createEffect(() => {
    const m: Modes = {
      position: position(),
      size: size(),
      width: width(),
      height: height(),
      floatingTop: floatingTop(),
      floatingLeft: floatingLeft(),
      theme: theme(),
    };
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch {}
  });
});

const POSITIONS: Position[] = ['right', 'left', 'floating'];
const SIZES: Size[] = ['standard', 'compact', 'strip'];

export function cyclePosition() {
  const i = POSITIONS.indexOf(position());
  setPosition(POSITIONS[(i + 1) % POSITIONS.length]!);
}

export function cycleSize() {
  const i = SIZES.indexOf(size());
  setSize(SIZES[(i + 1) % SIZES.length]!);
}

const THEMES: Theme[] = ['auto', 'dark', 'light'];

export function cycleTheme() {
  const i = THEMES.indexOf(theme());
  setTheme(THEMES[(i + 1) % THEMES.length]!);
}

/** Resolved theme — derives 'dark' or 'light' from theme() + system preference when 'auto'. */
export function resolvedTheme(): 'dark' | 'light' {
  const t = theme();
  if (t === 'dark') return 'dark';
  if (t === 'light') return 'light';
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}
