import { type Component } from 'solid-js';

type Direction = 'edge-left' | 'edge-right' | 'corner-se' | 'corner-sw' | 'corner-ne' | 'corner-nw';

type Props = {
  direction: Direction;
  onDrag: (dx: number, dy: number) => void;
};

const cursors: Record<Direction, string> = {
  'edge-left': 'ew-resize',
  'edge-right': 'ew-resize',
  'corner-se': 'nwse-resize',
  'corner-sw': 'nesw-resize',
  'corner-ne': 'nesw-resize',
  'corner-nw': 'nwse-resize',
};

/** Resize handle with pointer-event capture. Same shape as the floating-
 *  drawer header drag — mouse* events on `window` could miss the up event
 *  when the cursor left the viewport, leaving the drawer following the
 *  pointer. Pointer capture guarantees the release fires. */
export const ResizeHandle: Component<Props> = (props) => {
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    let lastX = e.clientX;
    let lastY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      props.onDrag(dx, dy);
    };
    const release = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointercancel', release);
      el.removeEventListener('lostpointercapture', release);
      try { el.releasePointerCapture(e.pointerId); } catch {}
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    document.body.style.cursor = cursors[props.direction];
    document.body.style.userSelect = 'none';
  };

  return <div class={`resize-handle ${props.direction}`} onPointerDown={onPointerDown} />;
};
