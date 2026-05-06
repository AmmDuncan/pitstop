import type { PendingQuestion as PendingQuestionType } from "@pitstop/shared";
import { type Component, For, Show, createSignal, onMount } from "solid-js";
import { submitResponse } from "../state/client";
import { floatingLeft, floatingTop, position, setFloatingLeft, setFloatingTop } from "../state/modes";
import { flagSent, session, setSubmitState } from "../state/store";

type Props = {
  question: PendingQuestionType;
};

const VIEWPORT_MARGIN = 24;

/** Banner that replaces the action area when the agent has called `ask_user`.
 *  Renders the question text, any preset option buttons, and a free-form
 *  fallback. Submitting any answer clears the question (server-side) and the
 *  banner unmounts. */
export const PendingQuestion: Component<Props> = (props) => {
  const [submitting, setSubmitting] = createSignal(false);
  const [freeform, setFreeform] = createSignal(false);
  const [text, setText] = createSignal("");
  let sectionRef: HTMLElement | undefined;

  // On mount: (1) if the floating drawer is partially off-screen — user
  // dragged it past the viewport — nudge it back into view; scrollIntoView
  // can't help there because the drawer is position:fixed, not in the page
  // scroll flow. (2) Then scroll the question banner to the top of the
  // detail-scroll container so the FULL question is visible, not just the
  // bottom of the banner.
  onMount(() => {
    if (position() === "floating" && sectionRef) {
      const drawer = sectionRef.closest(".drawer") as HTMLElement | null;
      if (drawer) {
        const rect = drawer.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (rect.bottom > vh - VIEWPORT_MARGIN) {
          setFloatingTop(Math.max(0, vh - rect.height - VIEWPORT_MARGIN));
        }
        if (rect.right > vw - VIEWPORT_MARGIN) {
          setFloatingLeft(Math.max(0, vw - rect.width - VIEWPORT_MARGIN));
        }
        if (rect.top < VIEWPORT_MARGIN) setFloatingTop(VIEWPORT_MARGIN);
        if (rect.left < VIEWPORT_MARGIN) setFloatingLeft(VIEWPORT_MARGIN);
      }
    }
    if (sectionRef) {
      sectionRef.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    // Read the floating signals so Solid tracks them — keeps lint happy and
    // lets future reactive flows pick up changes if they care.
    void floatingLeft();
    void floatingTop();
  });

  const submit = async (answer: string) => {
    if (!session.s) return;
    setSubmitting(true);
    setSubmitState("sending");
    try {
      await submitResponse(session.s.id, {
        itemId: props.question.itemId ?? session.s.items[0]?.id ?? "",
        kind: "answer",
        body: answer,
        questionText: props.question.question,
      });
      flagSent();
    } catch {
      setSubmitState("idle");
    } finally {
      setSubmitting(false);
    }
  };

  const onFreeformSubmit = (e: Event) => {
    e.preventDefault();
    const t = text().trim();
    if (!t) return;
    submit(t);
  };

  return (
    <section class="pq is-fresh" aria-live="assertive" ref={sectionRef}>
      <header class="pq-eyebrow">
        <span class="pq-icon" aria-hidden="true">
          ?
        </span>
        CLAUDE_NEEDS_INPUT
      </header>
      <p class="pq-text">{props.question.question}</p>
      <Show when={props.question.options.length}>
        <div class="pq-options" role="radiogroup" aria-label="Preset answers">
          <For each={props.question.options}>
            {(opt) => (
              <button
                type="button"
                class="pq-opt"
                disabled={submitting()}
                onClick={() => submit(opt.label)}
                title={opt.description ?? opt.label}
              >
                <span class="pq-opt-label">{opt.label}</span>
                <Show when={opt.description}>
                  <span class="pq-opt-desc">{opt.description}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show
        when={!freeform()}
        fallback={
          <form class="pq-freeform" onSubmit={onFreeformSubmit}>
            <textarea
              class="cbox"
              placeholder="Type your answer · ⌘↵ to send"
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.metaKey && e.key === "Enter") {
                  e.preventDefault();
                  onFreeformSubmit(e);
                }
                e.stopPropagation();
              }}
              autofocus
              disabled={submitting()}
            />
            <button type="submit" class="btn btn-primary pq-send" disabled={submitting() || !text().trim()}>
              SEND_ANSWER <span class="kbd">⌘↵</span>
            </button>
          </form>
        }
      >
        <button type="button" class="pq-other" disabled={submitting()} onClick={() => setFreeform(true)}>
          {props.question.options.length ? "Type a different answer ↓" : "Type your answer ↓"}
        </button>
      </Show>
    </section>
  );
};
