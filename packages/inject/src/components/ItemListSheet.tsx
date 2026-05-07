import { type Component, For, createMemo, onCleanup, onMount } from "solid-js";
import { currentItemIdx, session, setCurrentItemIdx } from "../state/store";

type PipState = "approved" | "commented" | "focused" | "pending";

function glyphFor(state: PipState): string {
  return { approved: "✓", commented: "•", focused: "▸", pending: "·" }[state];
}

/** Full vertical list overlay covering the drawer interior. Click a row to jump
 *  the active item and dismiss; Esc or backdrop click also dismisses. */
export const ItemListSheet: Component<{ onClose: () => void }> = (props) => {
  const items = () => session.s?.items ?? [];
  // Precedence matches PipStrip: approve (user's final word) always wins,
  // comment only fills in when there's no other response yet. Pre-fix the
  // comparison was inverted — items the user approved AFTER commenting
  // still showed the comment glyph in the list sheet.
  const responsesByItem = createMemo(() => {
    const m = new Map<string, "approved" | "commented">();
    for (const r of session.s?.responses ?? []) {
      if (r.kind === "approve") m.set(r.itemId, "approved");
      else if (r.kind === "comment" && !m.has(r.itemId)) m.set(r.itemId, "commented");
    }
    return m;
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  const select = (idx: number) => {
    setCurrentItemIdx(idx);
    props.onClose();
  };

  return (
    <div class="sheet-overlay" onClick={props.onClose}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-header">
          <span class="sheet-title">ALL_ITEMS · {items().length}_TOTAL</span>
          <button class="sheet-close" onClick={props.onClose}>
            × ESC
          </button>
        </div>
        <div class="sheet-list">
          <For each={items()}>
            {(item, i) => {
              const state = (): PipState => {
                if (i() === currentItemIdx()) return "focused";
                return responsesByItem().get(item.id) ?? "pending";
              };
              return (
                <div class={`sheet-row ${state()}`} onClick={() => select(i())}>
                  <span class="sheet-glyph">{glyphFor(state())}</span>
                  <span class="sheet-num">{String(item.index ?? i() + 1).padStart(2, "0")}</span>
                  <span class="sheet-title-row">{item.title}</span>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};
