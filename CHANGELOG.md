# Changelog

All notable changes to Pitstop are documented here. Each release on GitHub mirrors the corresponding section.

## v0.3.65 — 2026-05-08

- fix(daemon): concurrent `store.update` calls against the same session no longer drop writes. Surfaced in smoke-round-3: 10 parallel `narrate` calls used to persist only 2 beats and return ENOENT for 7 of the calls. Two compounding bugs: `writeAtomic`'s tmp filename collided when two writes landed in the same millisecond from the same process (one's tmp got overwritten before its rename), and `store.update` was an unguarded read-modify-write so the last writer clobbered everyone else's `agentActivity` even when the tmp collision didn't bite. Tmp name now uses `crypto.randomUUID()`; updates serialize through a per-session async mutex that self-clears when the chain settles. Regression test fires 10 parallel narrates and asserts every beat persists.

## v0.3.64 — 2026-05-08

- fix(daemon): `POST /api/sessions/:id/status` now returns 404 for unknown session ids instead of bubbling up as a 500. The drawer's DONE button hits this route, and a 500 there was a noisy false alarm when the session had just been deleted by a concurrent `complete_review`.
- fix(daemon): `start_review` now rejects `items: []` at the schema level. A review with zero items is a ghost session the drawer can't render — `min(1)` catches the mistake at the boundary instead of letting it through.

## v0.3.63 — 2026-05-08

- feat(drawer): default to strip when no session is active. The drawer auto-lifts to standard the moment a session arrives, then drops back to your persisted preference when the session ends. Explicit resizes (click strip to expand, size toggle) are sticky as before — the auto-lift never overwrites them. Existing users keep whatever they previously persisted.

## v0.3.62 — 2026-05-08

- fix(daemon): `add_items` now accepts the same item shape as `start_review` — `id`/`index`/`attachments` are optional and the daemon assigns a zero-padded `id` when omitted. Previously the stricter zod forced callers to invent fields the daemon overwrote anyway, in conflict with the MCP tool definition agents see.

## v0.3.61 — 2026-05-08

### Changed
- **Header kebab collapse disabled.** With only one secondary control today, collapsing into a kebab when the drawer narrows wasn't earning its complexity — users had to open the kebab to reach a single button. Inline buttons render always. ResizeObserver + threshold + kebab JSX stay in place; re-enabling is a one-line revert when we add more secondary controls.

## v0.3.60 — 2026-05-08

### Fixed
- **Lifecycle strip drops side borders.** Sitting between AgentFeed and Footer (both full-drawer-width), a 4-sided border framed the strip as a contained card and competed with the actual content cards above (item body, `LOOK_OUT_FOR` section). Top + bottom rules only reads as a horizontal status row, which is what it semantically is. Slight horizontal-padding bump (12 → 14px) to match the drawer's content gutter.

## v0.3.59 — 2026-05-08

### Changed
- **Light-mode base color shifts off pure white to warm cream.** Old light tokens were essentially pure white — paper at `oklch(0.985 0.003 70)` and inputs at `#fff`. Felt clinical against a developer's editor surroundings, and the tiny chroma made the warm hue invisible in practice. Lightness ramp pulled down ~0.025 across the board (paper `0.985 → 0.96`, panel `0.99 → 0.97`, input `#fff → 0.985`, rail `0.97 → 0.94`); hue shifted `70 → 80` with slightly higher chroma. Reads as "paper" rather than "blank canvas," and the amber accents (DRIVING label, pip underline, amber-soft highlights) — already in this hue family — pair more intentionally now. Hierarchy preserved: input > panel > paper > rail.

## v0.3.58 — 2026-05-08

### Changed
- **Lifecycle strip is now a drawer-level slot between AgentFeed and Footer.** Previously the strip lived inside Detail's per-item action area, so it vanished the moment LOOKS_GOOD auto-advanced you to the next item — at exactly the moment you expected to keep watching POKED · WAITING or DRIVING · …. Lifted to a persistent grid row that survives item navigation. Animates max-height 0 ↔ 80px like the stale-adapter banner; always present in the DOM so collapsed states don't shift other rows. Renders in compact mode too (AgentFeed hides in compact, strip stays — status visibility is the whole point of the lift).
- **Strip typography respects the "mono uppercase = label, sans = prose" rule.** DRIVING narrations were being rendered in mono+uppercase+wide-letter-spacing, which made multi-line wraps look cramped and treated prose like a label. Split into label (`DRIVING`, mono uppercase) + narration (sans, normal case, line-height 1.4, line-clamp 2). The narration's full text remains in the AgentFeed.
- **Action area stays inside Detail's normal flow.** Textarea + LOOKS_GOOD / SEND_COMMENT keep their position below the item content (this is the design lock from the brainstorming pass — the lift is for the strip only, not for the actions). Detail's 1fr region absorbs the strip's height when it expands; AgentFeed slides up; actions stay at the bottom of Detail's space.

### Removed
- **Footer counts segment** (`01_OK 00_QUEUED 03_LEFT`). The pip strip + the header's `01/04` counter already carry "where am I in the review"; repeating it in the footer served no practical purpose. Footer is now flex with PAUSE / DONE right-aligned.

### Internal
- New `state/lifecycle.ts` — single drawer-level instance of `stripState`, the driving-narration memo, elapsed-timer signals, and the poke handler. Both `LifecycleStrip` and `Detail` (for disabling LOOKS_GOOD) read from here.
- New `components/LifecycleStrip.tsx` — reads stripState directly inside JSX (no captured const, same reactivity lesson as v0.3.55).

## v0.3.57 — 2026-05-08

### Fixed
- **Pip `is-active` amber underline survives response-state transitions.** Previously the pip rendered via `class={`pip ${state()}`} classList={{ "is-active": isActive() }}`. When state() changed reactively (on agent_address_comment, on user approve, on user comment), Solid reassigned the full `class` attribute string — clobbering the classList-managed `is-active` class out of the DOM. The amber active-item underline vanished for exactly the item the user was looking at, every time the agent or user took action on it. Consolidated all dynamic classes into a single `classList` directive so none of them races with the others.

