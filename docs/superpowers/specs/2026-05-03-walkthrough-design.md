# Walkthrough — Design Spec

> Status: draft · 2026-05-03 · brainstorm output, ready for plan
> Project root: `~/work/studios/walkthrough/` (placeholder name; rename freely)
> Companions: [`brief.md`](../../brief.md) · [`.impeccable.md`](../../../.impeccable.md)

## 1. Overview

A browser-injected review surface where a developer walks item-by-item through work an AI agent has completed. The agent emits all review items in one MCP turn; the user advances locally on "looks good" and sends comments that re-engage the agent via a configurable "poke" subprocess. The walkthrough drawer pins to the side of the user's running dev app — review happens *in context*, not on a separate URL.

Optimized for the late-stage feedback loop **inside** a Claude Code session. Not for collaborative review, PR-style approval gates, or multi-user workflows.

## 2. Goals & Non-goals

### Goals (MVP)
- Item-by-item walkthrough with **local auto-advance** on "looks good" (no agent turn per click)
- Comments trigger **agent re-engagement without the user typing into the chat**
- **Pause/resume first-class** — sessions survive interruption
- **Injected drawer** in the user's dev app — review code in the live app context
- **Keyboard-first** input model
- **Multi-position** drawer: docked-right (default), docked-left, floating
- **Resizable** when docked (drag the inside edge); resizable corners when floating
- **Three size variants**: standard, compact, collapsed-strip
- **Light AND dark** themes; dark designed-first
- Distinct visual identity (Mono Industrial, Bracing+Exact+Dry) — explicitly not generic-AI-tool
- Harness-agnostic protocol — Claude Code is first-class via MCP, but anything that can hit a small HTTP API can drive a session

### Non-goals (MVP)
- Multi-user or collaborative review
- PR-style approval workflows or merge gating
- Line-comments inside diffs
- Bottom-anchored drawer position (deferred to v2)
- Browser extension distribution (script-tag + Vite plugin only)
- In-app multi-project switcher (one tab per project)
- Activity log drawer (deferred)
- Inline diff expansion (file-ref + open-in-editor only)

## 3. Architecture

**Two-process model.** A long-running daemon owns the port and the state; thin MCP stdio adapters are spawned per agent session and forward calls to the daemon over HTTP. This decouples daemon lifecycle from any Claude Code session and lets multiple sessions (including the spawned `claude --resume` poke subprocess) share state safely.

```
                                                          ┌──────────────────┐
                                          ┌──HTTP/SSE────>│ Browser drawer   │
                                          │               │ (Solid + Shadow) │
                                          │               │ injected in app  │
┌──────────────┐  stdio MCP    ┌──────────┴───┐           └──────────────────┘
│ Claude Code  │ ────────────> │  walkthrough │
│ (interactive │ <──────────── │     -mcp     │── HTTP ──>┌──────────────────┐
│  session)    │               │ stdio adapter│           │  walkthrough     │
└──────────────┘               └──────────────┘           │  -daemon (Bun)   │
                                                          │                  │
┌──────────────┐               ┌──────────────┐           │ - HTTP API + SSE │
│ claude       │ ───stdio───>  │  walkthrough │           │ - JSON store     │
│ --resume     │ <─────────    │     -mcp     │── HTTP ──>│ - poke runner    │
│ (poke)       │               │ stdio adapter│           │ - shared port    │
└──────────────┘               └──────────────┘           │   (default 7773) │
                                                          │                  │
                                                          │ - spawns poke    │
                                                          │   subprocess ────┐
                                                          └──────────────────┘
                                                                             │
                                                          ┌──────────────────▼─┐
                                                          │ poke subprocess    │
                                                          │ (claude --resume,  │
                                                          │  webhook, script)  │
                                                          └────────────────────┘
```

### `walkthrough-daemon` (long-running, the source of truth)
- **Runtime**: Bun. Fast cold-start, built-in HTTP/SSE, single-binary distribution path later.
- **Lifecycle**: autospawned by the first MCP adapter that needs it (adapter forks it as a detached background process); auto-shuts down after **30 min of no MCP traffic AND no SSE clients connected**. Survives Claude Code session start/stop.
- **Port**: configurable, default `7773`. Daemon binds; adapters never do.
- **Surfaces** (all in one process):
  - **HTTP API + SSE** — JSON CRUD for browser + adapters; SSE stream for live state pushes; serves `/inject.js` and the Vite plugin asset.
  - **Internal RPC** — receives forwarded MCP tool calls from adapters (also over HTTP, simple JSON-RPC).
  - **Poke runner** — spawns the configured poke subprocess on comment-submit events.
