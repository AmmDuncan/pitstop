# Pitstop — Design Brief

Output of `impeccable:shape`. Hand to `impeccable:craft` next.

## 1. Feature Summary
A browser-based review surface where developers walk item-by-item through work an AI agent has completed. The agent emits all review items in one turn; the user advances locally on "looks good" and sends comments that re-engage the agent. Optimized for the late-stage feedback loop *inside* a Claude Code session — not for collaborative review or PR-style approval gates.

## 2. Primary User Action
Move through review items at the user's pace, deciding **looks good** or **comment + send** for each, with confidence that comments reach the agent and the next state arrives without leaving the browser.

## 3. Design Direction
Mono Industrial · Dark-first · **Bracing, Exact, Dry**. Charcoal canvas with subtle dot-grid texture. Sans body, mono everywhere else (badges, microcopy, file refs, buttons, status pill, footer counts). Sharp corners. No soft shadows, no side-stripe accents, no AI-generic violet pills. Single warm accent (coral/amber — finalized in craft) reserved for "agent is working" states.

## 4. Layout Strategy
- **Three rows:** header (project · branch · status pill) — body — footer (counts · actions).
- **Body is two columns:** ~300px item-list rail + flexible detail pane.
- **No nested cards.** Item rail is a vertical run of typographic blocks separated by hairlines. Detail pane is one editorial-feeling block.
- **Rhythm:** tight inside an item (4–8pt), generous between sections (24–48pt). Header/footer slim (~44px). Dot-grid bg shows through behind the rail.
- **Asymmetry:** heading + body left-align flush; file-ref + diff-stats inset right. Status pill is a mono rectangle with a hairline rule, not a soft pill.

## 5. Key States

| State | What shows | Feel |
|---|---|---|
| `EMPTY` | dot-grid + centered mono `WAITING_FOR_AGENT` | calm |
| `READY` | All items present, item 1 focused | quiet anticipation |
| `FOCUSED_ITEM` | rail row highlighted, detail pane filled | active workspace |
| `SUBMITTING_COMMENT` | detail pane briefly disabled; rail row tagged amber | momentary |
| `AGENT_WORKING` | status pill pulses; shows `PREPARING_NEXT` / `ADDRESSING_03` | informative, not anxious |
| `POKE_FAILED` | pill flips to `POKE_FAILED · CLICK_RETRY` (warm red, clickable, no modal) | recoverable |
| `ALL_DONE` | detail pane: `REVIEW_COMPLETE · 7_ITEMS · 2_COMMENTED` + DONE | resolution, no celebration |
| `PAUSED` | bottom banner: `PAUSED · agent will not be poked. RESUME to continue.` | deliberate |

## 6. Interaction Model
- **Keyboard primary:** `j/↓` next, `k/↑` previous, `⏎` looks good + auto-advance, `c` focus comment, `⌘⏎` send comment, `esc` blur/pause, `?` show keymap.
- **Persistent keymap hint** in footer right: contextual 2–3 shortcuts in mono. Full map on `?`.
- **Mouse path works** — large click targets — but isn't the primary affordance.
- **Auto-advance on "looks good" is local** (no agent turn).
- **Comment send** → daemon → configured poke (default `claude --resume`) → agent runs headless, writes back via MCP → SSE pushes new state → row updates without reload.
- **Pause** halts pokes (comments queue locally). **Done** flushes queue, ends session, locks surface.
- **Open-in-editor:** file refs are `<a>` tags using the editor's URI scheme (`cursor://file/PATH:LINE`, `vscode://file/PATH:LINE`, JetBrains equivalent). Configurable. Fallback: copy path to clipboard.

## 7. Content Requirements
- **Microcopy:** dry, specific, mono, all-caps for labels. Body prose stays sentence-case, sans, agent-authored.
- **Items render markdown:** headings, paragraphs, code blocks, lists, inline code, links, file refs (auto-parsed from `app/path/file.ext`), images.
- **Status pill states:** `IDLE` (hidden), `PREPARING_NEXT`, `ADDRESSING_NN`, `WRITING_ITEMS`, `POKE_FAILED · CLICK_RETRY`, `REVIEW_COMPLETE`.
- **Footer counts:** `02_APPROVED · 01_COMMENTED · 03_TO_REVIEW`.
- **Empty/all-done copy:** terse, no exclamation marks, no encouragement copy.

## 8. Recommended References During Craft
- `spatial-design.md` — three-row grid + dot-grid rhythm
- `interaction-design.md` — keyboard-first focus management, comment submission disclosure
- `motion-design.md` — status-pill pulse, `looks good` row transitions
- `ux-writing.md` — refining the dry-exact microcopy bank

## 9. Resolved Open Questions
1. **Activity log drawer** — v2, not MVP.
2. **Diff inline-expand** — out of MVP; just file-ref + open-in-editor.
3. **Image attachments** — supported; full-width inline, click for lightbox. Detail to craft.
4. **Multi-project routing** — one review per tab; daemon namespaces by project root, no in-app project switcher.
5. **Open-in-editor mechanics** — editor URI schemes (`cursor://`, `vscode://`, etc.), configurable.