### Added
- **`update_item` MCP tool** — patch an existing item's authored fields (title, body, lookFor, concerns, question) mid-session without creating a new item. Closes the gap where ongoing iteration changed what the user should look at but the agent could only `add_items`. Patch is shallow-merged; arrays replace wholesale (not append), matching the agent's mental model of "this is what the user should look at" being a fresh statement. Throws `UNKNOWN_ITEM_ID:<id>` on missing item, rejects empty patches at the schema layer. Five hermetic tests cover the happy path, array-replace semantics, unknown-itemId/sessionId errors, and empty-patch rejection. Added to `start_review`'s `toolsToPreload` list so it loads up front.

## v0.3.56 — 2026-05-08

### Fixed
- **Lifecycle strip stuck at `POKED · WAITING` after agent activity.** Two compounding bugs:
  1. `submitState` only cleared via the typed `agent-activity` SSE event handler or the 60s safety timeout. Missed bus deliveries / SSE reconnects / browser-tab throttling left it stuck. Fixed by also clearing when `agentActivity` array grows on a `state-changed` reconcile — the same signal, more robust delivery path.
  2. `LifecycleStrip` (the IIFE-component sub-agent A introduced in v0.3.53) was reading `stripState()` into a `const state = ss()` at mount, which is a non-reactive snapshot. Once the strip mounted in poked state, its label stayed "POKED · WAITING" forever — even when fix (1) above (and the existing `agent-activity` case) DID update `submitState` correctly. Switched to `<Show when={ss()}>{(state) => …}</Show>` for a reactive non-null accessor.
- **Stale-adapter banner reads less commanding.** "Run kill 12345, then quit + relaunch" → "To get them in sync, you'll want to run `kill 12345` and relaunch Claude Code." Same instructions, gentler frame.

### Added
- **`DRIVING · <narration>` in the awaiting strip.** When the agent is mid-drive (called `mark_addressing` with `arrived: false`), the strip now surfaces the narration alongside the elapsed timer so the user sees WHAT the agent is doing, not just THAT it's busy. Per-current-item; falls back to plain "AWAITING CLAUDE" after 60s of silence so stale state isn't shown. Truncated at 50 chars in strip; full text remains in feed. No new MCP surface — reuses the existing `mark_addressing(arrived: false)` semantics, preserving the three-feed-tools rule.

### Internal
- Hoisted `now` signal earlier in `Detail.tsx` so the new `drivingNarration` memo can subscribe to its 1Hz tick for freshness-window re-evaluation.

## v0.3.55 — 2026-05-07

### Internal
- **`packages/mcp-adapter/src/index.ts` slimmed from 496 → 40 lines.** The tool catalogue (every tool's schema, description, the `ITEM_SCHEMA` constant, the `AUTHORING_HINT` and `ASK_USER_CROSSREF` cross-tool prose) moved verbatim to a new `tool-definitions.ts`. No behavior change — same `tools` array exported, same shape. Just a much clearer landing pad for tool authoring/copyediting work, which is the most-frequent edit target in the adapter.
- **`session-id.ts` resolver gets test coverage.** Six hermetic tests in `packages/mcp-adapter/test/session-id.test.ts` lock down the fallback chain that produced v0.3.52's silent regression: env `CLAUDE_CODE_SESSION_ID` override, legacy `CLAUDE_SESSION_ID` fallback, hook-file at matching ppid, ppid-mismatch falling through to transcript scan, transcript scan picking the newest `.jsonl`, and the all-empty undefined case. Each test isolates its own tmp HOME — no host-env pollution.
- Small refactor to enable hermetic testing: `resolveClientSessionId` now accepts optional `{ homeDir, cwd, ppid, env }`. Production callers pass no args; defaults wire to `homedir()` / `process.cwd()` / `process.ppid` / `process.env` unchanged.

## v0.3.54 — 2026-05-07

### Fixed
- **Disabled buttons preserve their variant identity.** v0.3.53 introduced disabled-LOOKS_GOOD during AWAITING/POKED, which surfaced a pre-existing CSS quirk: `.btn-primary:disabled` flattened bg + color + border to look identical to `.btn-secondary:disabled` — both ended up as outlined grey rectangles. With LOOKS_GOOD now held disabled for the entire agent-processing window (potentially minutes), users couldn't tell which button was which. Replaced the per-variant overrides with a single `opacity: 0.45` rule on `.btn:disabled` so primary stays filled, secondary stays outlined, and both just dim. Disabled-primary now reads as "this IS approve, just unavailable right now."

## v0.3.53 — 2026-05-07

### Changed
- **Drawer: SEND_COMMENT stays available during AWAITING / POKED.** The lifecycle strip used to replace both action buttons whenever the agent was processing — fine for sub-second SENDING, but AWAITING can last minutes during real agent work, leaving the user typing into a textarea they couldn't submit from. Now SEND_COMMENT is enabled and LOOKS_GOOD renders disabled with a tooltip ("Agent is addressing your comment — wait for it to land, or send another comment.") so the dual-button layout stays stable across all states. The strip drops below the actions row as a status footer with the elapsed timer and POKE button.

### Added
- **Agent steering: stop punting "could you check this in the browser?"** Two complementary nudges so the model reaches for `start_review` instead of asking the user to manually verify:
  - UserPromptSubmit hook (`pitstop-context.sh`) now also queries the new `GET /api/wired` endpoint. When the daemon's `drawerSeen` map shows a recent `/inject.js` fetch for `$PWD` (within `DRAWER_FRESHNESS_MS`, the same 10-min window `start_review`'s `drawerStatus` already uses), the hook prints a one-paragraph steering line. Silent on non-pitstop projects.
  - `activeSessionRules.verificationSurface`: new entry in `start_review`'s response — *"ANY surface the user needs to verify, check, or look at — call start_review or add_items, never 'could you check this in the browser?'"* — so the model sees the same nudge in every active-session tool description.
- `GET /api/wired?projectRoot=...` — daemon endpoint exposing whether the drawer has been seen recently for a given project. Backed by 3 new tests.

### Internal
- `DRAWER_FRESHNESS_MS` exported from `packages/daemon/src/tools/index.ts` as a single source of truth for both `start_review`'s `drawerStatus.connected` check and the new `/api/wired` query.
- Hook curls have `--max-time 2` so a stuck daemon can't hold up the user's prompt.

## v0.3.52 — 2026-05-07

