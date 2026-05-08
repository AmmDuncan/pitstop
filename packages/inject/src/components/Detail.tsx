import type { Attachment } from "@pitstop/shared";
import { marked } from "marked";
import { type Component, For, Show, createEffect, createSignal } from "solid-js";
import { submitResponse } from "../state/client";
import { stripState } from "../state/lifecycle";
import {
  clearDraft,
  currentItemIdx,
  flagSent,
  getDraft,
  session,
  setCurrentItemIdx,
  setDraft,
  setSubmitState,
  setSummaryOpen,
  unreviewedIndices,
} from "../state/store";
import { FileRef } from "./FileRef";
import { ImageAttachment } from "./ImageAttachment";
import { PendingQuestion } from "./PendingQuestion";

/**
 * Renders the active item — content (eyebrow, title, body, lookFor, concerns,
 * attachments, question line), the comment textarea, and the action buttons.
 * Scrolls to top whenever the active item changes so the reader lands on the
 * title.
 *
 * v0.3.58 lift: the LIFECYCLE STRIP no longer renders here. It lives at
 * drawer level (between AgentFeed and Footer) so the status survives
 * auto-advance. The textarea + buttons stay in Detail's normal flow — the
 * lift is just for the strip, not for the actions.
 */
export const Detail: Component = () => {
  const item = () => session.s?.items[currentItemIdx()];
  const itemId = () => item()?.id ?? "";
  const comment = () => getDraft(itemId());
  const [submitting, setSubmitting] = createSignal(false);

  // On item change, land the user at the top of the new item's content.
  let prevItemIdx = currentItemIdx();
  createEffect(() => {
    const idx = currentItemIdx();
    if (idx !== prevItemIdx) {
      prevItemIdx = idx;
      requestAnimationFrame(() => {
        const host = document.querySelector("pitstop-drawer") as unknown as {
          shadowRoot: ShadowRoot | null;
        } | null;
        const scroll = host?.shadowRoot?.querySelector(".detail-scroll");
        scroll?.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
  });

  const onApprove = async (): Promise<void> => {
    const it = item();
    if (!it || !session.s) return;
    setSubmitting(true);
    setSubmitState("sending");
    try {
      await submitResponse(session.s.id, { itemId: it.id, kind: "approve" });
      flagSent();
      const total = session.s.items.length;
      const wasLast = currentItemIdx() === total - 1;
      if (wasLast) {
        const stillSkipped = unreviewedIndices().filter((i) => i !== currentItemIdx());
        if (stillSkipped.length > 0) setSummaryOpen(true);
        return;
      }
      setCurrentItemIdx(Math.min(total - 1, currentItemIdx() + 1));
    } catch {
      setSubmitState("idle");
    } finally {
      setSubmitting(false);
    }
  };

  const onComment = async (): Promise<void> => {
    const it = item();
    if (!it || !session.s || !comment().trim()) return;
    setSubmitting(true);
    setSubmitState("sending");
    try {
      await submitResponse(session.s.id, { itemId: it.id, kind: "comment", body: comment().trim() });
      clearDraft(it.id);
      flagSent();
    } catch {
      setSubmitState("idle");
    } finally {
      setSubmitting(false);
    }
  };

  const pending = () => session.s?.pendingQuestion ?? null;
  // While the strip is up (sending / poked / awaiting), LOOKS_GOOD is disabled
  // — agent's processing the prior comment, premature-approving would
  // short-circuit. SEND_COMMENT stays available so the user can pile on more
  // feedback. Read stripState reactively from the drawer-level lifecycle module.
  const stripActive = () => !!stripState();

  return (
    <Show when={item()} fallback={<div class="detail-scroll">No items.</div>}>
      <div class="detail-scroll">
        <div class="detail-eyebrow">
          ITEM_{item()!.id} <span class="sep">/</span> {String(session.s?.items.length ?? 0).padStart(2, "0")}
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
        <For each={item()!.attachments.filter((a) => a.kind === "file-ref")}>
          {(att) => <FileRef att={att as Attachment & { kind: "file-ref" }} />}
        </For>
        <For each={item()!.attachments.filter((a) => a.kind === "image")}>
          {(att) => <ImageAttachment att={att as Extract<Attachment, { kind: "image" }>} />}
        </For>
        <Show when={item()!.question && !pending()}>
          <div class="qline">{item()!.question}</div>
        </Show>
        <Show when={!pending()} fallback={<PendingQuestion question={pending()!} />}>
          <textarea
            class="cbox"
            placeholder="optional comment · press C to focus · ⌘↵ to send"
            value={comment()}
            onInput={(e) => setDraft(itemId(), e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.metaKey && e.key === "Enter") {
                e.preventDefault();
                onComment();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              e.stopPropagation();
            }}
            disabled={submitting()}
          />
          <Show when={session.s?.status !== "complete"}>
            <div class="actions">
              <button
                type="button"
                class="btn btn-primary"
                onClick={onApprove}
                disabled={submitting() || stripActive()}
                title={
                  stripActive()
                    ? "Agent is addressing your comment — wait for it to land, or send another comment."
                    : undefined
                }
              >
                LOOKS_GOOD <span class="kbd">↵</span>
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                onClick={onComment}
                disabled={submitting() || !comment().trim()}
              >
                SEND_COMMENT <span class="kbd">⌘↵</span>
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  );
};
