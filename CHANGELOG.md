# Changelog

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