### Fixed
- **Claude Code session-id binding via SessionStart hook.** Pitstop has been silently failing to bind to the CC session for the entire project lifetime. v0.3.43's "fix" assumed `CLAUDE_CODE_SESSION_ID` was set on MCP server subprocesses; today's CC release notes clarified the env var is exposed to **Bash tool subprocesses only**, not MCP. The drawer's `CLAUDE# UNBOUND` chip has been the canonical signal — pokes never woke any agent because there was no session id to resume. v0.3.49 cross-session rebind has been a no-op for the same reason.
  - New `packages/scripts/pitstop-session-id.sh` SessionStart hook reads `session_id` from CC's JSON stdin and writes `~/.claude/pitstop/cc-session-$PPID.txt`.
  - New `packages/mcp-adapter/src/session-id.ts` resolves the id per RPC call: env var → hook file (by `process.ppid`) → most-recently-modified `.jsonl` in `~/.claude/projects/<encoded-cwd>/` as a zero-config fallback for users who haven't run setup.
  - Per-call resolution pairs with the daemon's existing rebind logic so a CC restart with a new session id flows through immediately.
  - Forwarder takes a `resolveClientSessionId` function instead of a static `clientSessionId`.

### Setup
- `bun run setup` now installs the SessionStart hook into `~/.claude/settings.json` alongside the existing UserPromptSubmit hook. Existing installs need to re-run setup or restart CC for the hook to fire.

## v0.3.51 — 2026-05-07

### MCP

- **New `dismiss_pending_question` tool.** When the user answers an `ask_user` question by typing in chat instead of clicking the drawer banner, the agent has the answer but the drawer's pendingQuestion never clears (the only normal clear path is an answer-kind response from a drawer click). The new tool clears the banner and optionally records the chat-captured answer into the session response history. `ask_user`'s description now tells the agent to call this on out-of-band answers. Added to `start_review`'s `toolsToPreload`.
- **`narrate` gains a strong DUAL_SURFACE_RULE** mirroring `ask_user`'s — chat-only beats during a session never reach the user-in-drawer and fail silently, so the rule has to be wherever the agent's eye lands.
- **`start_review`'s response now includes `activeSessionRules`** — a cheat-sheet of cross-tool inversions (use `ask_user` not `AskUserQuestion` during a session, etc.) so resuming agents have the rules at hand without skimming long descriptions.

### Stale-adapter banner

- **MCP adapter sends `x-pitstop-adapter-pid: <process.pid>`** alongside the version header. The daemon's stale-adapter SSE event now carries the pid, so the banner can name the exact process the user needs to kill — `kill <pid>` rendered in a code-styled mono tag so it reads as a command, not prose.
- **Banner moved into the drawer's grid between header and pip strip** instead of overlaying the metabar. Lives below the chrome so it doesn't fight the floating-drawer drag handle, and a `.stale-adapter-slot` wrapper keeps the parent grid's child count stable when the warning is empty (Solid's `<Show>` returning nothing would otherwise shift every subsequent grid row up by one).
- **Tone shifted from danger to amber** with a softer background and double-line border via `color-mix(in oklab, ...)` — this is "you should restart" guidance, not a system failure. ⚠ glyph replaced with a real WarningIcon SVG (Lucide TriangleAlert).

### Tooling

- **`bun run refresh-local` script.** Kills the daemon (auto-respawns on next call) and every running pitstop MCP subprocess (CC respawns its adapter on next launch), then lists the running CC parent pids with their cwd so you know which to fully quit + relaunch. The release script's tail message points at it but does NOT auto-invoke — pitstops in progress would be disrupted.

### Drawer chrome

- **Header `secondaryCollapsed` drops the `size === "compact"` signal.** `size()` is the user's drawer-height preference, not a chrome-density preference. Compact height with standard width has plenty of horizontal room — the kebab was triggering too eagerly. Width threshold alone catches the actually-narrow cases.

### Docs

- **README intro rewritten** around the real value: pitstop ensures you don't skip affected surfaces, and your feedback is anchored to the specific step in the flow. The agent-driven walkthrough is what makes it work, but the keystroke shortcuts are not the value prop — coverage and context are.

## v0.3.50 — 2026-05-07

### UX