- **State**: JSON file per session at `~/.claude/walkthrough/sessions/<session-id>.json`. Atomic writes (temp + rename). Survives daemon restart.

### `walkthrough-mcp` (stdio adapter, spawned per agent session)
- **What**: thin Bun process that implements the MCP stdio protocol on one side and forwards each tool call to the daemon over HTTP on the other.
- **Lifecycle**: launched by Claude Code (or any MCP-aware harness) when its config references it; exits when stdio closes (session ends).
- **First-call boot**: on startup, the adapter checks if the daemon is alive on `localhost:7773`. If not, it spawns the daemon as a detached background process (via `bun --silent ... &`), waits for it to bind, then forwards.
- **Session-id pass-through**: reads `$CLAUDE_SESSION_ID` from its environment (Claude Code sets this on MCP server processes) and includes it as a header on every forwarded HTTP call. Daemon uses the most-recent session ID per `projectRoot` as the `claude --resume` target when poking.
- **Concurrency**: any number of adapters run simultaneously; all forward to the same daemon. The interactive Claude Code session and a spawned `claude --resume` both have their own adapters, both talking to the same daemon, no port conflicts.

### Browser drawer (the injected client)
- **Stack**: Solid.js + Shadow DOM, packaged as a single ESM bundle served at `/inject.js`.
- **Mount**: a `<walkthrough-drawer>` Web Component, closed Shadow DOM, Solid app inside. No CSS leak in either direction.
- **Sync**: SSE stream from daemon for state; HTTP POSTs for response submissions.
- **Persistence (client-side)**: localStorage for drawer position/size/theme preferences. Session state itself lives in the daemon.

### Agent integration
- Agent calls **MCP tools** to drive the walkthrough.
- When a user comment arrives, the daemon spawns the **configured poke subprocess** to re-engage the agent. Default `claude --resume <session-id> --print "<context>"`. Alternatives: webhook, arbitrary shell script.

## 4. Data Model

```ts
type Session = {
  id: string;             // 'a83f-42b1' — random short id
  projectRoot: string;    // absolute path
  branch?: string;        // git branch when session started
  createdAt: number;      // unix ms
  updatedAt: number;
  status: 'idle' | 'active' | 'paused' | 'complete';
  items: Item[];
  responses: Response[];
  agentActivity: ActivityEntry[];   // ring buffer (last ~50 entries)
};

type Item = {
  id: string;             // '01', '02', ... agent-supplied or auto-numbered
  index: number;          // 1-based position
  title: string;          // 'Updated UiTable.vue with skeleton rows'
  body: string;           // markdown
  question?: string;      // 'Does this match the loading pattern you wanted?'
  attachments: Attachment[];
};

type Attachment =
  | { kind: 'file-ref'; path: string; line?: number; diffStats?: { add: number; rem: number; hunks: number } }
  | { kind: 'image'; src: string; caption?: string }
  | { kind: 'link'; href: string; label: string };

type Response = {
  itemId: string;
  kind: 'approve' | 'comment';
  body?: string;          // present when kind = 'comment'
  at: number;             // unix ms
  addressed: boolean;     // true once the agent has read it via get_unread_responses
};

type ActivityEntry = {
  at: number;
  tool: string;           // MCP tool name
  narration?: string;     // optional human-readable from mark_addressing
};
```

## 5. Agent Integration (MCP Tools)

```ts
// Create a new review session
start_review(args: {
  projectRoot: string;
  branch?: string;
  items: Array<{ id?: string; title: string; body: string; question?: string; attachments?: Attachment[] }>;
}): { sessionId: string; url: string }

// Append items mid-session (e.g. after a comment changes scope)
add_items(sessionId: string, items: Item[]): void

// Read full session state (used by the agent on re-engagement)
get_state(sessionId: string): Session

// Get unread responses and mark them addressed atomically
get_unread_responses(sessionId: string): Response[]

// Tell the user what the agent is doing right now (drives status pill)
mark_addressing(sessionId: string, itemId: string | null, narration: string): void

// End the session — browser flips to ALL_DONE
complete_review(sessionId: string): void
```

