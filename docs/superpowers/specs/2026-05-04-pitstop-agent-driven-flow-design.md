# Pitstop · Agent-Driven Flow

**Date:** 2026-05-04
**Status:** Design (pending user review)
**Scope:** v0.2 architectural pivot — turn pitstop from a static review queue into a guided tour where the agent drives the user to each surface in their app.

---

## 1. Goal

Today, pitstop's drawer presents text descriptions of items the agent reviewed. The user reads, presses a key, advances. The drawer doesn't know what the host app *is* — only that there are N things to look at.

The intended experience is different: every item is anchored to a surface in the host app, and the act of reviewing an item happens *on that surface*. Pressing `looks_good` doesn't just mark the queue — it advances the user (or has the agent advance the user) to the next surface, so verification and review happen in place.

The drawer is the cursor in the user's app. The agent is the one moving the cursor and driving the user's tab to match. Pitstop becomes a guided walkthrough machine, not a reading list.

### Why this matters (the soul of pitstop)

Agents can smoke-test their own implementations. But that's not the same as a human looking. Humans catch things agents miss — UX feel, taste calls, off-by-one visual bugs, "this technically works but it's wrong" judgements that don't surface in the agent's own reasoning. Pitstop exists because there's no replacement for the human actually seeing the surface.

The job of pitstop is to make that human review process *easier and more friendly* — to lower the friction of "ok, but did I actually look at all of this?" The agent doing the navigation is what makes it friendly: instead of the human chasing down every change in their app, the agent takes them on a tour. The human's job becomes *seeing*, not *finding*.

This is why the agent must drive. A static review queue is a checklist of things the agent thinks the human should look at. A driven review is the agent showing the human each surface in context, in order, with the work right in front of them. That's the difference pitstop is reaching for.

## 2. Substrate Assumptions

The agent is the driver. Always. This spec assumes the agent has *some* browser-driving toolbelt at its disposal that targets the same browser instance the user is reviewing in. Concrete options the user might pick:

- **Claude in Chrome** — drives the user's actual Chrome tabs via `mcp__claude-in-chrome__*` tools.
- **`agent-browser`** — Playwright-managed Chrome instance launched in `--headed` mode that the user uses as their dev-app browser; the agent drives via the `agent-browser` CLI / MCP.
- **Any future equivalent** — the drawer doesn't care what the toolbelt is called.

**The drawer is agnostic about which toolbelt the agent uses.** It sends responses to the daemon, it renders daemon state, that's it. No drawer code references any specific MCP tool, no daemon endpoint encodes a browser-driving choice. The agent picks based on what's installed in its session and what the user prefers, and the picking is invisible to everything below the agent.

The toolbelt is a *deployment* choice, not a *design* choice. Pitstop's design doesn't change based on which one is installed; it only requires that one exists.

## 3. Architecture Pivot

Three things change in the existing model:

| Layer | Before | After |
|---|---|---|
| **Drawer** | Sometimes auto-advances; could (in proposals) push routes to host app | Pure observer of daemon state. Sends responses out, renders state in. Never navigates the host app. |
| **Agent** | Reactive — wakes only on user prompt or daemon-spawned subprocess | Authoritative cursor. Decides which item is next, drives the user's tab, updates drawer state. |
| **Heartbeat** | None — agent only listens when in a turn | `Monitor` watches the daemon's response queue; each new response wakes the live agent in this conversation as a chat-level notification. |

The "two paths" framing (live MCP vs `claude --resume` daemon spawn) collapses: live is the only path that matters in active sessions. The daemon-spawn fallback survives only for offline sessions.

## 4. Item Shape

Items stay minimal. No `path`, no structured navigation steps. The agent decides where to take the user from its own knowledge of the work.

```ts
type Item = {
  id: string;
  title: string;
  body: string;
  question?: string;
  attachments: Attachment[];
  /**
   * Optional free-form note to self. The agent may stash a navigation hint
   * here as a hedge against context loss (compaction, session restart).
   * The drawer never reads or acts on this. The agent is free to ignore it
   * if its current memory is sufficient.
   */
  nav?: string;
};
```

`nav` is invisible to the drawer. It exists solely so the agent can recover its driving context across context-window pressure.

## 5. Drawer Behaviour Rules

The drawer makes two decisions per user action: where the cursor goes, and what the pill says.

| User action | Drawer cursor | Drawer pill cycle |
|---|---|---|
| `⏎` (looks_good) | Advances locally to `currentItemIdx + 1` (next index, not "next without an addressed response"). Agent confirms via `set_current_item(N+1)` (no flicker if it agrees) or overrides with `set_current_item(M)`. | `SENDING → POKED_CLAUDE · WAITING → DRIVING_TO · <step> → idle`. Even approves fire the pill cycle — the user must always see that the agent is cooking. |
| `⌘⏎` (send_comment) | Stays put. Cursor only moves when the agent calls `set_current_item`, or the user moves it manually. | `SENDING → POKED_CLAUDE · WAITING → ADDRESSING · <narration> → idle`. |
| `j/k` or pip click | User-driven nav. Drawer follows. Agent's later `set_current_item` may or may not align — drawer respects the agent. | No pill change (user-only action; agent isn't doing anything). |

