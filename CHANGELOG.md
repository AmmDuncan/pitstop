# Changelog

All notable changes to Pitstop are documented here. Each release on GitHub mirrors the corresponding section.

## v0.3.27 — 2026-05-05

### Added
- Header position split: separate Side (right ↔ left) and Float (pinned ↔ floating) buttons replace the cycle. New `side` signal tracks the dock preference even while floating.
- Lifecycle-strip shimmer on `POKED · WAITING` and `AWAITING_CLAUDE` labels (~2.6s, low-contrast, CSS-only).
- `REVIEW_COMPLETE` terminal screen with counts, time spent, and `REVIEW_ITEMS` / `CLOSE` actions; `BACK_TO_SUMMARY` lives in the footer while browsing items.
- Shared `responseCounts` memo in `state/store.ts` (deduplicates the addressed-once invariant from v0.3.6 between Footer and ReviewComplete).

### Changed
- Theme is binary (`dark` ↔ `light`); `auto` mode and `resolvedTheme` removed. Legacy `auto` localStorage values migrate to the current system preference on first read.
- Size button is binary (`standard` ↔ `compact`); strip mode lives only on the dedicated minimize button + empty-state collapse.
- Header chrome cluster tightened: 22×22 buttons (down from 26×24), 8px gap; the pos pair shares one outer border with a sibling-selector divider.
- Strip layout grouped into top (logo + label) and bottom (count + dot) clusters — no more giant gaps between every element.
- `REVIEW_COMPLETE` stamp uses `--ok` (green) to match the success semantic the rest of the UI assigns to that color.
- Empty-state collapse moved to top-right (`top: 14px`), mirroring the active-state minimize button.

### Fixed
- Detail action buttons hidden when session status is `complete`; browse-back mode no longer accepts stray approves/comments.
- `reviewingComplete` auto-resets when the session leaves the complete state — fresh sessions never open stuck in browse mode.
- Removed unsafe `position() as Side` cast in `toggleFloat`.

## v0.3.26 — 2026-05-04

### Added

- **Logo in strip mode.** Same 2×2 checker SVG that lives in the drawer header now also appears at the top of the strip when the drawer is collapsed. Sized to fit the 32px-wide rail (14×14 SVG centred horizontally).

## v0.3.25 — 2026-05-04

### Changed