- **Scroll-to-top on item navigation.** When `currentItemIdx` changes — agent's `set_current_item`, user's `j`/`k`, pip click, or auto-advance after `LOOKS_GOOD` — the detail body now scrolls to the new item's title instead of carrying the prior item's scroll position over (which often left the new item's content below the fold). Last-write-wins on `requestAnimationFrame` means scroll-to-top implicitly overrides the scroll-to-bottom that fires from the action-area submit transition, which is the right priority: reading content beats seeing the action affordance after auto-advance.
- Three scroll-target sites (submit-to-bottom, strip-resolves-to-buttons, item-change-to-top) now share a small `scrollDetailTo("bottom" | number)` helper.

## v0.3.49 — 2026-05-07

### Cross-session resume

Real-user feedback after a Claude-A → Claude-B resume of an active pitstop session uncovered three friction points. All three fixed:

- **Auto-rebind on `clientSessionId` mismatch.** The existing `/api/rpc` self-heal only updated `clientSessionId` when it was missing. Generalize to "update if differs from incoming" — any tool call from a new Claude Code session for a pitstop bound to a different (likely dead) one will rebind. Pokes target the current driver from then on. Resume becomes invisible: no `rebind_session` tool to discover, no manual fixup, just works.
- **`get_state` returns the same `watcher` shape `start_review` does.** Resuming agents land at `get_state` without seeing `start_review`'s response, so they don't know there's a canonical `pitstop-watch.sh` script — and end up rolling their own SSE poller with `awk` (not line-buffered by default), which silently buffers user clicks until the user realizes in chat. The MCP tool description now spells out the resume recipe and warns explicitly against the awk pipe-buffering trap.
- **`get_state` returns `lastResponseAt`** (max of `responses[].at`, undefined if none) as a freshness signal. The description now says "this is a snapshot at call time, not a stream — for live changes use the watcher". Avoids the "I called get_state, saw 3 responses, but a 4th was already in the daemon" trap.

### Bonus

- **`Store.getActive` sorts by `updatedAt` desc.** Was taking whichever non-complete session `readdir` returned first — non-deterministic across multiple idle sessions for the same `projectRoot`. Now the most-recently-updated session wins, matching "the session being actively driven" semantic. Helps cross-CC handoffs land on the right session.

## v0.3.48 — 2026-05-07

### Stale MCP adapter detection

Closes the loop on the unbound-state recovery story. Even after the v0.3.43 env-var fix, you could end up with a Claude Code instance running an old MCP subprocess in memory while a newer dist sits on disk — typically when CC's "restart" doesn't actually kill the subprocess. The drawer had no way to surface this; you'd discover it only by symptom (`CLAUDE# UNBOUND`, pokes failing) followed by a `ps -ef | grep mcp-adapter` expedition.

Now:

- **MCP adapter sends `x-pitstop-adapter-version` on every RPC** (new `ADAPTER_VERSION` constant; release script regex bumps it alongside the existing `Server({version: ...})` literal).
- **Daemon reads its own version** from `packages/daemon/package.json` at startup via Bun's native JSON imports.
- **On any RPC where header version != daemon version**, the daemon publishes a one-shot `stale-adapter` SSE event to the project lobby. Deduped per `(projectRoot, adapterVersion)` so a stale subprocess doesn't spam every RPC.
- **Drawer's always-on lobby subscriber** catches it and renders a banner pinned at the top of the drawer:

  > ⚠ MCP adapter is v0.3.42, daemon is v0.3.47 — fully quit Claude Code (Cmd+Q) and relaunch so the new adapter loads.

  Banner is dismissable per drawer mount via a small ×. Reload re-arms.

The daemon-side projectRoot lookup reuses the existing self-heal `store.get` so healthy sessions pay zero extra disk read.

## v0.3.47 — 2026-05-07

Single audit pass over the codebase. One real bug fix, the rest are quality and efficiency wins. No behavior changes outside the named bug.

### Fixes

- **ItemListSheet response precedence (real bug)**: the all-items list sheet had `comment` beating `approve`, so an item the user approved AFTER commenting still showed the comment glyph (`•`) instead of the approval glyph (`✓`). PipStrip had the correct precedence (approve always wins); ItemListSheet now matches.

### Daemon

- **`Store.update` throws `"NOT_FOUND"`** so the `/api/rpc` handler maps missing-session errors cleanly to HTTP 404. Callers (`get_state`, `agent_address_comment`, `set_current_item`, `set_drawer`, `/status` POST) drop their pre-flight `store.get` and let `update` propagate. Item-id validation moves into the updater closure so the session is read exactly once per tool call instead of twice.
- **`armPoke` helper** centralizes the `pokePid` / `pokeSpawnedAt` / `pokeFailed` update + `bus.publish` + `pokeWatch.arm` sequence. Used by resume-from-pause, comment-poke, and retry-poke (was 3 near-identical copies of ~40 lines each). Each caller still owns its `exited.then` cleanup since drain logic differs per site.
- **`appendActivity` helper** for the `agentActivity` ring-buffer cap. Was 5 inline `.slice(-50)` sites with the magic number; now one helper, one constant.
- **`Store.list` parallel reads** via `Promise.all` + skips the redundant per-file `existsSync` (readdir already enumerated them).
- **Lazy `ensureDir`** in `Store` replaces the per-write `mkdir` in `writeAtomic` — one syscall per process instead of one per write.
- **`wire-drawer`'s `detectFramework`** parses `package.json` once per call instead of up to 6× (one per `hasPkgDep` check).

### Drawer

- **`AgentFeed.all` and `Detail.itemAddressed`** wrapped in `createMemo` so `visible` / `olderCount` / `unreadCount` / `markSeen` (and `stripState`) don't recompute the same filter+reverse on every reactive read.
- **`modes.ts` localStorage write batches via `requestAnimationFrame`** — one write per frame instead of one per `pointermove` during a floating-drawer drag.
- **`Footer` / `ReviewSummary` / `UpdateChip`** route through new `client.ts` `patchSessionStatus` / existing `submitResponse` helpers instead of hand-rolling the same `fetch`. Single boundary for HTTP calls from drawer components.

## v0.3.46 — 2026-05-07

### UX

- **Action buttons scroll into view when the lifecycle strip resolves.** The send-side already scrolled `detail-scroll` to bottom on `submitState: idle → sending/poked` so the strip landed in view. The reverse transition — strip resolving back into LOOKS_GOOD / SEND_COMMENT — had no scroll, so if the AgentFeed grew while the strip was up (new narrations during driving) the buttons could land below the visible area and the reviewer had to manually scroll to find them. Now mirrored: `createEffect` watches `stripState`, scrolls to bottom on truthy → null transitions.

## v0.3.45 — 2026-05-07

### MCP

- **`ask_user` steering, repeated where the agent looks.** Previously the "use `ask_user`, never `AskUserQuestion` while a pitstop session is active" rule lived only in `start_review`'s description, which the agent reads once at session creation and forgets hours later. Now the rule is appended to every active-session tool description (`narrate`, `mark_addressing`, `agent_address_comment`, `set_drawer`, `get_unread_responses`) so the steering is wherever the agent's eye lands during a session. The `narrate` description's three-tool comparison matrix (narrate vs mark_addressing vs agent_address_comment) gains `ask_user` as a fourth sibling for "blocking question" use.
- **`start_review` returns `toolsToPreload`.** A small array of `mcp__pitstop__*` names with `ask_user` first. `start_review`'s description gains a numbered step telling the agent to `ToolSearch select:<comma-separated names>` immediately so every pitstop tool is loaded for the session — no per-call ToolSearch latency, and the agent never reaches for `AskUserQuestion` later out of habit.

### UI

- **Drawer reconnects on kill-and-restart, not just complete.** The lobby SSE is now always-on (replacing the v0.3.42 "re-arm only on complete" effect). When a `session-hello` arrives for a different session id and the current session is still active (not complete), the drawer renders a `SessionSwitchPrompt` overlay with **[SWITCH]** / **[STAY]**. Closes the gap where killing the Monitor watcher and starting a new pitstop without `complete_review`'ing the old left the drawer stuck on the prior session indefinitely.
- **Auto-switch after `complete_review` (unchanged).** The prompt only appears in the kill-and-restart-without-completing case — natural completion still hot-swaps without asking.
- **STAY remembers per session id.** Click STAY and that specific incoming session won't re-prompt within this drawer mount (in-memory `Set`, no localStorage so the offer is fresh on every page load). The next *different* session id will prompt again.

## v0.3.44 — 2026-05-07

### UI

- **Removed the slim StatusTag chip for narrating states.** The amber pulsing dot inside an amber-bordered chip in the header drew attention like a notification but rewarded the look with nothing decodable, and the AgentFeed at the bottom was already showing the same narration in plain words. The StatusTag now only renders for `failed` (POKE_FAILED · CLICK_RETRY) and `complete` (REVIEW_COMPLETE) — the feed owns everything else. Dead `tag-slim` / `pulse-dot` CSS rules dropped.

## v0.3.43 — 2026-05-07

### Fixes

- **Pokes actually wake the agent now.** The MCP adapter was reading `process.env.CLAUDE_SESSION_ID` — a variable Claude Code does not set. Every `start_review` since the project began stored `clientSessionId: undefined`, and every poke (auto on user comment, manual via the POKE button, retry on POKE_FAILED) silently threw `"claude-resume requires clientSessionId"` inside the daemon. The adapter now reads `CLAUDE_CODE_SESSION_ID` (with `CLAUDE_SESSION_ID` as a manual-override fallback). Daemon `/api/rpc` also self-heals: existing pre-fix sessions backfill `clientSessionId` on the agent's next tool call, so they don't stay permanently broken.
- **The drawer no longer hides poke failures.** `/retry-poke` non-2xx responses were silently swallowed by `Detail.tsx`'s `onPoke`, leaving the button to flicker without explanation. Failures now surface as an inline `lifecycle-error` chip under the strip (`POKE_FAILED · NO_CLIENT_SESSION_ID`, etc.) for ~6 s.
- **POKE button only on AWAITING.** During the `POKED · WAITING` state the daemon 409s a second `/retry-poke` and the local 5 s debounce makes the button effectively dead — but it was still showing, inviting clicks that did nothing. Now hidden until the strip transitions back to AWAITING CLAUDE.

### UI

- **`CLAUDE#<id>` diagnostic in the metabar.** Right slot of the metabar now shows the bound Claude Code session prefix (e.g. `CLAUDE#7c0d9fd1`). When the bind is missing, it reads `CLAUDE# UNBOUND` in the danger color with a dotted underline — diagnostic-at-a-glance for the failure mode that took the better part of a session to find. Hidden while `UpdateChip` is showing (right-slot swap; the update offer is more time-sensitive).
- **Strip-mode dot turns red when unbound.** The collapsed strip's `v-dot` tints to `--err` so the unpokeable state is still visible while the drawer is minimized.
- **`UpdateChip` popover gains dismiss + Update now.** Small `×` in the top-right of the popover dismisses the chip for the rest of the drawer mount (the `CLAUDE#` chip then takes the slot). New primary `Update now` button posts a directive comment to the session — the existing comment-poke path then asks the bound agent to run `cd <installPath> && git pull && bun run setup` and restart the daemon, so you don't have to context-switch to a shell.

## v0.3.42 — 2026-05-06

### Fixes

- **Drawer auto-reconnects to the next `start_review` after a `complete_review`.** Previously, once a session was completed in the same dev tab, the drawer stayed parked on REVIEW_COMPLETE and a fresh `start_review` for the same `projectRoot` had no subscriber — the only workaround was a tab reload. Two compounding bugs, both fixed:
  - The MCP `start_review` tool now publishes `session-hello` to the per-project lobby (mirroring the `POST /api/sessions` HTTP path). Previously only the per-session bus was notified, so an MCP-driven create was invisible to lobby subscribers.
  - The drawer now re-arms the project lobby SSE the moment its bound session transitions to `complete`, closes the prior session's SSE on receipt of `session-hello`, and resets the cursor to item 0 so a smaller next-session can't land out-of-bounds.

## v0.3.41 — 2026-05-06

### Pip color reflects status, not "active"

The currently-focused pip rendered amber regardless of its actual response state, so an active item that the user had approved (or that the agent had marked addressed) still showed amber + ▸ instead of green ✓ or cyan ↻. That conflated "you are here" with "this one's commented."

Split into two orthogonal axes: the **status color and glyph** come from the response state (approved / agent-addressed / commented / focused / pending), and the **"you are here" marker** is now a separate `.is-active` class that lays an amber underline + bold weight on top. So:

- Active + approved → green ✓ + amber underline
- Active + agent-addressed → cyan ↻ + amber underline
- Active + commented → amber • + amber underline (still amber, but underline disambiguates from "current")
- Active + no response → amber ▸ (still uses `focused`)
- Non-active items unchanged

### POKE feedback

Clicking POKE now triggers the existing POKED · WAITING lifecycle strip (via `flagSent`) so the user sees the click landed, with the elapsed counter restarting from zero. The button stays disabled for ~5 seconds after a successful poke so spam-clicking doesn't stack pokes — `claude --resume` only takes one at a time and subsequent attempts 409 silently anyway. The strip transitions back to AWAITING CLAUDE on the next agent-activity event, exactly as it does after a comment submit.

### REVIEW_COMPLETE side padding

Stats line + buttons were sitting close to the drawer's side borders on narrow widths. Bumped `.review-complete` horizontal padding from 36px to 48px and added `flex-wrap` + `justify-content: center` on `.rc-stats` so the line breaks gracefully on very narrow drawers instead of overflowing.

## v0.3.40 — 2026-05-06

### Update-availability check + chip

- Daemon makes one HTTPS call to `api.github.com/repos/AmmDuncan/pitstop/releases/latest` at startup and caches the result for its lifetime. Skipped entirely when `PITSTOP_DISABLE_UPDATE_CHECK=1` is set in the env.
- New endpoint `GET /api/update-status` returns `{ current, latest, updateAvailable, releaseUrl, installPath, checkedAt, disabled }`.
- Drawer's metabar replaces the dead `T=…` slot with an amber `↑ <version>` chip when an update is available. Click opens a small popover with the pre-filled `cd <installPath> && git pull && bun run setup` command, a Copy button, and a Release notes link. No banner, no nag — chip only appears when there's a new release; otherwise the slot is empty.
- `start_review` also returns the update info as an optional `update: { current, latest, releaseUrl, installPath }` field. The MCP description instructs the agent to offer ONCE at session start ("Pitstop has X.Y.Z out — want me to run the update?") and run via Bash with the standard Claude Code permission gate. Never silent. Don't re-offer mid-review.
- README documents the outbound api.github.com call and the disable flag.

### Floating-mode edge resize handles

Floating drawer now has `edge-left`, `edge-right`, and `edge-bottom` resize handles in addition to the four corners. Top intentionally absent — the header owns that strip as the move handle, and a top-edge resize zone would compete. Matches standard desktop-window behavior.

### Pending-question scroll-into-view

When `ask_user` lands a question banner, the drawer now scrolls the question banner to the top of `.detail-scroll` (block: start, smooth) so the full question is visible — not just the bottom edge.

For floating drawers dragged partially off-screen, `scrollIntoView` alone doesn't help (drawer is `position: fixed`, not in page scroll flow). The mount also nudges `floatingTop` / `floatingLeft` to bring the drawer back into the viewport with a 24px margin, so a question banner is always reachable.

## v0.3.39 — 2026-05-06

### narrate() — conversational beats for the CLAUDE feed

Adds a lightweight MCP tool for ambient feed narrations between other tool calls. No pip flip, no button toggle, no arrival semantics — just the line lands in the feed and flashes briefly so the reviewer parked in the drawer sees you're with them.

Until now agents only landed feed entries via `mark_addressing` (heavy — arrival semantics) and `agent_address_comment` (heavy — pip transition). Everything in between (acknowledgements, reasoning aloud, status beats) happened silently in the chat the reviewer isn't watching. Long stretches of WAITING with no signal that the agent received a comment, agreed with it, and is working on it.

The tool description spells out the four flavors that matter — acknowledgement, reasoning, status, backchannel — with examples, plus the contrast against `mark_addressing` and `agent_address_comment` so agents pick the right tool. Heuristic: *"if you'd say it out loud watching over the reviewer's shoulder, send it to the feed."*

### itemAddressed resets on user comment

The drawer's `itemAddressed()` check (controls AWAITING CLAUDE strip + action button visibility) was a one-shot: once the agent had ever called `mark_addressing(arrived: true)` on an item, the item stayed "addressed" forever — even after the user submitted a fresh comment. In practice: user comments → POKED · WAITING strip drops on the next agent activity → buttons reappear because the original arrival narration is still in `agentActivity` → user can act on a surface the agent hasn't actually re-checked. The flow lied.

`itemAddressed()` now only counts `mark_addressing(arrived: true)` entries that landed AFTER the user's most recent comment on the item. Each user comment puts the item back into "needs re-addressing" state until the agent calls `mark_addressing(arrived: true)` again — the only signal that genuinely means "ready, re-check this surface."

### `agent_address_comment` description rewrite

Tightens the contrast with `narrate()`. `agent_address_comment` is now explicitly the "I've handled it" signal — fix shipped, decided-not-to-act with reason given, or otherwise consciously closed the loop. Early acks ("Got it, looking now") and mid-fix progress beats ("Two ways to fix this; going with grid-rows") belong in `narrate()`. The pip flip carries "considered" semantics; flipping it pre-fix is dishonest. Description walks through narration patterns for fix-shipped vs approval-by-comment vs deferral vs parked-concern, plus the pairing rule with `mark_addressing(arrived: true)` for re-checking.

### Other description tightening

- `get_unread_responses` now states the positive obligation: first move on a comment is a `narrate()` ack beat, before any investigation. Silence reads as ignoring it.
- `mark_addressing` description points at `narrate()` for non-arrival narrations so agents stop overloading mark_addressing for casual reactions.

Daemon-side runtime change for the new `narrate` tool. Existing running daemons will need a restart to surface the new tool to MCP clients.

## v0.3.38 — 2026-05-06

### Daemon-side guardrails for projectRoot mismatch + tool-description fixes

Three structural fixes to keep agents from silently producing dead-ends:

- **start_review detects projectRoot mismatch.** When `/inject.js` hasn't been fetched recently with the exact requested `projectRoot`, the daemon now scans `drawerSeen` for ancestor/descendant paths (`/repo` vs `/repo/apps/shop` is the canonical case). If a related path is found, `drawerStatus.hint` says "projectRoot mismatch likely" with the related paths listed, instead of the generic "drawer not wired" hint that pointed agents at `wire_drawer` even when the drawer was already wired (with a different key).
- **wire_drawer cross-checks active sessions.** If any active session has a different `projectRoot` than the one being wired, a LOUD warning is prepended to the result's `notes` array spelling out the mismatch. Agents calling `wire_drawer({"/repo/apps/shop"})` while a session exists at `/repo` now see the conflict before they edit any files.
- **Next.js `recommended: "committed"`.** Previously `wire_drawer` returned `recommended: "local-only"` for Next.js, but Next.js's local-only option literally says "skip — Next.js has no clean local-only point." Self-defeating. Forced to `committed` for Next.js regardless of the team-repo heuristic.

### Tool-description rewrites

- **`agent_address_comment`** description used to say *"NOT for items the user only approved (no open comment). Skip if there was no comment to address."* Agents read positive comments like *"yes unchanged"* as approval and skipped the call, leaving amber pips stranded as the agent walked past. Rewrote the rule: call after EVERY user comment regardless of tone (narration adapts); skip only after LOOKS_GOOD clicks (pip already green) or when the user hasn't responded yet. Added concrete narration patterns for fix-shipped, approval-by-comment, deferral, and parked-concern.
- **`start_review`'s `projectRoot` field** description now states explicitly that it's the binding key — `wire_drawer` MUST be called with the EXACT same string for the drawer to render the session. Different paths (e.g. `/repo` vs `/repo/apps/shop`) do not match.

### wire_drawer output: Playwright caveat + post-wire next-step (rolled in)

- **Chrome-extension Playwright caveat surfaced in tool output**, not just the README. Both Next.js options now state the agent-driven-vs-human-driven distinction up front, and a framework-conditional note appears in `notes` when the extension is on the table. Agents in agent-browser flows no longer recommend the extension.
- **Wiring ≠ review.** Added a `notes` line saying wiring is setup, not the end of the flow — the next step is `start_review` with actual items, or asking the user what to pitstop if there's nothing concrete yet.

Daemon-side change. Existing running daemons keep the old behavior until restarted.

## v0.3.37 — 2026-05-06

### Fix: empty-state drawer resize was lagging behind cursor

The empty-state aside (`<aside class="drawer pos-right size-standard empty">`) had its class hardcoded and never picked up the `.resizing` modifier that the main session-drawer adds via `interactiveResize()`. So the base `.drawer { transition: width 220ms ease-out }` rule kept lerping on every pointer move, and the drawer rubber-banded behind the cursor while dragging the left edge. Same fix as the main drawer: toggle `.resizing` on the empty-state aside via `classList` so the transition is suppressed during an active drag.

## v0.3.36 — 2026-05-05

### Retire reflow mode

The reflow attempt at "drawer narrows the host page via padding" was honest in intent but couldn't deliver on hosts with any non-trivial CSS. Two structural limitations sank it: `position: fixed` host elements (slideovers, modals, sticky headers) stayed anchored to the viewport and ended up under the drawer; viewport-based `@media` queries didn't fire against the narrowed body, so host CSS still saw the original viewport width and rendered desktop layout in a tablet-width container. v0.3.35 tagged the toggle EXPERIMENTAL and documented host opt-in patterns, but the failure modes were too subtle to live with as a default.

Removing reflow simplifies the model: the drawer either overlays (pinned), floats, or strips. Each failure mode is honest and the workaround is obvious.

**What goes**: `reflow` signal + persistence + `toggleReflow`; the `<html>` body padding effect; `ReflowIcon`; the reflow inline button + kebab item + EXPERIMENTAL tag; the `.reflow-on` class on the drawer; README paragraph documenting the experimental opt-in.

**What stays**: `--pitstop-drawer-width` on `:root` (the var continues to be exposed in case reflow ever returns or hosts find other uses for it); a one-time cleanup of stale html/body padding on script load, so users upgrading from v0.3.35 with `reflow=true` in localStorage don't get stuck with a permanently narrowed host page.

**Reversibility**: tags v0.3.27 through v0.3.35 contain the full reflow implementation. If reflow ever comes back, it's a copy-paste from those tags, not a reimplementation.

## v0.3.35 — 2026-05-05

### Drawer polish: overlay flush, reflow scope, unread pip, typography

- **Overlay-docked goes fully flush.** Drops the 10px top/bottom/outer-edge inset and the 6px rounded corners that v0.3.33 introduced. The inset created a narrow window where host content bled through as letter fragments at the edge of every line of host text — looked broken, not "honest peek." Differentiation from reflow-on is now solely the soft shadow cast inward toward the page. Reflow-on remains shadowless and sharp.
- **Reflow padding moved to `<html>` only.** Setting padding on both `<html>` and `<body>` double-counted whenever the host body had its own `max-width` / `margin: 0 auto` layout — squeezing host content to roughly half its intended width. Single-pad fixes that.
- **Header truncation actually works.** Added `min-width: 0` to `.dheader` so the name-block flex child can shrink past its content min-content, letting the long branch label collapse with `text-overflow: ellipsis` instead of pushing the minimize button past the drawer's right edge. Branch label also gets a `title` attr so the full text shows on hover.
- **Transitions: `ease` → `ease-out`** across width/height changes.
- **Typography pass continued from v0.3.32.** `.qline` (item-level question) is now sans 15px / weight 500, was mono uppercase 11px; `.agent-feed-list` is sans 12.5px, was mono 11.5px. Both are sentence-shaped prose, not labels. Spacing between feed entries bumped 4px → 8px.
- **Floating drawer gets 4px border-radius.** Subtle softening on the only state where the corners actually sit against host page content.
- **Unread feed signal.** When a new agent narration arrives in the feed and the user hasn't seen it yet, a pulsing amber pip + "N NEW" tag appears on the CLAUDE eyebrow. Pulse is a gentle 2s cycle. Cleared on mouse-enter the feed, scroll the list, or click any feed line. Existing entries on first drawer mount are silently marked seen — only post-mount arrivals count as unread.
- **Reflow tagged EXPERIMENTAL.** Bordered tag in the kebab menu; tooltip mentions the two host-side limitations (fixed-positioned elements stay viewport-anchored, viewport-based media queries don't follow the narrowed body). README Limitations section expanded to document both gotchas + the host opt-in pattern (anchor fixed elements to `--pitstop-drawer-width`).

## v0.3.34 — 2026-05-05

### Fix: phantom strip under the footer when AgentFeed is empty

Pin the drawer footer to the last grid track (`grid-row: -2 / -1`) so it stays at the bottom regardless of which siblings render. Previously, when AgentFeed had no entries to show (its `<Show>` rendered nothing), the footer would auto-place into the `auto` row above its intended slot and the absolute-positioned resize handle would land in the trailing 42px row, leaving a visible empty strip under the footer.

One-line CSS fix; no behavior change when AgentFeed is present.

## v0.3.33 — 2026-05-05

### Drawer chrome v2 — reflow, padlock, kebab

- **Reflow mode**: when pinned, the drawer can push the host page (body+html padding referencing `--pitstop-drawer-width`) so content reflows around it instead of being overlaid. Off by default; toggle from the kebab. Strip mode opts out automatically.
- **Visual differentiation between docked modes**:
  - Pinned + overlay (default) → ~10px inset on top/bottom/outer-edge, 6px rounded corners, soft shadow. Reads as "I'm hovering at the side."
  - Pinned + reflow on → flush to viewport edge, sharp corner, no shadow. Reads as "I'm part of the layout."
  - Floating unchanged.
- **Chrome reorder + padlock**: drops the v0.3.27 Side+Float segmented pair. Position toggle (`PanelLeft`/`PanelRight`) and padlock (`Lock`/`LockOpen`) are now distinct controls and sit adjacent so they read as one anchoring group. Position toggle hides while floating.
- **Kebab overflow** (`EllipsisVertical` — vertical 3 dots, not meatballs): reflow + theme + help collapse into the kebab when the header is narrow (< 440px) or in compact size mode. ResizeObserver drives the threshold; items hop back inline as the drawer widens.
- **`--pitstop-drawer-width`** is exposed on `:root` so host pages can anchor sticky/fixed elements when reflow is on. Host responsibility — pitstop won't magic-fix every host's stickies.

## v0.3.32 — 2026-05-05

### Changed
- **Pip-strip focused state** is now an amber underline (3px rule along the bottom edge) instead of a raised panel + amber glyph. Quieter, doesn't compete with the amber `commented` color, reads as "you are here" via a structural cue rather than re-coloring the body of the pip.
- **Question typography** in the `ask_user` banner: bumped 14px → 15px and reaffirmed sans prose. Mono uppercase stays where it belongs (the eyebrow `[?] CLAUDE_NEEDS_INPUT`); the question itself reads as a sentence, not metadata.
- **Comment textarea placeholder** is now sans 13.5px matching the typed text, instead of mono 12px. No font swap on first keystroke; longer placeholder copy stays readable. The rule going forward: mono only for short structural strings (eyebrows, kbd glyphs, status pills); sans for anything sentence-shaped.
- **AgentFeed older lines** sit at `opacity: 0.85` on top of their existing `--t2` color, widening the contrast with the rank-0 newest line without making older entries unreadable.
- **Header counter** drops the `_SKIPPED` suffix. The information is already surfaced via the pip strip (amber `•` glyphs ARE the skipped items), the ReviewSummary screen, and the ReviewComplete terminal page. Counter becomes plain `current / total`.
- **StatusTag is hidden in the header** when `session.status === 'complete'`. The new ReviewComplete screen already announces it; the header pill duplicated the signal and got awkwardly cropped at narrow widths.

### Added
- **STATUS group** at the top of the keymap overlay (`?`). Color → name legend covering the four content states (`APPROVED`, `AGENT_ADDRESSED`, `COMMENTED`, `PENDING`). FOCUSED is intentionally not legended — it's a navigation state, not a content state, and the underline is plainly visible on the strip itself. Sits above NAVIGATION so the most foundational reference content is the first thing a confused user sees.

### Fixed
- **Resize-handle drag was rubber-banding** behind the cursor because the v0.3.31 `.drawer { transition: width/height }` rule applied to every per-frame pointer delta. New `.drawer.resizing` class (toggled by `ResizeHandle` for the duration of an active drag) suppresses the transition. Snap during drag, smooth lerp on programmatic size changes — best of both.

## v0.3.31 — 2026-05-05

### Added
- `data-pitstop="drawer"` attribute on the drawer host so blocked-click error inspection (Playwright, agent-browser, etc.) can identify the obscuring element specifically.
- `set_drawer` MCP tool. Agent flips drawer position (right/left/floating) and/or size (standard/compact/strip) — most useful when its own click is being blocked by the drawer. Required `narration` lands in the AgentFeed so the chrome shift is explained, not surprising.
- `agent_address_comment` MCP tool. Agent reports it has fixed a user comment on an item before moving on. Pip strip gets a new color (cyan-teal `↻`) distinct from approved (green) and commented (amber); the user retains the final approval gate. Footer's `_QUEUED` count excludes agent-addressed items, so the visible "still queued for the agent" number drops as expected.
- CSS transitions (220ms ease) on `.drawer` width/height so size cycles (standard ↔ compact) and strip collapses feel intentional instead of jumpy. Position flip stays instantaneous — animating between `right: 0` and `left: 0` doesn't lerp cleanly.

### Changed
- `ask_user` tool description strengthened: when calling `ask_user`, the agent must ALSO render the full question + every option (label + description) as readable text in its chat reply. The chat is canonical history; the drawer is one surface, not the only one. A one-line "asking via drawer" teaser is no longer enough.
- `/api/sessions/:id/retry-poke` (used by the POKE button) was changed in v0.3.30 to always poke; v0.3.31 documents the context-adapting behavior.

### Fixed
- `release.ts` now syncs the MCP `Server({ name: "pitstop", version })` literal in lockstep with package.json bumps, so `claude mcp list` no longer shows a stale version tag (it had been stuck at 0.3.27 across v0.3.28–v0.3.30 because the release script wasn't touching that string).

## v0.3.30 — 2026-05-05

### Added
- POKE button on the lifecycle strip. While `AWAITING CLAUDE` or `POKED · WAITING` is up, the user can now click POKE to re-engage Claude — useful when the agent appears stuck. Strip also shows a live elapsed counter (`mm:ss`) so the wait time is visible at a glance.

### Changed
- `/api/sessions/:id/retry-poke` no longer no-ops when there are no unread comments. The endpoint now always pokes; the context adapts ("N comments pending" vs "user-initiated nudge, read `get_state` and continue") so Claude knows whether it's catching up on feedback or just being asked to resume.

## v0.3.29 — 2026-05-05

### Fixed
- Drawer mounted before `start_review` no longer needs a manual reload. Until now the headline workflow ("agent calls `start_review` → drawer pops up in your already-open dev tab") didn't actually work in script-tag mode — the drawer never opened any SSE connection while it had no session, so the daemon had no one to notify when one was created. Reviewers had to refresh after every `start_review`.

### Added
- Project-scoped lobby SSE channel. The bus now keeps a parallel `byProject` map alongside `byId`. A new `GET /api/projects/events?projectRoot=…` endpoint opens a "lobby" connection scoped to a projectRoot. `POST /api/sessions` publishes a `session-hello` event on the matching project channel after creating the session.
- Drawer in script-tag mode subscribes to the lobby while it has no session. On `session-hello`, it re-runs bootstrap (now finds the session, opens the per-session SSE), and closes the lobby connection. Latency is ~RTT instead of the 12s polling the extension-mode path uses.

### Notes
- Multi-worktree workflows benefit directly: each worktree has its own absolute path, so each gets its own project channel and each drawer reacts independently to its own agent's `start_review`.
- After a tab graduates from lobby → per-session, it stops listening for *future* sessions on that projectRoot. Reopening the lobby when `session.status === 'complete'` is a deferred enhancement.

## v0.3.28 — 2026-05-05

### Fixed
- `bun run setup` silently no-op'd the inject build on Bun 1.3.13 because `bun --cwd <dir> run <script>` is misparsed (Bun lists scripts and exits 0 instead of running). Switched to `bun run --cwd <dir> <script>` and added `existsSync` checks so the script fails loudly if a dist file is missing.
- Daemon's `/inject.js` route returned Bun's HTML error fallback as `application/javascript` when the bundle was missing, so the drawer would silently fail to mount. Now returns 503 + plaintext with a hint to run `bun run setup`.
- Empty-state drawer (no active session) had no width resize handle. Added the `edge-left` handle so the drawer is squeezable in either state.

### Added
- `CHANGELOG.md` backfilled across all releases. Every tag now has a matching entry on the GitHub releases page.
- `bun run release` auto-drafts a CHANGELOG section from commit subjects since the last tag, opens it in `$EDITOR` for review, prepends to `CHANGELOG.md`, and creates a matching GitHub release after the tag push.

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
