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

### 1. Clone, install, set up

```bash
git clone https://github.com/AmmDuncan/pitstop.git ~/pitstop
cd ~/pitstop
bun install
bun run setup
```

`bun run setup` builds both bundles, registers the MCP adapter in `~/.claude.json`, and installs the `UserPromptSubmit` hook in `~/.claude/settings.json`. Idempotent — safe to re-run after a `git pull`. Edits are dedup-aware; existing config in those files is preserved.

### 2. Restart Claude Code

So it loads the freshly registered MCP server. Verify:

```bash
claude mcp list | grep pitstop
# pitstop: node /Users/YOU/pitstop/packages/mcp-adapter/dist/index.js - ✓ Connected
```

### 3. Wire the drawer into your dev page

The first time you start a review on a fresh project, ask the agent to call `wire_drawer({ projectRoot: <abs path> })`. The tool detects the framework, returns two snippets, and the agent surfaces them through `AskUserQuestion`. You pick how the wiring lives:

#### Option A — Local-only file (gitignored, recommended for solo / individual use)

A plugin or override file the team's `.gitignore` excludes — wiring stays on your laptop, not in the team's history. The agent creates the file with the snippet, and (if needed) adds one line to `.gitignore`. Examples per framework:

| Framework | File the agent creates | `.gitignore` addition |
|---|---|---|
| Nuxt | `app/plugins/pitstop.client.local.ts` | `*.client.local.ts` |
| Vite | `vite.config.local.ts` (run with `vite --config vite.config.local.ts`) | `vite.config.local.ts` |
| Plain HTML | `index.local.html` | `index.local.html` |
| Astro / SvelteKit / Next / Remix | (see Option B — local-only is awkward) | — |

#### Option B — Committed conditional snippet (recommended when the whole team uses pitstop)

A NODE_ENV-gated script tag in the team config. Visible to everyone, dev-only, dropped from prod builds. Cleanest if pitstop is part of the team workflow.

```ts
// nuxt.config.ts (Nuxt example — wire_drawer returns the right shape per framework)
script: process.env.NODE_ENV === 'development'
  ? [{
      src: `http://localhost:7773/inject.js?pitstop-project=${encodeURIComponent(rootDir)}`,
      defer: true,
      tagPosition: 'bodyClose',
    }]
  : []
```

Both options work in any browser context — your real Chrome, Claude in Chrome, agent-browser's Playwright Chromium, or CI.

#### Option C — Browser extension (alt path for free-form review only)

If you don't want any source touch *and* you'll only review in your real Chrome (no agent-browser involved):

1. Open `chrome://extensions/`, toggle **Developer mode**, click **Load unpacked**, select `~/pitstop/packages/extension/`.

Works across every localhost port forever; auto-mounts only when an active session matches the page's origin (so quiet tabs stay quiet). **Tradeoff:** extensions don't load in Playwright-driven Chromium, so if any of your reviews are agent-driven via agent-browser, the agent will be looking at a tab that has no drawer. For pitstop's headline driven flow, stick to A or B.

If neither A/B nor the extension is wired, `start_review` warns the agent that the drawer isn't connected and surfaces the right snippet for you — so you find out immediately instead of staring at a blank screen.

<details>
<summary>What <code>bun run setup</code> writes (manual fallback)</summary>

If you'd rather edit the files yourself, the entries are:

`~/.claude.json` → `mcpServers.pitstop`:

```json
{
  "type": "stdio",
  "command": "node",
  "args": ["/Users/YOU/pitstop/packages/mcp-adapter/dist/index.js"]
}
```

`~/.claude/settings.json` → `hooks.UserPromptSubmit`:

```json
[{
  "hooks": [{
    "type": "command",
    "command": "/Users/YOU/pitstop/packages/scripts/pitstop-context.sh"
  }]
}]
```

The hook is read-only — it surfaces unread drawer responses on every prompt; `get_unread_responses` is what actually drains the queue.

</details>

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

The agent has 8 tools:

| Setup | Conversation |
|---|---|
| `wire_drawer({ projectRoot })` — detect framework + return snippet options | `get_state()` — read everything |
| `start_review(items)` — open session; returns `watcher` for Monitor | `get_unread_responses()` — drain unread queue (atomic) |
| `add_items(items)` — append items mid-review | `mark_addressing(itemId, narration)` — feed update |
| `complete_review()` — terminal | `set_current_item(itemId)` — move drawer cursor |

## Troubleshooting

### Drawer doesn't appear and the browser console mentions CSP

Your dev app sets a Content Security Policy that blocks the drawer's script tag (`script-src`) or its API + SSE calls (`connect-src`). You need to allowlist `http://localhost:7773` in both — dev only.

Concrete pattern, spread into each CSP source list:

```js
...(process.env.NODE_ENV !== 'production' ? ['http://localhost:7773'] : []),
```

For example, in a `nuxt-security` config:

```ts
// nuxt.config.ts
security: {
  headers: {
    contentSecurityPolicy: {
      'script-src': [
        "'self'",
        ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:7773'] : []),
      ],
      'connect-src': [
        "'self'",
        ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:7773'] : []),
      ],
    },
  },
},
```

Same shape for Next.js headers, helmet middleware, or `<meta http-equiv="Content-Security-Policy">` tags.

Production builds drop the localhost entry entirely, so your prod CSP stays strict.

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
- **Pinned drawer overlays the host page.** When pinned left or right, the drawer covers part of the host page — content underneath the drawer's footprint is occluded, not pushed aside. If you need full-viewport interaction with the host (a slideover, a wide table, an interaction near the drawer's edge), float the drawer or strip it to the 32px sliver via the minimize button. An earlier reflow mode (v0.3.27–v0.3.35) attempted to push host content via body/html padding, but it didn't reach `position: fixed` host elements (slideovers stayed anchored to viewport) and didn't update viewport-based `@media` queries (host CSS still saw the original viewport width), so it was retired in v0.3.36. The drawer's current width is still exposed on `:root` as `--pitstop-drawer-width` if any host wants to read it.

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
