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
  const responsesByItem = createMemo(() => {
    const m = new Map<string, "approved" | "commented">();
    for (const r of session.s?.responses ?? []) {
      const cur = m.get(r.itemId);
      if (r.kind === "comment") m.set(r.itemId, "commented");
      else if (cur !== "commented") m.set(r.itemId, "approved");
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
