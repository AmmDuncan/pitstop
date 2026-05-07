import type { Attachment } from "@pitstop/shared";
import { marked } from "marked";
import { type Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { baseUrl, submitResponse } from "../state/client";
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
  submitState,
  unreviewedIndices,
} from "../state/store";
import { FileRef } from "./FileRef";
import { ImageAttachment } from "./ImageAttachment";
import { PendingQuestion } from "./PendingQuestion";

export const Detail: Component = () => {
  const item = () => session.s?.items[currentItemIdx()];
  const itemId = () => item()?.id ?? "";
  const comment = () => getDraft(itemId());

  /** Scroll the detail body. Pass `"bottom"` to land on the action area /
   *  lifecycle strip after submit; pass `0` to land on the item title for
   *  navigation. Schedules through rAF so multiple effects in the same
   *  reactive tick collapse to the last `scrollTo` call (last write wins —
   *  used intentionally to let scroll-to-top override scroll-to-bottom on
   *  item-change submits). */
  const scrollDetailTo = (target: number | "bottom") => {
    requestAnimationFrame(() => {
      const host = document.querySelector("pitstop-drawer") as unknown as {
        shadowRoot: ShadowRoot | null;
      } | null;
      const scroll = host?.shadowRoot?.querySelector(".detail-scroll");
      if (!scroll) return;
      const top = target === "bottom" ? scroll.scrollHeight : target;
      scroll.scrollTo({ top, behavior: "smooth" });
    });
  };

  // When the user submits (via mouse or keyboard), the action area is
  // replaced by a status strip. If they were scrolled up reading the item
  // body, the strip lands off-screen and they get no visual confirmation.
  // Scroll the detail-scroll container to its bottom so the strip is in view.
  let prevSubmitState: "idle" | "sending" | "poked" = "idle";
  createEffect(() => {
    const ss = submitState();
    if (prevSubmitState === "idle" && (ss === "sending" || ss === "poked")) {
      scrollDetailTo("bottom");
    }
    prevSubmitState = ss;
  });
  const [submitting, setSubmitting] = createSignal(false);

  // Lifecycle strip "elapsed time + POKE button" — shows the user how long the
  // strip has been up and lets them re-engage Claude when it seems stuck. The
  // POKE button calls /retry-poke; the daemon adapts the context to the
  // pending state (unread comments vs user-initiated nudge).
  // An item is "addressed" only if the agent has marked-addressing it with
  // arrived:true AFTER the user's most recent comment on it. Without this
  // recency check, the buttons reappear (and the AWAITING CLAUDE strip
  // disappears) the moment the user comments, because the agent's ORIGINAL
  // arrival narration is still sitting in agentActivity. With it, every
  // comment puts the item back into "needs re-addressing" until the agent
  // calls mark_addressing(arrived:true) again — the only signal that
  // genuinely means "ready, re-check this surface."
  // Memoized — read by stripState() which is itself read multiple times per
  // render (Show conditions, the strip-resolve effect). Without the memo,
  // every reactive read re-filters and reduces both responses and
  // agentActivity for the current item.
  const itemAddressed = createMemo(() => {
    const id = item()?.id;
    if (!id) return false;
    const responses = session.s?.responses ?? [];
    const lastUserCommentAt = responses
      .filter((r) => r.itemId === id && r.kind === "comment")
      .reduce((max, r) => (r.at > max ? r.at : max), 0);
    return (session.s?.agentActivity ?? []).some(
      (e) =>
        e.tool === "mark_addressing" && e.itemId === id && e.arrived !== false && e.at > lastUserCommentAt,
    );
  });
  const stripState = () => {
    if (submitState() === "sending") return { kind: "sending", label: "SENDING…" };
    if (submitState() === "poked") return { kind: "poked", label: "POKED · WAITING" };
    if (!itemAddressed()) return { kind: "awaiting", label: "AWAITING CLAUDE" };
    return null;
  };

  // When the lifecycle strip resolves back into the action buttons, the
  // buttons land at the bottom of detail-scroll. If the AgentFeed grew
  // while the strip was up (new narrations came in), the buttons can sit
  // below the visible area — same problem the send-side scroll-to-bottom
  // solves, just on the reverse transition. Mirror the same fix here.
  let prevStripKind: string | null = null;
  createEffect(() => {
    const cur = stripState()?.kind ?? null;
    if (prevStripKind && !cur) scrollDetailTo("bottom");
    prevStripKind = cur;
  });

  // Navigation to a new item — agent's set_current_item, user's j/k, pip
  // click, auto-advance after LOOKS_GOOD — should land the user at the top
  // of the new item's content so they can read from the title down. If the
  // submit-side scroll-to-bottom would otherwise fire from the same advance
  // (LOOKS_GOOD → submitState=poked → scroll-to-bottom; setCurrentItemIdx
  // → scroll-to-top), this effect's rAF callback runs in the same frame,
  // and `scroll.scrollTo` is "set" semantics: the last call wins. So we
  // implicitly favor scroll-to-top, which is the right priority — reading
  // content beats seeing the action affordance.
  let prevItemIdx = currentItemIdx();
  createEffect(() => {
    const idx = currentItemIdx();
    if (idx !== prevItemIdx) {
      prevItemIdx = idx;
      scrollDetailTo(0);
    }
  });

  const [stripStartedAt, setStripStartedAt] = createSignal<number | null>(null);
  const [now, setNow] = createSignal(Date.now());
  let lastStripKind: string | null = null;
  createEffect(() => {
    const ss = stripState();
    const kind = ss?.kind ?? null;
    if (kind !== lastStripKind) {
      lastStripKind = kind;
      setStripStartedAt(kind ? Date.now() : null);
    }
  });
  let tick: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    if (stripState() && !tick) {
      tick = setInterval(() => setNow(Date.now()), 1000);
    } else if (!stripState() && tick) {
      clearInterval(tick);
      tick = null;
    }
  });
  onCleanup(() => {
    if (tick) clearInterval(tick);
  });
  const elapsedFormatted = () => {
    const start = stripStartedAt();
    if (!start) return "";
    const s = Math.max(0, Math.floor((now() - start) / 1000));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}:${String(ss).padStart(2, "0")}`;
  };
  const [poking, setPoking] = createSignal(false);
  const [pokeError, setPokeError] = createSignal<string | null>(null);
  const onPoke = async () => {
    if (!session.s || poking()) return;
    setPoking(true);
    setPokeError(null);
    try {
      const r = await fetch(`${baseUrl}/api/sessions/${session.s.id}/retry-poke`, { method: "POST" });
      if (r.ok) {
        // Show "POKED · WAITING" strip with the elapsed counter so the user
        // sees the click landed; the strip transitions back to AWAITING
        // CLAUDE on the next agent-activity event (the daemon's listener
        // already handles that). Plus keep the button disabled for ~5s so
        // spamming doesn't stack pokes — claude --resume only takes one at
        // a time anyway, and the second-and-after attempts 409 silently.
        flagSent();
        setTimeout(() => setPoking(false), 5000);
        return;
      }
      // Surface the daemon's error inline. Pre-v0.3.43 we silently swallowed
      // non-2xx responses, which made bugs like NO_CLIENT_SESSION_ID
      // (env-var-name regression) invisible from the UI.
      const body = await r.json().catch(() => ({}) as { error?: string });
      setPokeError(body.error ? `POKE_FAILED · ${body.error}` : `POKE_FAILED · HTTP ${r.status}`);
      setTimeout(() => setPokeError(null), 6000);
    } catch (err) {
      console.error("poke failed", err);
      setPokeError("POKE_FAILED · network error");
      setTimeout(() => setPokeError(null), 6000);
    }
    setPoking(false);
  };

  const onApprove = async () => {
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
      setSubmitState("idle");
    } finally {
      setSubmitting(false);
    }
  };

  const onComment = async () => {
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
          {(att) => <FileRef att={att as any} />}
        </For>
        <For each={item()!.attachments.filter((a) => a.kind === "image")}>
          {(att) => <ImageAttachment att={att as Extract<Attachment, { kind: "image" }>} />}
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
        </Show>
        {(() => {
          // Render priority for the action area:
          //   1. PendingQuestion (ask_user is the agent's active prompt)
          //   2. Lifecycle strip (sending / poked / awaiting Claude)
          //   3. Action buttons (LOOKS_GOOD / SEND_COMMENT)
          // Each subsumes the one below it — no two of these stack.
          const pending = () => session.s?.pendingQuestion ?? null;
          return (
            <Show when={!pending()} fallback={<PendingQuestion question={pending()!} />}>
              <Show
                when={!stripState()}
                fallback={
                  <>
                    <div class="lifecycle-strip" data-state={stripState()!.kind}>
                      <span class="lifecycle-dot" />
                      <span class="lifecycle-label">{stripState()!.label}</span>
                      {/* Elapsed counter on poked + awaiting; sending is too brief to show. */}
                      <Show when={stripState()!.kind !== "sending"}>
                        <span class="lifecycle-elapsed">{elapsedFormatted()}</span>
                      </Show>
                      {/* POKE only on AWAITING — re-poking during POKED is a no-op
                          (daemon 409s the second /retry-poke while one's in flight)
                          and confused users into clicking a button that did nothing. */}
                      <Show when={stripState()!.kind === "awaiting"}>
                        <button
                          class="lifecycle-poke"
                          onClick={onPoke}
                          disabled={poking()}
                          title="Poke Claude — re-engage if it seems stuck"
                        >
                          POKE
                        </button>
                      </Show>
                    </div>
                    <Show when={pokeError()}>
                      <div class="lifecycle-error" role="alert">
                        {pokeError()}
                      </div>
                    </Show>
                  </>
                }
              >
                <Show when={session.s?.status !== "complete"}>
                  <div class="actions">
                    <button class="btn btn-primary" onClick={onApprove} disabled={submitting()}>
                      LOOKS_GOOD <span class="kbd">↵</span>
                    </button>
                    <button
                      class="btn btn-secondary"
                      onClick={onComment}
                      disabled={submitting() || !comment().trim()}
                    >
                      SEND_COMMENT <span class="kbd">⌘↵</span>
                    </button>
                  </div>
                </Show>
              </Show>
            </Show>
          );
        })()}
      </div>
    </Show>
  );
};
