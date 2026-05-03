import { createSignal, createEffect, createRoot } from 'solid-js';

type Position = 'right' | 'left' | 'floating';
type Size = 'standard' | 'compact' | 'strip';

const KEY = 'walkthrough.modes.v1';

type Modes = { position: Position; size: Size; width: number; floatingTop: number; floatingLeft: number };

const DEFAULTS: Modes = { position: 'right', size: 'standard', width: 504, floatingTop: 80, floatingLeft: 80 };

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
export const [floatingTop, setFloatingTop] = createSignal(initial.floatingTop);
export const [floatingLeft, setFloatingLeft] = createSignal(initial.floatingLeft);

createRoot(() => {
  createEffect(() => {
    const m: Modes = {
      position: position(),
      size: size(),
      width: width(),
      floatingTop: floatingTop(),
      floatingLeft: floatingLeft(),
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