### Heartbeat + status pill
Every MCP tool call updates `session.updatedAt`. Browser derives the status pill state:
- `IDLE` — pill **hidden** (no activity, no pending responses).
- `WORKING` — activity in last 5s, no narration.
- `ADDRESSING_NN` — `mark_addressing` was called with itemId.
- `WRITING_ITEMS` — `add_items` was called in current "working" window.
- `POKE_FAILED` — daemon spawned poke subprocess but no MCP call from any adapter arrived within **30s** (configurable; default tuned for `claude --resume` cold-start). "Connected" = daemon receives any forwarded MCP call from the spawned process.

### At-most-one-poke invariant
At any time, at most one poke subprocess is alive per session. New comments arriving while a poke is in-flight are persisted to the session JSON immediately but **do not spawn a fresh poke** — the in-flight agent will read them all on its next `get_unread_responses` call (which returns the full unread list, not one item). After the in-flight subprocess exits, if any responses remain unaddressed, the daemon spawns one fresh poke to drain them.

## 6. Browser Integration

### Injection
| Mechanism | When | How |
|---|---|---|
| **Script tag** (MVP, required) | User adds it manually | `<script src="http://localhost:7773/inject.js"></script>` in their dev app's `index.html` (or equivalent) |
| **Vite/Nuxt plugin** (MVP, stretch) | User installs the plugin | `@walkthrough/vite-plugin` injects the script in dev mode, drops in prod build. Won't block release if not ready. |
| **Browser extension** (v2) | Non-project contexts | Chrome/Firefox extension, content script |

Production builds always drop the inject. The plugin checks `import.meta.env.DEV` (Vite) / `dev: true` (Nuxt).

### Mount
```ts
// In inject.js (Solid app)
class WalkthroughDrawer extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'closed' });
    render(() => <App />, root);
  }
}
customElements.define('walkthrough-drawer', WalkthroughDrawer);
document.body.appendChild(new WalkthroughDrawer());
```

### State sync
- On mount: `GET /api/sessions/active?projectRoot=...` to find the current session for this project root.
- Open SSE: `GET /api/sessions/:id/events`. **First event on every connect (including reconnects) is `state-snapshot`** — full session JSON, so the client can rebuild from cold without missing deltas. Subsequent events: `state-changed`, `item-added`, `agent-activity`, `complete`.
- Submit response: `POST /api/sessions/:id/responses` with `{ itemId, kind, body? }`. Daemon writes, broadcasts via SSE, then evaluates poke policy (see at-most-one-poke invariant in §5). `looks-good` responses are persisted but **never** trigger a poke. Comment responses trigger a poke **unless** session is paused or a poke is already in-flight.
- Optimistic updates: comment is added to UI immediately; rollback if POST fails.

### Modes (orthogonal axes)

**Position** (3 values):
- `right` — pinned to viewport right edge (default)
- `left` — mirrored
- `floating` — free-positioned, draggable by header, all 4 corners resizable

**Size** (3 values):
- `standard` — full drawer (~504px wide when docked)
- `compact` — narrower / shorter; hides body prose by default, shows just title + actions
- `strip` — 32px collapsed handle (vertical when docked, mini-chip when floating)

**Resize**:
- Docked: drag inside edge to widen/narrow. Min `360px`, max `min(50vw, 800px)`.
- Floating: corner handles. Min `360 × 280`, max `min(50vw, 800px) × min(80vh, 900px)`.
- Persisted in localStorage.

### Keyboard

| Keys | Action |
|---|---|
| `j` / `↓` | Next item |
| `k` / `↑` | Previous item |
| `⏎` | Looks good + auto-advance |
| `c` | Focus comment box |
| `⌘⏎` | Send comment |
| `esc` | Blur comment box · or pause if not focused |
| `[` / `]` | Cycle drawer position (left/right/floating) |
| `=` | Cycle size (standard/compact/strip) |
| `?` | Show full keymap overlay |

Footer right shows the contextually-relevant 2–3 shortcuts in mono. Full map on `?`.

## 7. Visual Direction

Refer to `brief.md` for the full design brief. Summary:

- **Spirit**: Mono Industrial. Dark-first. Bracing, Exact, Dry.
- **Type**: **Martian Mono** (chrome) + **Hanken Grotesk** (body). Both free, both off the impeccable reflex-list.
- **Palette**: OKLCH, brand hue `70` (amber). All neutrals tinted toward 70 at chroma 0.004–0.010.
  - Dark: `--bg-paper: oklch(0.165 0.004 70)`, `--t1: oklch(0.94 0.006 70)`, `--amber: oklch(0.84 0.15 70)`, `--ok: oklch(0.74 0.13 150)`, `--err: oklch(0.66 0.18 30)`.
  - Light: derived (see craft mockup).
