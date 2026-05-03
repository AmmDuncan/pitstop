import { type Component, For } from 'solid-js';
import { setHelpOpen } from '../state/store';

type Shortcut = { keys: string[]; label: string };
type Group = { title: string; shortcuts: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: 'NAVIGATION',
    shortcuts: [
      { keys: ['J', '↓'], label: 'NEXT_ITEM' },
      { keys: ['K', '↑'], label: 'PREV_ITEM' },
    ],
  },
  {
    title: 'ACTIONS',
    shortcuts: [
      { keys: ['↵'], label: 'LOOKS_GOOD · ADVANCE' },
      { keys: ['C'], label: 'FOCUS_COMMENT' },
      { keys: ['⌘', '↵'], label: 'SEND_COMMENT' },
      { keys: ['ESC'], label: 'BLUR_COMMENT · CLOSE_OVERLAY' },
    ],
  },
  {
    title: 'LAYOUT',
    shortcuts: [
      { keys: ['['], label: 'CYCLE_POSITION (RIGHT/LEFT/FLOATING)' },
      { keys: [']'], label: 'CYCLE_POSITION' },
      { keys: ['='], label: 'CYCLE_SIZE (STANDARD/COMPACT/STRIP)' },
    ],
  },
  {
    title: 'THEME',
    shortcuts: [
      { keys: ['T'], label: 'CYCLE_THEME (AUTO/DARK/LIGHT)' },
    ],
  },
  {
    title: 'HELP',
    shortcuts: [
      { keys: ['?'], label: 'TOGGLE_THIS_OVERLAY' },
    ],
  },
];

export const KeymapOverlay: Component = () => {
  const close = () => setHelpOpen(false);

  return (
    <div class="keymap-overlay" onClick={close}>
      <div class="keymap-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="keymap-header">
          <span class="keymap-title">KEYBOARD_SHORTCUTS</span>
          <button class="keymap-close" onClick={close}>× ESC</button>
        </div>
        <div class="keymap-body">
          <For each={GROUPS}>
            {(group) => (
              <section class="keymap-group">
                <h3 class="keymap-group-title">{group.title}</h3>
                <For each={group.shortcuts}>
                  {(s) => (
                    <div class="keymap-row">
                      <span class="keymap-keys">
                        <For each={s.keys}>
                          {(key, i) => (
                            <>
                              {i() > 0 && <span class="keymap-plus">+</span>}
                              <kbd class="keymap-key">{key}</kbd>
                            </>
                          )}
                        </For>
                      </span>
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
