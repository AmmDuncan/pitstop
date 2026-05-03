# pitstop

**Pause-and-walk-through review for AI coding agents.** Your agent finishes a chunk of work, calls `start_review`, and a drawer mounts in your dev app's browser with the items to review. You walk through them with `j/k`, hit `⏎` for "looks good," or type a comment that re-engages the agent via `claude --resume`. No more typing "looks good" / "actually fix X" into the chat.

> **Status:** Alpha (v0.0.1, untagged). Built for personal use; shared with friends. Expect rough edges. Tested on macOS with Bun + Claude Code + Cursor/VS Code. Linux should work; Windows untested. API may change between commits.

---

## Why

Reviewing AI-written code by re-typing *"looks good"* / *"fix X"* / *"now do Y"* into a chat window is high-friction. You lose track of where you are, comments arrive out of context, and the agent doesn't know what's "done" until you tell it. Pitstop turns the back-and-forth into a structured walkthrough:

- Agent emits all review items in **one** turn.
- You navigate locally — *looks-good* never blocks on the agent.
- Comments fire **one** targeted re-engagement, not a stream of small ones.
- Pause/resume is first-class; the agent stays out of the way until you're done.

Optimized for the late-stage feedback loop *inside* a Claude Code session — not for collaborative review or PR-style approval gates.

---

## How it works

```
   Claude Code
        │
        │ stdio
        ▼
  ┌─────────────┐    HTTP     ┌──────────────────────┐
  │ mcp-adapter │ ──────────► │ daemon (port 7773)   │ ─── spawns
  └─────────────┘             │  • session state     │     claude --resume
                              │  • serves            │     when you comment
                              │    /inject.js        │
                              └──────────┬───────────┘
                                         │ HTTP / SSE
                                         ▼
  ┌──────────────────┐  <script>   ┌──────────────────────┐
  │ Your dev server  │ injected by │ Drawer running in    │
  │ (Vite or Nuxt)   │ ──────────► │ your browser via     │
  │                  │ vite-plugin │ Shadow DOM           │
  └──────────────────┘             └──────────────────────┘
```

- **mcp-adapter** — stdio bridge that Claude Code spawns per session. Forwards MCP tool calls to the daemon over HTTP.
- **daemon** — Hono HTTP server that owns session state and serves the bundled drawer at `/inject.js`. Spawns `claude --resume` to wake the agent when you comment.
- **vite-plugin** — adds a `<script src="http://localhost:7773/inject.js">` tag to every HTML response your dev server returns. Dev-only; production builds drop it.
- **inject** — the Solid.js drawer that mounts in your dev app's browser via Shadow DOM (so it can't conflict with your styles).

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- [Claude Code](https://claude.com/claude-code) (the CLI)
- A Vite or Nuxt dev project to review work in

---

## Install

### 1. Clone and install

```bash
git clone https://github.com/AmmDuncan/pitstop.git ~/pitstop
cd ~/pitstop
bun install
```

### 2. Register the MCP adapter with Claude Code

Open `~/.claude.json`. Find the top-level `"mcpServers"` key (create it as `{}` if it doesn't exist) and add:

```json
"pitstop": {
  "type": "stdio",
  "command": "bun",
  "args": ["run", "/Users/YOU/pitstop/packages/mcp-adapter/src/index.ts"]
}
```

> ⚠️ Use an **absolute path**. `~` doesn't expand inside `~/.claude.json`.

Restart Claude Code, then verify:

```bash
claude mcp list | grep pitstop
# pitstop: bun run /Users/YOU/pitstop/... - ✓ Connected
```

### 3. Add the Vite plugin to your dev project

In the project you want to review work on:

```bash
bun add -d /Users/YOU/pitstop/packages/vite-plugin
```

Then wire it in.

**Vite** (`vite.config.ts`):
```ts
import { defineConfig } from 'vite';
import pitstop from '@pitstop/vite-plugin';

export default defineConfig({
  plugins: [pitstop()],
});
```

**Nuxt** (`nuxt.config.ts`):
```ts
import pitstop from '@pitstop/vite-plugin';

export default defineNuxtConfig({
  vite: { plugins: [pitstop()] },
});
```

---

## Run

Two terminals for now (daemon auto-start is on the roadmap):

**Terminal A — pitstop daemon (long-running):**
```bash
cd ~/pitstop
bun run packages/daemon/src/index.ts
```

**Terminal B — your dev project:**
```bash
cd ~/your-project
bun dev
```

Open your dev app in the browser. The drawer is mounted but empty, waiting for a session.

In your Claude Code session, ask the agent:

> Use the `start_review` MCP tool to walk me through the work you just did. `projectRoot` is `/Users/YOU/your-project`.

The drawer fills with items. Walk through them.

---

## Use

| Key | Action |
|---|---|
| `j` / `↓` | Next item |
| `k` / `↑` | Previous item |
| `⏎` | Mark *looks-good* + auto-advance (local — agent not contacted) |
| `c` | Focus comment textarea |
| `⌘⏎` | Send comment (wakes the agent via `claude --resume`) |
| `esc` | Blur comment / close help overlay |
| `[` / `]` | Cycle drawer position (right / left / floating) |
| `=` | Cycle size (standard / compact / strip) |
| `t` | Cycle theme (auto / dark / light) |
| `?` | Toggle full keymap overlay |

Position, size, and theme persist per-browser via `localStorage`.

---

## Known limitations

- **Daemon doesn't auto-start.** You have to keep Terminal A running.
- **Vite / Nuxt only.** No webpack, Next.js, or Remix plugin yet. No browser extension.
- **One review per browser tab.** Sessions are bound to the project root the agent passes in.
- **No session cleanup.** Old sessions accumulate in `~/.claude/pitstop/sessions/`.
- **macOS-tested.** Linux should work; Windows untested.
- **Pre-1.0.** Tool names, ports, and config shape can change between commits.

---

## Updating

```bash
cd ~/pitstop
git pull
cd packages/inject && bun run build   # rebuild the drawer if its source changed
```

When release tags exist, pin your local checkout:
```bash
git checkout v0.1.0
```

---

## Repo layout

```
packages/
  daemon/        — HTTP server, session store, /inject.js, claude-resume spawner
  mcp-adapter/   — stdio↔HTTP bridge that Claude Code spawns
  inject/        — Solid.js drawer (Shadow DOM); pre-built into dist/
  vite-plugin/   — Vite/Nuxt plugin that injects the <script> tag
  shared/        — types and zod schemas
docs/            — design brief, specs, plans
```

---

## License

[MIT](LICENSE)
