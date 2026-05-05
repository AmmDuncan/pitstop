import { type Component, For, onCleanup, onMount } from "solid-js";
import { submitResponse } from "../state/client";
import { toggleFloat, togglePinSide, toggleSize, toggleTheme } from "../state/modes";
import { currentItemIdx, session, setCurrentItemIdx, setHelpOpen } from "../state/store";

type Shortcut = {
  keys: string[];
  label: string;
  action?: () => void;
  /** Keep the overlay open after the action runs (e.g. layout/theme cycles so user sees the change). */
  keepOpen?: boolean;
  /** When true, keys are joined with `+` (chord). When false (default), `/` (alternates). */
  chord?: boolean;
  /** When set, the row renders a pip badge instead of kbd buttons. Used by the
   *  STATUS group to legend the pip-strip colors. */
  pip?: { state: "approved" | "agent-addressed" | "commented" | "focused" | "pending"; glyph: string; num: string };
};
type Group = { title: string; shortcuts: Shortcut[] };

function next() {
  if (!session.s) return;
  setCurrentItemIdx(Math.min(session.s.items.length - 1, currentItemIdx() + 1));
}

function prev() {
  setCurrentItemIdx(Math.max(0, currentItemIdx() - 1));
}

async function approveAndAdvance() {
  if (!session.s) return;
  const item = session.s.items[currentItemIdx()];
  if (!item) return;
  await submitResponse(session.s.id, { itemId: item.id, kind: "approve" });
  next();
}

const GROUPS: Group[] = [
  {
    title: "STATUS · pip strip",
    shortcuts: [
      { keys: [], label: "APPROVED", pip: { state: "approved", glyph: "✓", num: "01" } },
      { keys: [], label: "AGENT_ADDRESSED", pip: { state: "agent-addressed", glyph: "↻", num: "02" } },
      { keys: [], label: "COMMENTED", pip: { state: "commented", glyph: "•", num: "04" } },
      { keys: [], label: "PENDING", pip: { state: "pending", glyph: "·", num: "05" } },
    ],
  },
  {
    title: "NAVIGATION",
    shortcuts: [
      { keys: ["J", "↓"], label: "NEXT_ITEM", action: next },
      { keys: ["K", "↑"], label: "PREV_ITEM", action: prev },
    ],
  },
  {
    title: "ACTIONS",
    shortcuts: [
      { keys: ["↵"], label: "LOOKS_GOOD · ADVANCE", action: approveAndAdvance },
      { keys: ["C"], label: "FOCUS_COMMENT" },
      { keys: ["⌘", "↵"], label: "SEND_COMMENT", chord: true },
      { keys: ["ESC"], label: "BLUR_COMMENT · CLOSE_OVERLAY" },
    ],
  },
  {
    title: "LAYOUT",
    shortcuts: [
      { keys: ["["], label: "FLIP_SIDE (RIGHT/LEFT)", action: togglePinSide, keepOpen: true },
      { keys: ["]"], label: "TOGGLE_FLOAT (PINNED/FLOATING)", action: toggleFloat, keepOpen: true },
      { keys: ["="], label: "TOGGLE_SIZE (STANDARD/COMPACT)", action: toggleSize, keepOpen: true },
    ],
  },
  {
    title: "THEME",
    shortcuts: [{ keys: ["T"], label: "TOGGLE_THEME (DARK/LIGHT)", action: toggleTheme, keepOpen: true }],
  },
  {
    title: "HELP",
    shortcuts: [{ keys: ["?"], label: "TOGGLE_THIS_OVERLAY", action: () => setHelpOpen(false) }],
  },
];

export const KeymapOverlay: Component = () => {
  const close = () => setHelpOpen(false);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "?") {
      close();
      e.preventDefault();
    }
  };

  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  const handleClick = (s: Shortcut) => {
    if (!s.action) return;
    s.action();
    if (!s.keepOpen) close();
  };

  return (
    <div class="keymap-overlay" onClick={close}>
      <div class="keymap-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="keymap-header">
          <span class="keymap-title">KEYBOARD_SHORTCUTS · CLICK_TO_RUN</span>
          <button class="keymap-close" onClick={close}>
            × ESC
          </button>
        </div>
        <div class="keymap-body">
          <For each={GROUPS}>
            {(group) => (
              <section class="keymap-group">
                <h3 class="keymap-group-title">{group.title}</h3>
                <For each={group.shortcuts}>
                  {(s) => (
                    <div class={`keymap-row ${s.action ? "clickable" : ""}`} onClick={() => handleClick(s)}>
                      <Show
                        when={!s.pip}
                        fallback={
                          <span class={`keymap-pip-sample pip ${s.pip!.state}`}>
                            <span class="glyph">{s.pip!.glyph}</span>
                            <span class="num">{s.pip!.num}</span>
                          </span>
                        }
                      >
                        <span class="keymap-keys">
                          <For each={s.keys}>
                            {(key, i) => (
                              <>
                                {i() > 0 && <span class="keymap-plus">{s.chord ? "+" : "/"}</span>}
                                <kbd class="keymap-key">{key}</kbd>
                              </>
                            )}
                          </For>
                        </span>
                      </Show>
                      <span class="keymap-label">{s.label}</span>
                    </div>
                  )}
                </For>
              </section>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};
