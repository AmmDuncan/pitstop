import { type Component, createSignal, Show } from 'solid-js';
import type { Attachment } from '@pitstop/shared';
import { Lightbox } from './Lightbox';

type ImageAtt = Extract<Attachment, { kind: 'image' }>;

export const ImageAttachment: Component<{ att: ImageAtt }> = (props) => {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <figure class="img-attach" onClick={() => setOpen(true)}>
        <img src={props.att.src} alt={props.att.caption ?? ''} loading="lazy" />
        <Show when={props.att.caption}>
          <figcaption class="img-caption">{props.att.caption}</figcaption>
        </Show>
      </figure>
      <Show when={open()}>
        <Lightbox src={props.att.src} caption={props.att.caption} onClose={() => setOpen(false)} />
      </Show>
    </>
  );
};