The rule is: drawer trusts itself for closure-shaped cursor moves (approve, manual nav). Drawer waits for the agent on dialogue-shaped cursor moves (comment). **The pill always reflects whether the agent is actively cooking, regardless of action kind** — the user should never be left wondering whether their approve registered or whether the agent is doing anything about it.

## 6. MCP Tool Surface

Six existing tools, plus one new.

| Tool | Status | Purpose |
|---|---|---|
| `start_review(items)` | existing (extended return) | Open a session with N items. **New:** the result now includes a `watcher` block with the exact `Monitor` parameters the agent should run next. See section 8. |
| `add_items(items)` | existing | Append items mid-review. |
| `complete_review()` | existing | Terminal — drawer flips to REVIEW_COMPLETE. |
| `get_state()` | existing | Read everything. |
| `get_unread_responses()` | existing | Drain unaddressed responses. |
| `mark_addressing(itemId, narration)` | existing | Pill narration update. |
| **`set_current_item({ sessionId, itemId })`** | **new** | Move the drawer's focused item. The agent calls this after navigating the user's tab to the next surface. Daemon validates `itemId` exists in `session.items` and rejects unknown IDs (so a stale agent context can't desync the drawer). |

`set_current_item` is the only addition. It writes `currentItemId` to the session, broadcasts `state-changed`, drawer rebases its cursor to the agent's choice.

## 7. Daemon Changes

Two small endpoints to add or refine:

1. **`GET /api/sessions/:id/responses?since=<ms>&unaddressed=true`** — incremental fetch for the Monitor script. Returns responses with `at > since` and `addressed === false`, in `at`-ascending order. Without this, the Monitor script would re-fetch the whole queue each tick.
2. **`POST /api/sessions/:id/current-item`** with body `{ itemId }` — the daemon endpoint backing `set_current_item`. Stores `currentItemId` on the session and triggers a `state-changed` SSE broadcast.

Plus a session-state field:

```ts
type Session = {
  ...
  currentItemId?: string;  // set by mcp.set_current_item, mirrored in SSE
};
```

The drawer uses `session.currentItemId` (when present) as the source of truth for which item to render in the detail pane and highlight in the pip strip — overriding any local optimistic advance.

## 8. Monitor Script — the Live Heartbeat

`Monitor` (Claude Code's existing tool) gives us the missing external trigger. Each line the script emits to stdout becomes a notification to the live agent in the conversation, on its own schedule, independent of user typing.

The script polls the daemon's incremental responses endpoint and emits one line per new unaddressed response.

```bash
#!/usr/bin/env bash
# pitstop-watch.sh — watcher for Monitor.
# Usage: pitstop-watch.sh <sessionId>
set -uo pipefail

SID="${1:?sessionId required}"
HOST="${PITSTOP_HOST:-http://localhost:7773}"
LAST=0

while true; do
  RESP=$(curl -sf "$HOST/api/sessions/$SID/responses?since=$LAST&unaddressed=true" 2>/dev/null || echo '[]')
  echo "$RESP" | jq -c '.[]?' 2>/dev/null | while IFS= read -r line; do
    printf '%s\n' "$line"
  done
  LAST_NEW=$(echo "$RESP" | jq -r 'map(.at) | max // empty' 2>/dev/null)
  [ -n "$LAST_NEW" ] && LAST=$LAST_NEW
  sleep 1
done
```

The agent invokes `Monitor` once at the start of a review session, **using the parameters returned by `start_review`'s result**:

```ts
// start_review's response shape (extended for v0.2):
{
  sessionId: "tlXpwmMZ",
  url: "http://localhost:7773/?session=tlXpwmMZ",
  watcher: {
    command: "/path/to/pitstop-watch.sh tlXpwmMZ",
    description: "pitstop unread responses · session tlXpwmMZ",
    persistent: true
  }
}
```

The agent's prompt template instruction is: *after `start_review`, if the result includes a `watcher` field, invoke `Monitor` with exactly those parameters.* No protocol gymnastics, no forgotten step. The mcp-adapter is the only thing that knows how to compute the watcher command (it knows the script path and sessionId); the daemon stays neutral.

Why not have the daemon spawn the watcher? Because `Monitor` delivers events only to the agent that invoked it. A daemon-spawned watcher would be orphaned — its stdout would have no destination. The agent must be the one to start `Monitor`.

`add_items` and other tools don't need to return a `watcher` — once started, the watcher stays live for the session.

Latency is ~1s. Sub-second is achievable by switching to SSE if we add a `response-added` event to the daemon — out of scope for v1 of this spec but noted as a future optimisation.

## 9. UserPromptSubmit Hook — Bonus Heartbeat

The hook exists for the case where the user *is* typing in the CLI and pitstop has unread context the agent should see anyway. It fires before the agent reads the user's prompt and emits supplementary context.

`~/.claude/settings.json`:
```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{ "type": "command", "command": "/path/to/pitstop-context.sh" }]
    }]
  }
}
```

`pitstop-context.sh`:
```bash
#!/usr/bin/env bash
SID=$(curl -sf "http://localhost:7773/api/sessions/active?projectRoot=$PWD" | jq -r '.id // empty')
[ -z "$SID" ] && exit 0
UNREAD=$(curl -sf "http://localhost:7773/api/sessions/$SID/responses?unaddressed=true")
[ "$UNREAD" != "[]" ] && [ -n "$UNREAD" ] && echo "[pitstop unread]: $UNREAD"
exit 0
```

Costs nothing per turn (no extra agent invocation; just enriches the prompt the agent was already going to receive). Always-on once installed.

The hook is **read-only** — it does not flip `addressed: true` on any response. Responses remain in the unread queue until the agent calls `get_unread_responses` in its turn (which is the only place that atomically marks them addressed). So a comment that arrives while the user types two prompts in a row will appear in both prompts' hook output until the agent properly drains it via MCP. That's by design: the hook surfaces context, the agent decides when to consume.

## 10. claude --resume Fallback

Stays in place for offline sessions. When the user's interactive session is closed, the daemon's spawn is the only way to wake an agent at all. In active sessions, the spawn is best-effort and usually no-ops — the README will frame it as the offline fallback rather than the primary mechanism.

The existing daemon poke logic (`packages/daemon/src/poke/claude-resume.ts`) is untouched by this spec. No code changes required here; only documentation.

## 11. Drawer Pill State (revised)

The pill states stay the same; the meanings shift slightly:

| Pill | Trigger |
|---|---|
| `SENDING…` | Drawer's POST in flight |
| `POKED_CLAUDE · WAITING` | POST returned, agent has not yet read |
| `ADDRESSING · <narration>` | Agent called `mark_addressing` |
| `WRITING_ITEMS` | Agent called `add_items` mid-review |
| `DRIVING_TO · <step>` (new wording) | Agent is mid-navigation via whatever browser-driving toolbelt it has |
| `POKE_FAILED · CLICK_RETRY` | Daemon spawn errored (rare) |
| `REVIEW_COMPLETE` | Agent called `complete_review` |

`DRIVING_TO` is just `mark_addressing` with a particular narration shape. No new pill state class — agent provides narration like `"Driving to /drivers-vehicles › Suspensions › row 4"`.

## 12. The Magic Flow, end-to-end

1. User asks Claude to "start a pitstop review of [the work]."
2. Claude calls `start_review` with N items (no `nav` needed unless the agent chooses to stash one as a hedge).
3. Daemon stores the session, broadcasts `state-snapshot`, drawer paints.
4. **Claude reads the `watcher` block from `start_review`'s result and invokes `Monitor` with exactly those parameters (`persistent: true`).** This is the heartbeat. It will tick on every drawer click going forward.
5. Claude navigates the user's browser to item 0's surface using whatever browser-driving toolbelt it has loaded (Claude in Chrome, agent-browser, etc.) — `navigate`, `find`, `click`, etc. for any deep state. Calls `set_current_item(0)` and `mark_addressing(0, "Showing you …")`. Drawer renders item 0 in detail pane.
6. User reviews item 0 on the actual surface. Presses `⏎`.
7. Drawer locally advances cursor to item 1 (optimistic). Drawer POSTs `kind: 'approve'`. Drawer pill flips `SENDING → POKED_CLAUDE · WAITING` so the user sees their approve registered and the agent is on it.
8. Daemon stores response. Monitor's script picks it up within 1s, emits a stdout line. Agent gets a notification mid-conversation.
9. Agent calls `get_unread_responses`, sees the approve, decides item 1 is next. Drives the user's tab to item 1's surface. While driving, agent calls `mark_addressing(0, "Driving to <step>")` so the pill flips to `DRIVING_TO · <step>`. After landing, agent calls `set_current_item(1)` (confirms drawer's optimistic advance). Pill clears to idle.
10. User reviews item 1. Maybe presses `c`, types a comment, `⌘⏎`.
11. Drawer POSTs `kind: 'comment', body`. Drawer cursor stays on item 1. Pill flips through `SENDING → POKED → …`.
12. Monitor wakes the agent. Agent reads the comment, decides how to address (write code, ask follow-up, add a child item via `add_items`, navigate elsewhere, etc.). Calls `mark_addressing(1, "<doing X>")`.
13. Agent's response navigates the user to the right surface (could be the same item 1 surface if it's continuing dialogue, could be a new item via `add_items`). Calls `set_current_item` if focus should shift.
14. Repeat. When done, agent calls `complete_review`. Pill flips green.

> **User-initiated termination:** the drawer's existing `DONE` button (footer) hits a daemon endpoint that flips the session to `complete` directly — no agent involvement required. This stays unchanged. Both paths converge on `status: complete`.

## 13. Setup

A user's first time using agent-driven mode does:

1. Make sure the agent has *some* browser-driving toolbelt available — Claude in Chrome, `agent-browser`, or equivalent. This is a one-time MCP/setup choice; pitstop doesn't pin one over the other.
2. Add the `UserPromptSubmit` hook to `~/.claude/settings.json` (one-time).
3. In the user's dev app, ensure the pitstop drawer's `<script>` tag is wired (existing requirement). The dev app must be open in the same browser the agent's toolbelt drives — Chrome (for Claude in Chrome), or the agent-browser-launched Chrome instance, etc.
4. Per-session: tell Claude "review the work and drive me through it" (the prompt may want to nudge which toolbelt to use if both are loaded). Claude starts `Monitor` and runs the loop.

No `/loop` setup needed. Monitor is the heartbeat.

## 14. Out of Scope (for v1 of this spec)

- **`response-added` SSE event** for sub-second Monitor latency. Today's polling at 1s is good enough.
- **Per-item agent-recorded navigation trail** (Tier 3 from the brainstorm). Future work — would require the agent to instrument itself during the original work session.
- **Drawer `kind: 'navigate'` response** as a separate type. The MVP design uses the existing approve/comment kinds; the agent infers the next surface from the item itself plus its own memory. A `navigate` kind for "user wants to be driven to item N without approving or commenting" is a possible v0.3 add for skipping ahead.
- **Multi-tab scenarios** (user has multiple Chrome tabs of the dev app, agent has to pick which to drive). Out of scope; assume single tab in scope.
- **Conflict resolution between local-optimistic advance and agent override** beyond simple "agent wins." If this proves visually jarring, a "rebasing" animation can be added later.
- **Authentication / multi-user** scenarios for the daemon. Single-user, single-machine assumed.

## 15. Implementation Phases

Three phases, each independently shippable:

**Phase A — daemon + drawer foundations** (no agent changes yet):
- Daemon: add `?since=<ms>&unaddressed=true` filter to responses endpoint.
- Daemon: add `currentItemId` field to session, `POST /current-item` endpoint, broadcast `state-changed` on update.
- Drawer: render `session.currentItemId` as the source-of-truth focus, falling back to local cursor when absent. Optimistic advance on approve; no advance on comment.
- **Drawer: pill cycles fire on BOTH approve and comment.** Today only `onComment` calls `setSubmitState('sending')` / `flagSent()`. `onApprove` (in `Detail.tsx`) needs the same lifecycle so the user always sees the agent is cooking. Approve's pill clears when an `agent-activity` event arrives (same as comment); the cursor advance is independent of pill state.
- Drawer: pill labels (no new states needed — `mark_addressing` carries `DRIVING_TO …` narration).

**Phase B — MCP + scripts**:
- mcp-adapter: add `set_current_item` tool, forwarding to `POST /current-item`.
- mcp-adapter: extend `start_review`'s return to include the `watcher` block (script path, description, `persistent: true`). The adapter knows the absolute path to `pitstop-watch.sh` (resolved at adapter install time).
- Ship `pitstop-watch.sh` and `pitstop-context.sh` in `packages/scripts/` (or wherever's idiomatic).
- README section: "agent-driven mode" with setup instructions — toolbelt-neutral (Claude in Chrome OR agent-browser OR equivalent), hook install, `Monitor` invocation pattern. Do not pin a specific browser-driving MCP in the README.

**Phase C — agent prompt template**:
- Document the prompt shape the user gives Claude to start an agent-driven review (e.g., "review and drive me through these items").
- The prompt should instruct the agent to: call `start_review`, then immediately invoke `Monitor` with the parameters from the returned `watcher` block, then navigate to item 0 using whichever browser-driving toolbelt is available, call `set_current_item`, call `mark_addressing`, and repeat on each notification.
- The template is toolbelt-neutral — it doesn't pin Claude in Chrome over agent-browser. The agent inspects which MCPs are loaded and picks. If both are loaded, the user can nudge a choice in the prompt.
- This isn't code — it's documentation in the README's quickstart so the user knows what to ask Claude.

Phase A is foundation. Phase B is wiring. Phase C is operational instruction. Each gets its own implementation plan via writing-plans skill.