- **Logo padded.** The 2×2 checker SVG was rendering edge-flush in the 22×22 header box, which read as too aggressive next to the `PITSTOP` wordmark. SVG sized down to 16×16 (centred by the wrapper's `place-items: center`) so the mark sits with breathing room.

## v0.3.24 — 2026-05-04

### Changed

- **Logo: 🏁 emoji → custom SVG (flush 2×2 checker).** v0.3.23 used the checkered-flag emoji as a placeholder, which renders differently across OSes (Apple/Microsoft/Google all draw 🏁 their own way). v0.3.24 replaces it with an inline SVG mark — variant A1 from the 2026-05-04 visual brainstorm — so the drawer header looks identical everywhere. Spec at `docs/superpowers/specs/2026-05-04-pitstop-logo-design.md`.

## v0.3.23 — 2026-05-04

### Changed
- Replaced the inline `W` mark with a checkered-flag emoji (🏁) — placeholder until the custom SVG arrived in v0.3.24.

## v0.3.22 — 2026-05-04

### Changed
- Comment textarea: dark-amber tint on focus to match the border shift, so the focused state reads as a single visual change rather than just a border flicker.

## v0.3.21 — 2026-05-04

### Added

- **`arrived` flag on `mark_addressing`.** Optional boolean (default `true`, for backwards compat with v0.3.13–v0.3.20 callers). Agents narrating progressively during navigation should pass `arrived: false` on intermediate calls — the drawer keeps the `AWAITING CLAUDE` strip up and buttons hidden. The final narration omits the flag (or passes `arrived: true`) to unlock the action buttons. Single-narration items work unchanged. MCP tool description spells out the rule.

## v0.3.20 — 2026-05-04

### Changed
- AgentFeed older lines no longer fade — only the newest line gets the rank-0 highlight (chevron + bolder color).

## v0.3.19 — 2026-05-04

Maintenance release.

## v0.3.18 — 2026-05-04

### Changed
- More breathing room at the bottom of the comment textarea while typing.

## v0.3.17 — 2026-05-04

### Added

- **Vertical resize handle on the AgentFeed.** Drag the top edge of the feed up to grow it, down to shrink. Bounded between 80px (min) and 400px (max); default 120px. Same pointer-capture pattern as the floating-drawer drag, so the release fires reliably even when the cursor leaves the viewport.

### Fixed

- **Drawer no longer appears in print previews.** Added `@media print { :host { display: none !important; } }` so the floating overlay stays out of users' printed output.

## v0.3.16 — 2026-05-04

### Added

- **Auto-scroll to lifecycle strip on submit.** When the action area transitions from idle (buttons or PendingQuestion) to sending/poked (status strip), the detail-scroll container auto-scrolls smoothly to its bottom so the strip is in view. Previously, if you submitted via keyboard while scrolled up reading the item body, you'd get no visual confirmation — the strip would appear off-screen below the fold.

## v0.3.15 — 2026-05-04

### Changed

- **AgentFeed compact + always-scrollable.** Feed used to grow vertically with content — long narrations turned each entry into a 3-5 line paragraph, eating the bottom of the drawer. Now: each line wrap-clamps at 2 visual lines with `…`; the container holds a fixed 120px max-height and scrolls when content exceeds. Same height in both collapsed and expanded states — clicking `+N older` only changes what's IN the list, not the size of it. Hover any line for the full text via title attr.

## v0.3.14 — 2026-05-04

### Added

- **`ask_user` MCP tool.** Lets the agent put a question in the drawer instead of hijacking chat with `AskUserQuestion`. Pitstop sessions are an active flow — the user is already looking at the drawer; pulling them into a modal is jarring. `ask_user` surfaces the question as a banner that replaces the action area, the user picks an option (or types free-form), the answer comes back via the existing Monitor → `get_unread_responses` loop with `kind: 'answer'`.
- **Rich option cards.** Options aren't just strings anymore — `{ label, description? }`. Labels are short ALL-CAPS button text; descriptions are full sentences underneath, useful when a one-word label is ambiguous. Cards are full-width clickable rectangles, scrollable when the list exceeds 240px.
- **`AskUserQuestion` override rule.** `start_review`'s tool description tells the agent: while a pitstop session is active, prefer `ask_user` over `AskUserQuestion` for review-related questions. Wiring/setup questions in step 0 are the only exception.
- **Schema extensions:** `Session.pendingQuestion` (cleared when an `answer` response is received), `Response.kind` adds `'answer'`, `Response.questionText` carries the original question for agent correlation, `ActivityEntry.itemId` (also adopted by `mark_addressing` in v0.3.13).

### Fixed

- **State desync on `pendingQuestion` clear.** Solid's `setStore('s', newSession)` doesn't always remove keys that disappeared from the new object — the banner stayed in the DOM after submitting an answer. Switched to `reconcile(e.session)` so deep-diff replacement properly removes stale keys.

## v0.3.13 — 2026-05-04

### Added

- **`AWAITING CLAUDE` lifecycle state** — when the current item has no `mark_addressing` entry yet from Claude, the action buttons stay hidden and a status strip reads `AWAITING CLAUDE`. Buttons only appear once the agent has explicitly addressed *this* item, so you can't approve before Claude has driven you to the surface. The strip transitions out cleanly the moment the first `mark_addressing` for the item arrives.
- **AgentFeed flash on new entry** — when a new narration arrives, the newest line briefly flashes amber and fades to transparent over 1.5s. Draws the eye without being annoying. The feed is no longer dead.

### Changed

- **`ActivityEntry.itemId`** — `mark_addressing` now persists the `itemId` it received as a param onto the activity entry. Previously it was passed in but discarded. Lets the drawer tell which item each narration is about.

### Migration

`ActivityEntry.itemId` is optional, so v0.3.x sessions on disk still parse. After pulling, agents calling `mark_addressing` will start populating the new field automatically.

## v0.3.12 — 2026-05-04

### Added

- **CSP guidance.** Drawer not appearing because a dev app's CSP blocked `localhost:7773` is the kind of bug that gives users a blank screen with no obvious cause. `wire_drawer` now always returns a CSP note in `notes` with a concrete copy-pastable spread snippet (`...(process.env.NODE_ENV !== 'production' ? ['http://localhost:7773'] : []),`) for adding to `script-src` AND `connect-src`. The README has a Troubleshooting section showing the same pattern in nuxt-security and other typical config shapes.

## v0.3.11 — 2026-05-04

### Changed

- **Session JSON files are deleted when the review ends** — both DONE button (status flips to `complete`) and `complete_review` MCP tool now drop the file from disk after publishing the SSE events. Comments are already in the agent's context via `get_unread_responses`, the drawer's UI flushes via the SSE updates; the file has no consumer afterward, so keeping it was just clutter.
- **Stale idle sessions are replaced.** When `start_review` is called on a projectRoot that already has an idle session with zero responses and zero agent activity (i.e. someone aborted a `start_review` earlier without doing anything), the stale one is deleted before the fresh one is created. Idle sessions with real responses are preserved (ALREADY_ACTIVE error is unchanged for active/paused).
- **`session.retentionDays` config removed.** Was a stub that nothing read; with delete-on-complete there's nothing to retain.

### Migration

Existing complete-status JSONs from before this version stay on disk until you manually `rm ~/.claude/pitstop/sessions/*.json`. Going forward, the directory should self-prune.

## v0.3.10 — 2026-05-03

### Fixed
- AgentFeed only fades the last 2 lines when overflowing (was fading all 5).

## v0.3.9 — 2026-05-04

### Fixed

- **Strip mode in floating position had no drag handle.** Strip size doesn't render the header, so the floating drawer was stuck where you collapsed it. The strip body itself now doubles as click-to-expand and (when floating) drag-to-move — distinguishes drag from click by a 3px movement threshold; same pointer-capture pattern as the header drag, so the release fires reliably.

## v0.3.8 — 2026-05-03

### Changed
- Footer button: `STOP` → `PAUSE` (with title tooltips spelling out each direction's effect).

### Fixed
- Comment textarea border in light mode (was missing the focused-state contrast).

## v0.3.7 — 2026-05-03

### Fixed
- Cap the expanded AgentFeed at 90px so it doesn't displace detail content.

## v0.3.6 — 2026-05-04

### Fixed

- **Footer `_LEFT` counter could go negative.** When an item received both an approve and a comment, both were counted toward "addressed", so `items.length - approved - commented` over-subtracted. Now counts distinct addressed item IDs once.
- **AgentFeed fade looked like an overlay** when no narrations were hidden. The rank-based opacity that signals "older fades out" only applies now when `…+N older` would actually be shown — i.e. when there ARE hidden entries. With ≤5 visible narrations and nothing hidden, every line renders at full opacity. Position alone carries the recency signal.

## v0.3.5 — 2026-05-04

The "less chore, more signal" release. Drawn from feedback that v0.3.x's items felt verbose to author and the "Claude is cooking" silence after submit was hard to see.

### Added

- **COVERAGE RULE on `start_review`** — items must split by *testable unit surface* (one screen / modal / wizard step the user can land on and form a single review judgment about). Five small items each pointing at one screen beat one item that asks the user to navigate themselves; one item per pixel is too many. Baked into the MCP tool description.
- **Lifecycle status strip** on the action area. When you click `LOOKS_GOOD` or `SEND_COMMENT`, both buttons are replaced by a single status strip (`SENDING…` then `POKED · WAITING`) with a pulsing dot. Cooking-state feedback now lands where your eye just was, not at the top of the drawer.

### Changed

- **AUTHORING_HINT and per-field schema descriptions cut by ~60%.** Examples retained as anchors (one positive + one negative per field). The "uncommon to leave empty" framing on `tested` removed — replaced with explicit "bias toward empty" guidance on every list field.
- **`tested` field deprecated.** The drawer no longer renders a TESTED section. Agents now mention what they exercised inline in `body` ("Already tested: <thing>.") only when non-obvious. The schema still accepts `tested` for backwards compat with v0.2/v0.3 sessions on disk.
- **Cap of 3 bullets** on `lookFor` / `concerns` baked into per-field descriptions. Forces prioritization.
- **Specificity test** added: each bullet must name ONE thing the reviewer can verify in <3 seconds. Filler ("Looks good", "Tested it", "Could be improved") is called out as deletable.

### Migration

No code changes for consumers. Existing sessions still parse. Re-run `bun run setup` to rebuild bundles.

## v0.3.4 — 2026-05-03

### Fixed
- Resize handles release on cursor-left-viewport (matched the same fix the floating-drawer header drag got in v0.3.1).

## v0.3.3 — 2026-05-03

### Changed
- `wire_drawer`: `projectRoot` resolution is the agent's responsibility — the daemon no longer guesses.

## v0.3.2 — 2026-05-03

### Changed
- `wire_drawer` is now self-routing — picks the right install path (committed snippet, local-only file, or Chrome extension) based on the project's framework.

## v0.3.1 — 2026-05-04

### Added

- **`wire_drawer` MCP tool.** Inspects a project's framework (Nuxt / Vite / Next / SvelteKit / Astro / Remix / plain HTML), returns two wiring options (committed conditional snippet or local-only gitignored file) with the exact snippet, target file, and `.gitignore` line to add. The agent surfaces the choices through `AskUserQuestion`; the user picks; the agent does the file edit. Recommendation defaults to `local-only` for solo projects and `committed` for repos with team-style files (CODEOWNERS, CONTRIBUTING.md).

### Fixed

- **Floating-drawer drag handler not releasing.** When the drawer was in floating mode and you dragged it via the header, releasing the mouse outside the browser window — or sometimes inside, due to Shadow DOM event retargeting — left the drawer following the cursor as if you were still dragging. Switched from `mousedown`/`mousemove`/`mouseup` on `window` to pointer events on the header element with `setPointerCapture`. Implicit pointer capture guarantees the release fires even when the cursor leaves the viewport; `pointercancel` and `lostpointercapture` are listened to as backup exit paths.

### Changed

- **README repositioned.** Driven-mode wiring (committed conditional snippet OR local-only file) is now the default recommendation, since pitstop's headline flow is agent-driven and the browser extension doesn't load in agent-browser's Playwright Chromium. Extension is documented as Option C for free-form review only.
- **MCP tool count: 8** (was 7) — `wire_drawer` is the new entry.

## v0.3.0 — 2026-05-04

The "wire it from anywhere" release. v0.2 still required every dev app to commit a `<script>` tag (or have a teammate add one). v0.3 introduces three wiring paths so you can pick the one that fits your workflow.

### Added

- **Browser extension** at `packages/extension/` (Manifest V3, unpacked-loadable). Install once in Chrome, drawer appears on every `localhost:*` tab where an active session matches. Zero edits to any dev app, ever. Survives browser restarts. Recommended for daily human review.
- **`devUrls: string[]`** on `start_review` (and on the session schema). Agents pass the dev URL(s) where the review's surfaces live (e.g. `["http://localhost:3000"]`). The drawer's "no project hint" fallback uses this to scope itself to the right tab — without `devUrls`, the extension can't tell which localhost tab is yours and may surface the review on unrelated pages. The MCP `start_review` description tells agents to always include this when known.
- **`GET /api/sessions/most-recent-active?origin=…`** — daemon endpoint backing the extension's "no projectRoot wired" fallback. Prefers sessions whose `devUrls` include the origin; falls back to a loose match (no devUrls set) when no scoped session matches.
- **Polling fallback in inject** — when the drawer is loaded with no project hint and no session is yet active, it stays invisible and polls the daemon every 12s. The drawer auto-mounts the moment an agent starts a review. Quiet localhost tabs stay quiet.

### Changed

- README's "wire the drawer" section is now three explicit options (extension / local-only plugin / committed script tag) with the extension marked recommended. Each option calls out its trade-off (e.g. extensions don't load in Playwright-driven Chromium).
- Inject's `bootstrap()` now accepts `null` for the project root, signalling "extension mode" — falls back to the `most-recent-active` endpoint.

### Migration

`v0.2` sessions on disk still load (`devUrls` defaults to `[]`, treated as loose mode). After pulling, run `bun run setup` again to rebuild both bundles. Reload your dev app pages.

## v0.2.2 — 2026-05-04

### Added

- **`bun run setup`** — one-shot installer. Builds both bundles, registers the MCP adapter in `~/.claude.json`, installs the `UserPromptSubmit` hook in `~/.claude/settings.json`. Idempotent and dedup-safe; existing config in those files is preserved. Trims the install path from 8 manual steps to 3.
- **Drawer-wiring detection** — `start_review` now returns a `drawerStatus` field. The daemon tracks `/inject.js` fetches per `projectRoot` and tells the agent whether the drawer is wired into the dev app. When not, the response carries a copy-paste script-tag snippet for the user. The `start_review` MCP tool description tells the agent to surface this hint *before* driving anything, so users no longer stare at a blank screen wondering why the drawer never appeared.

### Changed

- **README install section** trimmed from 5 numbered steps to 3 (clone + `bun run setup`, restart Claude Code, wire drawer). The manual fallback for the JSON edits remains in a collapsed `<details>` block.

## v0.2.1 — 2026-05-04

### Added

- **AgentFeed expander** — when more than 5 narrations exist, a `… +N older` line appears beneath the feed. Click expands to a scrollable history of all narrations (capped at the daemon's 50-entry ring buffer), with the newest still amber-chevron-highlighted and the older ones at full readability. `SHOW LESS` collapses back.

## v0.2.0 — 2026-05-04

The "richer handoff" release. Pitstop items used to be a one-line summary
plus a question; the human reviewer had to guess what to look at and how
much had been pre-tested. v0.2 turns each item into a small handoff
document, and adds a real channel for the agent to talk back into the
drawer while it works.

### Added

- **Structured item fields** — `lookFor`, `tested`, `concerns` arrays on
  every item. Optional, default `[]`, so v0.1 items still parse. The
  drawer renders each non-empty array as a labelled bulleted section
  beneath the markdown body (amber for "look out for", green for "tested",
  red for "concerns").
- **Agent feed at the bottom of the drawer** — a new `AgentFeed`
  component that surfaces the last 5 `mark_addressing` narrations,
  newest first, oldest fades. The reviewer no longer needs to tab back
  to the terminal to see what the agent is doing.
- **Self-documenting MCP tool descriptions** — every tool's description
  and every item field's JSON-schema `description` was rewritten to bake
  in the authoring convention. Agents calling `start_review` /
  `add_items` for the first time will fill `body` + `lookFor` + `tested`
  + `concerns` + `question` correctly without a user prompt.

### Changed

- **Drawer layout** — the verbose addressing pill in the header is now a
  slim pulse-dot during `addressing` / `working` / `writing` states.
  The narration text it used to carry now lives in the agent feed at the
  bottom, freeing the top for the item heading + body + question + comment
  box. The full pill is still rendered for `failed` / `complete` /
  `sending` / `poked` so user-blocking states stay prominent.
- **MCP server version** bumped to `0.2.0`.

### Migration

`v0.1` sessions on disk still load (new fields default to `[]`).
Rebuild both bundles after pulling:

```bash
bun build packages/mcp-adapter/src/index.ts \
  --outfile packages/mcp-adapter/dist/index.js \
  --target=node --format=esm
bun --cwd packages/inject run build
```

Restart Claude Code so the new MCP schema is registered.

## v0.1.0 — 2026-04-30

Initial public release. Drawer + daemon + mcp-adapter + browser-driving
toolbelt agnosticism. See `README.md`.