- **Texture**: 14px dot-grid lattice, 0.7px dot at `--dot: oklch(0.27 0.005 70)`. Behind drawer canvas.
- **Status tag**: filing-cabinet label — rectangle with 1px hairline divider between dot-cell and label-cell. Pulses amber when working.
- **Banned**: side-stripe accent borders on rows/cards, soft-shadow cards, gradient text, glassmorphism, generic violet pills.
- **Microcopy**: dry, mono, all-caps for labels (`PREPARING_03`, `STOP`, `LOOKS_GOOD`, `POKE_FAILED · CLICK_RETRY`). Body prose stays sentence-case in Hanken Grotesk.
- **Layout** (drawer): meta-bar (18px) → header (48px) → pip-strip (40px) → detail-scroll (1fr) → footer (42px).
- **Pip-strip** replaces vertical rail at narrow widths: each pip is `[glyph][num]` (e.g. `✓ 01`), color-coded by state.

## 8. Configuration

`~/.claude/walkthrough/config.json`:

```json
{
  "port": 7773,
  "poke": { "kind": "claude-resume" },
  "editor": "cursor",
  "drawer": {
    "position": "right",
    "size": "standard",
    "width": 504
  },
  "theme": "auto",
  "session": {
    "retentionDays": 30
  }
}
```

`poke` variants:
```json
{ "kind": "claude-resume" }                                                  // default
{ "kind": "webhook", "url": "https://..." }
{ "kind": "script", "command": "/path/to/script.sh", "args": ["--ctx", "{{context}}"] }
```

`editor` (file-ref open behavior): `cursor` → `cursor://file/<path>:<line>`, `vscode` → `vscode://...`, `jetbrains` → IntelliJ scheme, `none` → copy-to-clipboard fallback.

## 9. Project Layout

```
~/work/studios/walkthrough/
├── packages/
│   ├── daemon/              # Bun daemon — HTTP + SSE + store + poke
│   │   ├── src/
│   │   │   ├── http/        # routes, SSE, /inject.js serving, internal RPC for adapters
│   │   │   ├── store/       # JSON file persistence (atomic writes)
│   │   │   ├── poke/        # subprocess strategies (claude-resume / webhook / script)
│   │   │   ├── tools/       # tool handlers (one per MCP tool, called by adapter via RPC)
│   │   │   ├── types.ts
│   │   │   └── index.ts     # entry — boots HTTP, ensures port, idle-shutdown timer
│   │   └── package.json
│   ├── mcp-adapter/         # Bun stdio adapter — forwards MCP calls to daemon
│   │   ├── src/
│   │   │   ├── stdio.ts     # MCP stdio protocol
│   │   │   ├── forward.ts   # HTTP forwarder + auto-spawn-daemon-if-down
│   │   │   └── index.ts
│   │   └── package.json
│   ├── inject/              # Solid.js drawer (compiled to single ESM)
│   │   ├── src/
│   │   │   ├── components/  # Drawer, Header, PipStrip, Detail, Footer, FloatingFrame…
│   │   │   ├── state/       # Solid signals/stores; SSE client
│   │   │   ├── styles/      # CSS, OKLCH tokens, dark/light themes
│   │   │   └── index.tsx    # web-component definition + mount
│   │   ├── vite.config.ts
│   │   └── package.json
│   ├── vite-plugin/         # Auto-injector for Vite/Nuxt projects
│   ├── shared/              # Types shared between daemon and inject
│   └── cli/                 # `walkthrough` CLI for non-MCP harnesses (v1.5)
├── docs/
│   ├── brief.md
│   └── superpowers/specs/2026-05-03-walkthrough-design.md   ← this file
├── .impeccable.md
├── package.json             # monorepo root, Bun workspaces
└── README.md
```

## 10. Lifecycle (typical session)

