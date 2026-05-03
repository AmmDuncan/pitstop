import { type Component, createSignal, onCleanup } from 'solid-js';

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

export const ResizeHandle: Component<Props> = (props) => {
  const [dragging, setDragging] = createSignal(false);
  let lastX = 0;
  let lastY = 0;

  const onMove = (e: MouseEvent) => {
    if (!dragging()) return;
    props.onDrag(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const onUp = () => {
    setDragging(false);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  const onDown = (e: MouseEvent) => {
    setDragging(true);
    lastX = e.clientX;
    lastY = e.clientY;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = cursors[props.direction];
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  onCleanup(() => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  });

  return <div class={`resize-handle ${props.direction}`} onMouseDown={onDown} />;
};
