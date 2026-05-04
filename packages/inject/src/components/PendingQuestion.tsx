import { type Component, For, Show, createSignal } from 'solid-js';
import type { PendingQuestion as PendingQuestionType } from '@pitstop/shared';
import { session, setSubmitState, flagSent } from '../state/store';
import { submitResponse } from '../state/client';

type Props = {
  question: PendingQuestionType;
};

/** Banner that replaces the action area when the agent has called `ask_user`.
 *  Renders the question text, any preset option buttons, and a free-form
 *  fallback. Submitting any answer clears the question (server-side) and the
 *  banner unmounts. */
export const PendingQuestion: Component<Props> = (props) => {
  const [submitting, setSubmitting] = createSignal(false);
  const [freeform, setFreeform] = createSignal(false);
  const [text, setText] = createSignal('');

  const submit = async (answer: string) => {
    if (!session.s) return;
    setSubmitting(true);
    setSubmitState('sending');
    try {
      await submitResponse(session.s.id, {
        itemId: props.question.itemId ?? session.s.items[0]?.id ?? '',
        kind: 'answer',
        body: answer,
        questionText: props.question.question,
      });
      flagSent();
    } catch {
      setSubmitState('idle');
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
    <section class="pq is-fresh" aria-live="assertive">
      <header class="pq-eyebrow">
        <span class="pq-icon" aria-hidden="true">?</span>
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
                if (e.metaKey && e.key === 'Enter') {
                  e.preventDefault();
                  onFreeformSubmit(e);
                }
                e.stopPropagation();
              }}
              autofocus
              disabled={submitting()}
            />
            <button
              type="submit"
              class="btn btn-primary pq-send"
              disabled={submitting() || !text().trim()}
            >
              SEND_ANSWER <span class="kbd">⌘↵</span>
            </button>
          </form>
        }
      >
        <button
          type="button"
          class="pq-other"
          disabled={submitting()}
          onClick={() => setFreeform(true)}
        >
          {props.question.options.length ? 'Type a different answer ↓' : 'Type your answer ↓'}
        </button>
      </Show>
    </section>
  );
};
