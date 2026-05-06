import type { Item } from "@pitstop/shared";
import { type Component, For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { currentItemIdx, session, setCurrentItemIdx } from "../state/store";
import { ItemListSheet } from "./ItemListSheet";

const WINDOWED_THRESHOLD = 26;

type PipState = "approved" | "agent-addressed" | "commented" | "focused" | "pending";

function glyphFor(state: PipState): string {
  return {
    approved: "✓",
    "agent-addressed": "↻",
    commented: "•",
    focused: "▸",
    pending: "·",
  }[state];
}

type Slot = { kind: "pip"; item: Item; index: number } | { kind: "ellipsis"; key: string };

/** Builds the slot list for the pip-strip. Returns all items inline below threshold,
 *  or a windowed view (head + focus-radius + tail with ellipses for hidden ranges) above it. */
function buildWindow(items: Item[], focusIdx: number): Slot[] {
  if (items.length < WINDOWED_THRESHOLD) {
    return items.map((item, i) => ({ kind: "pip", item, index: i }));
  }
  const HEAD = 3;
  const TAIL = 3;
  const RADIUS = 5;

  const visible = new Set<number>();
  for (let i = 0; i < Math.min(HEAD, items.length); i++) {
    visible.add(i);
  }
  for (let i = Math.max(0, items.length - TAIL); i < items.length; i++) {
    visible.add(i);
  }
  for (let i = Math.max(0, focusIdx - RADIUS); i <= Math.min(items.length - 1, focusIdx + RADIUS); i++) {
    visible.add(i);
  }

  const sorted = [...visible].sort((a, b) => a - b);
  const slots: Slot[] = [];
  for (let j = 0; j < sorted.length; j++) {
    const i = sorted[j]!;
    slots.push({ kind: "pip", item: items[i]!, index: i });
    const next = sorted[j + 1];
    if (next !== undefined && next > i + 1) {
      slots.push({ kind: "ellipsis", key: `gap-${i}-${next}` });
    }
  }
  return slots;
}

export const PipStrip: Component = () => {
  let stripEl: HTMLDivElement | undefined;
  const [sheetOpen, setSheetOpen] = createSignal(false);

  const items = () => session.s?.items ?? [];
  // Precedence (strongest wins): approved (user) > agent-addressed (agent
  // says comment is fixed, awaiting user confirmation) > commented (open
  // user feedback). User's approve always overrides — they have the final
  // say. agent-addressed beats commented because it's a more recent signal
  // about the same comment.
  const responsesByItem = createMemo(() => {
    const m = new Map<string, "approved" | "agent-addressed" | "commented">();
    for (const r of session.s?.responses ?? []) {
      const cur = m.get(r.itemId);
      if (r.kind === "approve") {
        m.set(r.itemId, "approved");
      } else if (r.kind === "agent-addressed") {
        if (cur !== "approved") m.set(r.itemId, "agent-addressed");
      } else if (r.kind === "comment") {
        if (cur === undefined) m.set(r.itemId, "commented");
      }
    }
    return m;
  });

  const slots = createMemo(() => buildWindow(items(), currentItemIdx()));
  const isWindowed = () => items().length >= WINDOWED_THRESHOLD;

  createEffect(() => {
    const idx = currentItemIdx();
    if (!stripEl) return;
    requestAnimationFrame(() => {
      const focused = stripEl?.querySelector(`.pip[data-idx="${idx}"]`) as HTMLElement | null;
      if (focused) {
        focused.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    });
  });

  return (
    <>
      <div class="pips" ref={stripEl}>
        <For each={slots()}>
          {(slot) => {
            if (slot.kind === "ellipsis") {
              return (
                <div class="pip-ellipsis" onClick={() => setSheetOpen(true)} title="Show all items">
                  ···
                </div>
              );
            }
            // The "is this the current item" marker is orthogonal to the
            // response state. Active items show their response color/glyph
            // (green ✓ if approved, cyan ↻ if agent-addressed, amber • if
            // commented), with an amber underline laid on top to signal
            // "you are here." Items with no response yet fall back to
            // `focused` (amber + ▸) when current, `pending` (dim · ) otherwise.
            const responseState = (): PipState | null =>
              responsesByItem().get(slot.item.id) ?? null;
            const isActive = () => slot.index === currentItemIdx();
            const state = (): PipState =>
              responseState() ?? (isActive() ? "focused" : "pending");
            return (
              <div
                class={`pip ${state()}`}
                classList={{ "is-active": isActive() }}
                data-idx={slot.index}
                onClick={() => setCurrentItemIdx(slot.index)}
              >
                <span class="glyph">{glyphFor(state())}</span>
                <span class="num">{String(slot.item.index ?? slot.index + 1).padStart(2, "0")}</span>
              </div>
            );
          }}
        </For>
        <Show when={isWindowed()}>
          <button class="pip-expand" onClick={() => setSheetOpen(true)} title="Show full list">
            ⤢
          </button>
        </Show>
      </div>
      <Show when={sheetOpen()}>
        <ItemListSheet onClose={() => setSheetOpen(false)} />
      </Show>
    </>
  );
};
