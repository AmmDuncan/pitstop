# Changelog

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
