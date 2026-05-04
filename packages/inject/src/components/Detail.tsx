import { type Component, createEffect, createSignal, For, Show } from 'solid-js';
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
  submitState,
  setSubmitState,
  flagSent,
} from '../state/store';
import { submitResponse } from '../state/client';
import { FileRef } from './FileRef';
import { ImageAttachment } from './ImageAttachment';
import { PendingQuestion } from './PendingQuestion';
import type { Attachment } from '@pitstop/shared';

export const Detail: Component = () => {
  const item = () => session.s?.items[currentItemIdx()];
  const itemId = () => item()?.id ?? '';
  const comment = () => getDraft(itemId());

  // When the user submits (via mouse or keyboard), the action area is
  // replaced by a status strip. If they were scrolled up reading the item
  // body, the strip lands off-screen and they get no visual confirmation.
  // Scroll the detail-scroll container to its bottom so the strip is in view.
  let prevSubmitState: 'idle' | 'sending' | 'poked' = 'idle';
  createEffect(() => {
    const ss = submitState();
    if (prevSubmitState === 'idle' && (ss === 'sending' || ss === 'poked')) {
      requestAnimationFrame(() => {
        const host = document.querySelector('pitstop-drawer') as unknown as { shadowRoot: ShadowRoot | null } | null;
        const scroll = host?.shadowRoot?.querySelector('.detail-scroll');
        if (scroll) scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' });
      });
    }
    prevSubmitState = ss;
  });
  const [submitting, setSubmitting] = createSignal(false);

  const onApprove = async () => {
    const it = item();
    if (!it || !session.s) return;
    setSubmitting(true);
    setSubmitState('sending');
    try {
      await submitResponse(session.s.id, { itemId: it.id, kind: 'approve' });
      flagSent();
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
    } catch {
      setSubmitState('idle');
    } finally {
      setSubmitting(false);
    }
  };

  const onComment = async () => {
    const it = item();
    if (!it || !session.s || !comment().trim()) return;
    setSubmitting(true);
    setSubmitState('sending');
    try {
      await submitResponse(session.s.id, { itemId: it.id, kind: 'comment', body: comment().trim() });
      clearDraft(it.id);
      flagSent();
    } catch {
      setSubmitState('idle');
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
        <Show when={item()!.lookFor.length}>
          <section class="detail-list lookfor">
            <h3 class="detail-list-label">LOOK_OUT_FOR</h3>
            <ul>
              <For each={item()!.lookFor}>{(line) => <li>{line}</li>}</For>
            </ul>
          </section>
        </Show>
        <Show when={item()!.concerns.length}>
          <section class="detail-list concerns">
            <h3 class="detail-list-label">KNOWN_CONCERNS</h3>
            <ul>
              <For each={item()!.concerns}>{(line) => <li>{line}</li>}</For>
            </ul>
          </section>
        </Show>
        <For each={item()!.attachments.filter((a) => a.kind === 'file-ref')}>
          {(att) => <FileRef att={att as any} />}
        </For>
        <For each={item()!.attachments.filter((a) => a.kind === 'image')}>
          {(att) => <ImageAttachment att={att as Extract<Attachment, { kind: 'image' }>} />}
        </For>
        <Show when={item()!.question && !session.s?.pendingQuestion}>
          <div class="qline">{item()!.question}</div>
        </Show>
        <Show when={!session.s?.pendingQuestion}>
          <textarea
            class="cbox"
            placeholder="optional comment · press C to focus · ⌘↵ to send"
            value={comment()}
            onInput={(e) => setDraft(itemId(), e.currentTarget.value)}
            onKeyDown={(e) => {
              // Handle textarea shortcuts locally and stop every keydown from
              // bubbling out of the drawer. Letting events leak meant typing
              // letters triggered drawer shortcuts (t flipped the theme, ?
              // opened help) AND Escape closed any open modal in the host app.
              if (e.metaKey && e.key === 'Enter') {
                e.preventDefault();
                onComment();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
              }
              e.stopPropagation();
            }}
            disabled={submitting()}
          />
        </Show>
        {(() => {
          // Render priority for the action area:
          //   1. PendingQuestion (ask_user is the agent's active prompt)
          //   2. Lifecycle strip (sending / poked / awaiting Claude)
          //   3. Action buttons (LOOKS_GOOD / SEND_COMMENT)
          // Each subsumes the one below it — no two of these stack.
          const pending = () => session.s?.pendingQuestion ?? null;
          const itemAddressed = () => {
            const id = item()!.id;
            // Buttons appear once we've seen an `arrived !== false` entry for
            // this item. Mid-drive narrations passed with arrived: false keep
            // the AWAITING CLAUDE strip up.
            return (session.s?.agentActivity ?? []).some(
              (e) => e.tool === 'mark_addressing' && e.itemId === id && e.arrived !== false,
            );
          };
          const stripState = () => {
            if (submitState() === 'sending') return { kind: 'sending', label: 'SENDING…' };
            if (submitState() === 'poked') return { kind: 'poked', label: 'POKED · WAITING' };
            if (!itemAddressed()) return { kind: 'awaiting', label: 'AWAITING CLAUDE' };
            return null;
          };
          return (
            <Show when={!pending()} fallback={<PendingQuestion question={pending()!} />}>
              <Show when={!stripState()} fallback={
                <div class="lifecycle-strip" data-state={stripState()!.kind}>
                  <span class="lifecycle-dot" />
                  <span class="lifecycle-label">{stripState()!.label}</span>
                </div>
              }>
                <div class="actions">
                  <button class="btn btn-primary" onClick={onApprove} disabled={submitting()}>LOOKS_GOOD <span class="kbd">↵</span></button>
                  <button class="btn btn-secondary" onClick={onComment} disabled={submitting() || !comment().trim()}>SEND_COMMENT <span class="kbd">⌘↵</span></button>
                </div>
              </Show>
            </Show>
          );
        })()}
      </div>
    </Show>
  );
};
