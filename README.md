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

### 3. Wire it into your dev app

Pitstop needs two things in your app's HTML during dev:
1. A `window.__PITSTOP_PROJECT__` value pointing at your project's absolute path.
2. A `<script src="http://localhost:7773/inject.js">` tag.

For **Vite** and **Nuxt** there's a one-line plugin that does both. For everything else, paste a 5-line snippet into your layout.

#### Vite / Nuxt (one-line setup)

In the project you want to review work on:

```bash
bun add -d /Users/YOU/pitstop/packages/vite-plugin
```

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

The plugin is dev-only by default. Production builds drop the inject script automatically.

#### Other frameworks (manual snippet)

There's no plugin for non-Vite frameworks yet, but the snippet is small. The shape is identical everywhere — set the project root, then load the inject script.

**Next.js (App Router)** — `app/layout.tsx`:
```tsx
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {process.env.NODE_ENV === 'development' && (
          <>
            <Script id="pitstop-project" strategy="beforeInteractive">
              {`window.__PITSTOP_PROJECT__ = "/Users/YOU/your-next-project";`}
            </Script>
            <Script src="http://localhost:7773/inject.js" strategy="afterInteractive" />
          </>
        )}
        {children}
      </body>
    </html>
  );
}
```

**Next.js (Pages Router)** — same idea in `pages/_document.tsx` or `pages/_app.tsx`.

**Anywhere else** — paste this into whatever file holds your dev HTML, gated on dev mode if your framework supports it:

```html
<script>window.__PITSTOP_PROJECT__ = "/Users/YOU/your-project";</script>
<script src="http://localhost:7773/inject.js"></script>
```

Where to put it, by framework:

| Framework | File |
|---|---|
| Vite / Nuxt | `@pitstop/vite-plugin` (above) |
| Next.js | `app/layout.tsx` (App Router) or `pages/_document.tsx` (Pages Router) |
| Remix | `app/root.tsx` inside the `<Scripts />` block |
| SvelteKit | `src/app.html` |
| CRA / webpack | `public/index.html` |
| Astro | `src/layouts/Layout.astro` |
| Plain HTML | wherever your `<body>` is |

> ⚠️ **Tested setups**: Vite + Nuxt on macOS. Next.js / Remix / SvelteKit / CRA / Astro snippets are derived from how their script-injection mechanisms work but aren't yet smoke-tested. If something doesn't work, [open an issue](https://github.com/AmmDuncan/pitstop/issues).

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
- **Only Vite / Nuxt have a one-line plugin.** Everything else needs the manual snippet above. No browser extension yet.
- **One review per browser tab.** Sessions are bound to the project root the agent passes in.
- **No session cleanup.** Old sessions accumulate in `~/.claude/pitstop/sessions/`.
- **Smoke-tested on macOS with Bun + Claude Code + Vite/Nuxt.** Test suite passes (30/30); daemon endpoints (`/health`, `/inject.js`, `/demo`) verified. Other framework snippets are derived from each framework's normal script-injection mechanism but aren't yet smoke-tested end-to-end.
- **Pre-1.0.** Tool names, ports, and config shape can change between commits. Pin to a tag once they exist.

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