1. **Agent works.** Eventually decides to invite review.
2. **Agent calls `start_review`** with N items. Daemon writes session JSON, returns sessionId + URL.
3. **Agent emits chat reply** with the URL and a "open the drawer when ready" instruction.
4. **User opens dev app** (or it's already open). Drawer detects active session via `GET /api/sessions/active?projectRoot=...`, auto-mounts in current `position`/`size` mode.
5. **User walks items**: `j`/`k` to nav, `⏎` for looks-good, `c` + `⌘⏎` for comment.
6. **On comment submit**: drawer POSTs response. Daemon persists. Daemon spawns poke. Agent's next turn reads `get_unread_responses`, addresses, possibly `add_items`, returns to idle.
7. **On `looks-good`**: pure local advance, no agent turn.
8. **User pauses** (esc / STOP): session status flips to `paused`. Daemon keeps accepting comment POSTs (browser works normally; comments are persisted with `addressed: false`) but **does not spawn pokes** while paused. On RESUME, daemon spawns one summarizing poke that lets the agent address everything that queued.
9. **Done**: user clicks DONE or agent calls `complete_review`. Drawer flips to ALL_DONE state. Session JSON is preserved per `retentionDays`.

## 11. Open questions for the plan

- **Distribution**: ship as `bunx walkthrough-mcp` / `bunx walkthrough-daemon` (always run via Bun) or build single binaries via `bun build --compile`? Latter is more user-friendly but bigger artifacts. Affects how the README onboards.
- **Vite/Nuxt plugin priority**: §6 marks it as MVP-stretch — confirm whether to land day-1 or right after.
- **Session JSON retention**: forever vs configurable window vs always 30-day? Defaulting to 30-day in config.
- **Concurrency policy**: same `projectRoot`, two `start_review` calls — daemon returns `409 ALREADY_ACTIVE` on the second by default. Confirm or override.
- **Internal RPC shape between adapter and daemon**: stick to plain JSON-RPC over HTTP, or upgrade to a typed contract (e.g. tRPC, Cap'n'proto)? Plain JSON keeps the adapter trivially small.

## 12. Out of scope (forever, not v2)

- Server-hosted multi-user mode — this is a personal-machine tool
- Real-time collaboration on a session
- PR/branch-merge integration beyond reading the branch name
- AI-suggested responses (e.g. "auto-approve trivial items") — defeats the purpose

---

## Appendix A — Decisions log (from brainstorm)

| Decision | Resolution | Source |
|---|---|---|
| Walkthrough driver | Browser pokes chat (option 3 — automated, not manual) | Q1 |
| Turn model | Pre-computed list, agent re-engages on feedback only | Q2 |
| Harness scope | Claude Code first via MCP, protocol stays harness-agnostic | Q3 |
| Item shape | Title + markdown body + structured attachments | Q4 |
| Personality | Bracing, exact, dry | Voice gate |
| Mode primary | Dark-first | Mode gate |
| Input model | Keyboard-first | Input gate |
| Type pair | Martian Mono + Hanken Grotesk | Craft pass |
| Palette | OKLCH brand hue 70 (amber) | Craft pass |
| Form factor | Injected drawer (not standalone SPA) — corrected mid-craft | User correction |
| Rail format | Horizontal pip-strip (vertical rail doesn't fit) | Craft v2 |
| Position axes | right / left / floating | User addition |
| Size axes | standard / compact / strip | User addition |
| Resize | Docked-edge + floating-corner, min 360px | User addition |
| UI framework | Solid.js + Shadow DOM | Tech pick |
| Daemon runtime | Bun | Tech pick |
| Open-in-editor | URI scheme (`cursor://`, `vscode://`, etc.) | User correction |
| Image attachments | Supported but rare; full-width inline + lightbox | User question |
| Multi-project | One review per browser tab; no in-app switcher | User addition |
| Activity log | Deferred to v2 | Open question |
| Inline diff | Deferred to v2 | Open question |
| Daemon vs adapter split | Two-process model: long-running daemon + thin MCP stdio adapters | Subagent review (B1+G4) |
| Pause behavior | Daemon accepts POSTs, suppresses pokes; one summarizing poke on resume | Subagent review (B2) |
| SSE reconnect | First event on every connect is `state-snapshot` with full session | Subagent review (G1) |
| POKE_FAILED window | 30s default (was 15s); configurable; "connected" = any forwarded MCP call | Subagent review (G2) |
| At-most-one-poke | New comments persist but don't spawn poke; in-flight reads them all | Subagent review (G3) |
| Session scope | Per-`projectRoot`; `409 ALREADY_ACTIVE` on duplicate start | Subagent review (Q1) |
| IDLE pill | Hidden when idle; pill only visible when there's something to say | Subagent review (Q2) |
