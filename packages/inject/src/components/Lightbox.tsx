import { type Component, onMount, onCleanup } from 'solid-js';

export const Lightbox: Component<{ src: string; caption?: string; onClose: () => void }> = (props) => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
  };
  onMount(() => window.addEventListener('keydown', onKey));
  onCleanup(() => window.removeEventListener('keydown', onKey));

  return (
    <div class="lightbox-overlay" onClick={props.onClose}>
      <div class="lightbox-frame" onClick={(e) => e.stopPropagation()}>
        <img class="lightbox-img" src={props.src} alt={props.caption ?? ''} />
        {props.caption && <div class="lightbox-caption">{props.caption}</div>}
        <button class="lightbox-close" onClick={props.onClose}>× ESC</button>
      </div>
    </div>
  );
};
