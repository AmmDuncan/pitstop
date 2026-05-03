import { type Component, createSignal, For, Show } from 'solid-js';
import { marked } from 'marked';
import {
  session,
  currentItemIdx,
  setCurrentItemIdx,
  setSummaryOpen,
  unreviewedIndices,
  getDraft,
  setDraft,
  clearDraft,
} from '../state/store';
import { submitResponse } from '../state/client';
import { FileRef } from './FileRef';
import { ImageAttachment } from './ImageAttachment';
import type { Attachment } from '@pitstop/shared';

export const Detail: Component = () => {
  const item = () => session.s?.items[currentItemIdx()];
  const itemId = () => item()?.id ?? '';
  const comment = () => getDraft(itemId());
  const [submitting, setSubmitting] = createSignal(false);

  const onApprove = async () => {
    const it = item();
    if (!it || !session.s) return;
    setSubmitting(true);
    try {
      await submitResponse(session.s.id, { itemId: it.id, kind: 'approve' });
      const total = session.s.items.length;
      const wasLast = currentItemIdx() === total - 1;
      if (wasLast) {
        // Did the user skip anything earlier? Open the summary so they can address gaps.
        // Filter the just-approved index in case the response hasn't propagated through the memo yet.
        const stillSkipped = unreviewedIndices().filter((i) => i !== currentItemIdx());
        if (stillSkipped.length > 0) {
          setSummaryOpen(true);
        }
        // No skipped items — stay on the last item; complete_review will flip session.status.
        return;
      }
      setCurrentItemIdx(Math.min(total - 1, currentItemIdx() + 1));
    } finally {
      setSubmitting(false);
    }
  };

  const onComment = async () => {
    const it = item();
    if (!it || !session.s || !comment().trim()) return;
    setSubmitting(true);
    try {
      await submitResponse(session.s.id, { itemId: it.id, kind: 'comment', body: comment().trim() });
      clearDraft(it.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show when={item()} fallback={<div class="detail-scroll">No items.</div>}>
      <div class="detail-scroll">
        <div class="detail-eyebrow">
          ITEM_{item()!.id} <span class="sep">/</span> {String((session.s?.items.length ?? 0)).padStart(2, '0')}
        </div>
        <h2 class="detail-title">{item()!.title}</h2>
        <div class="detail-body" innerHTML={marked.parse(item()!.body) as string} />
        <For each={item()!.attachments.filter((a) => a.kind === 'file-ref')}>
          {(att) => <FileRef att={att as any} />}
        </For>
        <For each={item()!.attachments.filter((a) => a.kind === 'image')}>
          {(att) => <ImageAttachment att={att as Extract<Attachment, { kind: 'image' }>} />}
        </For>
        <Show when={item()!.question}>
          <div class="qline">{item()!.question}</div>
        </Show>
        <textarea
          class="cbox"
          placeholder="optional comment · press C to focus · ⌘↵ to send"
          value={comment()}
          onInput={(e) => setDraft(itemId(), e.currentTarget.value)}
          disabled={submitting()}
        />
        <div class="actions">
          <button class="btn btn-primary" onClick={onApprove} disabled={submitting()}>LOOKS_GOOD <span class="kbd">↵</span></button>
          <button class="btn btn-secondary" onClick={onComment} disabled={submitting() || !comment().trim()}>SEND_COMMENT <span class="kbd">⌘↵</span></button>
        </div>
      </div>
    </Show>
  );
};
