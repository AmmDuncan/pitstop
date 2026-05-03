import { type Component, createSignal, For, Show } from 'solid-js';
import { marked } from 'marked';
import { session, currentItemIdx, setCurrentItemIdx } from '../state/store';
import { submitResponse } from '../state/client';
import { FileRef } from './FileRef';

export const Detail: Component = () => {
  const item = () => session.s?.items[currentItemIdx()];
  const [comment, setComment] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);

  const onApprove = async () => {
    const it = item();
    if (!it || !session.s) return;
    setSubmitting(true);
    try {
      await submitResponse(session.s.id, { itemId: it.id, kind: 'approve' });
      // Local auto-advance
      const next = Math.min(((session.s?.items.length ?? 1) - 1), currentItemIdx() + 1);
      setCurrentItemIdx(next);
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
      setComment('');
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
        <Show when={item()!.question}>
          <div class="qline">{item()!.question}</div>
        </Show>
        <textarea
          class="cbox"
          placeholder="optional comment · leave blank if it's good as-is"
          value={comment()}
          onInput={(e) => setComment(e.currentTarget.value)}
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
