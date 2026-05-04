# pitstop

A drawer in your dev app where the agent leaves you items to review. You answer with one keystroke. The agent acts on your answers — driving your browser tab through each surface, in order, with the work right in front of you.

> Agents can smoke-test their own implementations. But that's not the same as a human looking. Humans catch UX feel, taste calls, off-by-one visual bugs, "technically works but wrong" judgements that don't surface in agent reasoning. Pitstop's job is to make the *human* review process easier and friendlier — and the agent driving the tour is what makes it friendly.

## What it is

Four pieces:

- **drawer** — a custom element with Shadow DOM that mounts in your dev app's browser. Renders items, takes keystrokes, sends responses to the daemon, updates live via SSE.
- **daemon** — tiny HTTP server on `:7773`. Holds session state, serves `inject.js`, broadcasts SSE updates.
- **mcp-adapter** — stdio bridge Claude Code spawns per session. Exposes 7 MCP tools.
- **agent (Claude)** — drives your tab through each surface. Reads your drawer responses via MCP. Updates the drawer cursor as it goes.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- [Claude Code](https://claude.com/claude-code) (the CLI)
- A dev app to review work in (any framework that can host one `<script>` tag)
- `curl` and `jq` (for the watcher and hook scripts)
- A browser-driving toolbelt for Claude — **either** [Claude in Chrome](https://www.anthropic.com/claude-in-chrome) (drives your real Chrome tabs) **or** [agent-browser](https://www.npmjs.com/package/agent-browser) (Playwright-managed Chrome you run headed). Pitstop is toolbelt-neutral; pick whichever fits your setup.

## Install

### 1. Clone and install

```bash
git clone https://github.com/AmmDuncan/pitstop.git ~/pitstop
cd ~/pitstop
bun install
```

### 2. Build the mcp-adapter dist

```bash
bun build packages/mcp-adapter/src/index.ts --outfile packages/mcp-adapter/dist/index.js --target=node --format=esm
```

Pinned to `--target=node` deliberately — Claude Code's MCP plumbing has issues with bun-targeted builds in some versions.

### 3. Register the MCP adapter with Claude Code

Open `~/.claude.json`. Find the top-level `"mcpServers"` key (create it as `{}` if it doesn't exist) and add:

```json
"pitstop": {
  "type": "stdio",
  "command": "node",
  "args": ["/Users/YOU/pitstop/packages/mcp-adapter/dist/index.js"]
}
```

Use an absolute path. Replace `/Users/YOU/pitstop` with where you cloned.

Restart Claude Code, then verify:

```bash
claude mcp list | grep pitstop
# pitstop: node /Users/YOU/pitstop/... - ✓ Connected
```

### 4. Wire the drawer into your dev app

The drawer needs one `<script>` tag in your dev app's HTML during dev. Tell your agent:

> *"Set up the pitstop drawer in this project."*

The agent will pick the right file for your stack and add this tag (or its equivalent for your framework):

```html
<script src="http://localhost:7773/inject.js?pitstop-project=<absolute-project-path>" defer></script>
```

The script reads its own URL's `?pitstop-project=` query param to know which session to bind to. Vite, Nuxt, Next.js, SvelteKit, Astro, plain HTML — wherever the tag fits.

### 5. Install the UserPromptSubmit hook

This makes pitstop responses visible to Claude on every prompt you type, so the agent stays current with your drawer state without you having to ask.

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "/Users/YOU/pitstop/packages/scripts/pitstop-context.sh"
      }]
    }]
  }
}
```

The hook is read-only — it surfaces unread responses without consuming them. The agent calls `get_unread_responses` to atomically drain the queue.

## Running a review

Once installed, here's what you type to start a driven review:

> *"Start a pitstop review of [the work]. Drive me through each item using whichever browser-driving MCP you have loaded (Claude in Chrome or agent-browser). After `start_review`, invoke `Monitor` with the parameters in the returned `watcher` block. On each notification, call `get_unread_responses`, navigate me to the relevant surface, then `set_current_item` and `mark_addressing`."*

You can shorten this once Claude has done it a few times — it learns the pattern.

What happens:

1. Claude calls `start_review` with the items it wants you to look at. The drawer paints; the daemon returns a `watcher` block.
2. Claude immediately invokes `Monitor` with that `watcher` (live heartbeat — fires whenever you click in the drawer).
3. Claude navigates your tab to item 0 using its browser-driving toolbelt, calls `set_current_item(0)` and `mark_addressing(0, "...")`. Drawer pill: `ADDRESSING · ...`.
4. You review item 0 on its actual surface. Press `⏎` to approve, or `c` then comment then `⌘⏎`.
5. Drawer pill flips `SENDING…` → `POKED_CLAUDE · WAITING`. The watcher emits a stdout line. Claude wakes up here, drains responses via `get_unread_responses`, drives your tab to the next surface, repeat.
6. When done, `complete_review` flips the pill green. Or click `DONE` in the drawer footer.

## Authoring items

Each item is a tiny handoff document the reviewer reads on the surface where the change lives. Thin items waste the round-trip; rich items pay back tenfold. Pitstop's MCP tool descriptions bake the convention in — your agent will follow it without you having to ask — but the shape, for reference:

| Field | What goes here |
|---|---|
| `title` | Short, scannable headline (~6 words). |
| `body` | **Why** this changed. 1–3 sentences, markdown allowed. Not a recap of the diff. |
| `lookFor` | `string[]` — UX/visual things the reviewer should specifically watch for. |
| `tested` | `string[]` — what the agent already exercised, so the reviewer doesn't repeat work. |
| `concerns` | `string[]` — open trade-offs the agent is unsure about. |
| `question` | The single decision the reviewer is being asked. One sentence, ends in `?`. |

Worked example:

```json
{
  "id": "01",
  "title": "Wizard split into section components",
  "body": "Each step used to live in a single 600-line `SuspensionWizard.vue`. Extracted per-step components (`BasicInfoStep`, `IdentityStep`, `ContactStep`, …) so each section is independently navigable and testable. No behaviour change.",
  "lookFor": [
    "Step transitions feel snappy — no flash of empty content between steps.",
    "Focus lands on the first input of each step on mount.",
    "Header progress bar advances cleanly; the step number matches the heading."
  ],
  "tested": [
    "Happy path: filled all steps, hit Submit, saw the success modal.",
    "Back-button mid-wizard preserves entered data.",
    "Tabbed through with keyboard only — no traps."
  ],
  "concerns": [
    "Used `provide`/`inject` for cross-step shared state; could be a Pinia store instead. Open to either."
  ],
  "question": "Does the per-step component cut feel right, or would you rather a single wizard file with computed sections?"
}
```

Lists beat prose. One bullet per thing beats a paragraph.

## MCP tools

The agent has 7 tools:

| Setup | Conversation |
|---|---|
| `start_review(items)` — open session; returns `watcher` for Monitor | `get_state()` — read everything |
| `add_items(items)` — append items mid-review | `get_unread_responses()` — drain unread queue (atomic) |
| `complete_review()` — terminal | `mark_addressing(itemId, narration)` — pill update |
| | `set_current_item(itemId)` — move drawer cursor |

## Architecture

See `docs/superpowers/specs/2026-05-04-pitstop-agent-driven-flow-design.md` for the full architecture.

Briefly:

- Drawer is agent-passive. It sends responses, renders state, never navigates.
- Agent is the cursor. It decides what's next and drives via the browser toolbelt.
- `Monitor` (started once at session top) is the live heartbeat. Each new drawer response wakes the agent in this conversation as a chat-level notification.
- UserPromptSubmit hook covers the case where you happen to be typing.

## Repo layout

```
packages/
  daemon/        — HTTP server, session store, /inject.js, SSE broadcaster
  mcp-adapter/   — stdio↔HTTP bridge that Claude Code spawns
  inject/        — Solid.js drawer (Shadow DOM); pre-built into dist/
  scripts/       — pitstop-context.sh (hook), pitstop-watch.sh (watcher)
  shared/        — types and zod schemas
docs/            — design brief, specs, plans
```

## Limitations

- The daemon-spawned `claude --resume` is a fallback for offline sessions. It often no-ops in active sessions; that's expected. The live MCP path is the load-bearing one.
- Single-tab assumption. Multi-tab handling is out of scope for v0.2.
- The drawer's `kind: 'navigate'` skip-ahead response is not implemented yet. Approves and comments are the only response kinds.

## Development

The repo is a Bun monorepo. Tests:

```bash
bun --cwd packages/daemon test
```

Build inject bundle:

```bash
bun --cwd packages/inject run build
```

Build mcp-adapter (after edits):

```bash
bun build packages/mcp-adapter/src/index.ts --outfile packages/mcp-adapter/dist/index.js --target=node --format=esm
```

## License

MIT.
