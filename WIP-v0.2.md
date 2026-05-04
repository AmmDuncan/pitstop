# v0.2 work in flight

> **If this file exists, v0.2 is mid-build.** It's the resume marker so a different laptop / fresh Claude session can pick up cleanly. The owning agent updates the **Last checkpoint** and **Next step** lines on every meaningful change.

- **Branch**: `feat/v0.2-richer-items` (parent: `feat/agent-driven-flow-spec`)
- **Origin**: pushed (commit `b17bc09`)
- **Last checkpoint**: 2026-05-04 — task #3 done: `AgentFeed` mounted above `Footer`, `StatusTag` slimmed to dot-only during narration so it doesn't duplicate the feed
- **Next step**: task #5 — expand MCP tool descriptions in `packages/mcp-adapter/src` so any agent fills `lookFor` / `tested` / `concerns` correctly without needing user prompts
- **Owner laptop**: dvla-idtms macOS (battery low, may hand off mid-flight)

## Theme of v0.2

The 2026-05-04 smoke test against DIMOS surfaced that pitstop items were too thin (one-sentence summaries, no structured "what to look out for" / "what was tested"), the addressing pill ate prime drawer real estate at the top, and the agent had no channel to narrate higher-level status. v0.2 fixes those three together.

## Tasks

| # | Status | Task | Notes |
|---|--------|------|-------|
| 1 | ✅ done | Schema fields `lookFor` / `tested` / `concerns` on `ItemZ` | All optional, default `[]`, backwards-compatible. Persisted by `Store.create`. |
| 2 | ✅ done | Render the three sections in `Detail.tsx` | Color-coded labels (amber / ok / err). CSS in `drawer.css` under `.detail-list`. |
| 3 | ✅ done | `AgentFeed` above `Footer`, `StatusTag` slim during narration | Component at `packages/inject/src/components/AgentFeed.tsx`. Reads last 5 narrations, oldest fades via `data-rank` opacity. Header shows just a pulse dot during `addressing`/`working`/`writing`. |
| 4 | ✅ done | Daemon ring buffer for narrations | Already wired — `mark_addressing` writes to `agentActivity`, capped at 50, broadcasts `state-changed`. |
| 5 | ⏳ pending | Self-documenting MCP tool descriptions | In `packages/mcp-adapter/src`, expand `start_review` + `add_items` description / param descriptions so any agent fills in `body`, `lookFor`, `tested`, `concerns`, `question` without needing user prompts. |
| 6 | ⏳ pending | README "Authoring items" section + `CHANGELOG.md` entry + version bump | Bump root and all `packages/*` to `0.2.0`. |
| 7 | ⏳ pending | Build, test, tag `v0.2.0` | `bun --cwd packages/daemon test`; rebuild both bundles; tag and push; restart Claude Code. |

## How to resume on the other laptop

1. Clone or pull this branch:
   ```bash
   git clone https://github.com/AmmDuncan/pitstop.git ~/pitstop
   cd ~/pitstop
   git checkout feat/v0.2-richer-items
   git pull origin feat/v0.2-richer-items
   bun install
   ```
2. Read this file's **Next step** line. Open a Claude Code session in `~/pitstop`. Paste:
   > Continuing pitstop v0.2 work on `feat/v0.2-richer-items`. Read `WIP-v0.2.md` for state. Pick up the next pending task.
3. Claude will recreate the TaskList from this file's table and continue.

Setup steps (MCP registration, hook, drawer wiring) are in `PITSTOP_HANDOFF.md` at `/Users/ammielyawson/work/studios/dvla-idtms/PITSTOP_HANDOFF.md` on the original laptop. If that file isn't accessible, the README in this repo covers the same ground.

## Update protocol for the agent

After every meaningful change, update **Last checkpoint** and **Next step** above (don't just edit the table). Commit with message `wip(v0.2): <one line>` so the git log is also a checkpoint trail. Push at least every 3 commits so the other laptop can fetch.

When the v0.2.0 tag is pushed, **delete this file** in the same commit. Its presence is the WIP marker.
