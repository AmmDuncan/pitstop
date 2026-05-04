# Pitstop · Agent-Driven Flow · Phase B + C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pitstop work end-to-end as the agent-driven tour described in the spec. Daemon already has the foundations from Phase A. Phase B wires the MCP layer (`set_current_item` tool, `start_review` returns the `watcher` block) and ships the two scripts (`pitstop-watch.sh` for the live heartbeat, `pitstop-context.sh` for the UserPromptSubmit hook). Phase C is a README rewrite that includes the agent prompt template — what the user types to start a driven review.

**Architecture:** No new architecture; this is the wiring on top of Phase A.
- Daemon's `tools` map gains `set_current_item` (delegates to the existing `POST /current-item` endpoint behaviour but inside the RPC pipeline).
- Daemon's `start_review` extends its return shape with a `watcher` block: `{ command, description, persistent: true }` pointing at `pitstop-watch.sh <sessionId>`.
- mcp-adapter's tool list registers `set_current_item` so it's exposed to Claude.
- Two new bash scripts ship in `packages/scripts/`. They're tested end-to-end in Task 6.
- README explains: install, toolbelt-neutral browser-driver assumption, hook install, agent prompt template.

**Tech Stack:** TypeScript (Bun), Hono, Zod, MCP SDK, bash.

**Spec:** `docs/superpowers/specs/2026-05-04-pitstop-agent-driven-flow-design.md`
**Phase A plan:** `docs/superpowers/plans/2026-05-04-pitstop-agent-driven-flow-phase-a.md` (already shipped)

**Out of scope for this plan:**
- `response-added` SSE event for sub-second Monitor latency (spec section 14).
- Per-item agent-recorded navigation trail (Tier 3 brainstorm).
- Drawer `kind: 'navigate'` response type.
- Multi-tab scenarios.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/daemon/src/tools/index.ts` | Modify | Add `set_current_item` tool. Extend `start_review` return with `watcher` block. |
| `packages/daemon/src/config.ts` | Modify | Add `scriptsDir` resolution (default = `packages/scripts/` relative to package). |
| `packages/daemon/test/set-current-item-rpc.test.ts` | Create | Test the RPC tool (separate from Phase A's HTTP-level test). |
| `packages/daemon/test/start-review-watcher.test.ts` | Create | Test that `start_review` returns the `watcher` block. |
| `packages/mcp-adapter/src/index.ts` | Modify | Register `set_current_item` in the tool list. |
| `packages/scripts/pitstop-watch.sh` | Create | Polling watcher for Monitor. |
| `packages/scripts/pitstop-context.sh` | Create | UserPromptSubmit hook receiver. |
| `README.md` | Rewrite (top-level) | Install, agent-driven mode, prompt template, hook setup. |

The watcher script path resolution lives at the daemon level and is read by `start_review` to construct the `watcher.command` string.

---

## Task 1: Add `set_current_item` MCP tool to the daemon's tools map

**Files:**
- Modify: `packages/daemon/src/tools/index.ts`
- Test: `packages/daemon/test/set-current-item-rpc.test.ts` (create)

The tool delegates to the same logic as `POST /api/sessions/:id/current-item` (Phase A) — validate session exists, validate `itemId` is in `session.items`, write `currentItemId`, broadcast `state-changed`.

- [ ] **Step 1: Write the failing test**

Create `packages/daemon/test/set-current-item-rpc.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

async function createSession(app: any) {
  const cr = await app.fetch(new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectRoot: '/tmp/p', items: [{ title: 'A', body: 'a' }, { title: 'B', body: 'b' }] }),
  }));
  return cr.json();
}

async function rpc(app: any, method: string, params: unknown) {
  const r = await app.fetch(new Request('http://localhost/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  }));
  return { status: r.status, body: await r.json() };
}

test('set_current_item RPC writes currentItemId and broadcasts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const events = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/events`));
  const reader = events.body!.getReader();
  await reader.read(); // drain initial snapshot

  const { status, body } = await rpc(app, 'set_current_item', { sessionId: session.id, itemId: '02' });
  expect(status).toBe(200);
  expect(body).toEqual({ ok: true });

  const fetched = await (await app.fetch(new Request(`http://localhost/api/sessions/${session.id}`))).json();
  expect(fetched.currentItemId).toBe('02');

  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  expect(text).toContain('event: state-changed');
  expect(text).toContain('"currentItemId":"02"');
  reader.cancel();
});

test('set_current_item rejects unknown sessionId', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const { status, body } = await rpc(app, 'set_current_item', { sessionId: 'missing', itemId: '01' });
  expect(status).not.toBe(200);
  expect(JSON.stringify(body)).toContain('NOT_FOUND');
});

test('set_current_item rejects unknown itemId', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const { status, body } = await rpc(app, 'set_current_item', { sessionId: session.id, itemId: 'bogus' });
  expect(status).not.toBe(200);
  expect(JSON.stringify(body)).toContain('UNKNOWN_ITEM_ID');
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `cd packages/daemon && bun test test/set-current-item-rpc.test.ts`
Expected: FAIL — tool doesn't exist on the RPC method dispatcher yet.

- [ ] **Step 3: Add the tool to `packages/daemon/src/tools/index.ts`**

Inside the `tools` object (after `mark_addressing`, before `complete_review`), add:

```ts
  async set_current_item(ctx: Ctx, params: unknown) {
    const P = z.object({ sessionId: z.string(), itemId: z.string() });
    const { sessionId, itemId } = P.parse(params);
    const cur = await ctx.store.get(sessionId);
    if (!cur) throw new Error('NOT_FOUND');
    if (!cur.items.some((it) => it.id === itemId)) throw new Error(`UNKNOWN_ITEM_ID:${itemId}`);
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      currentItemId: itemId,
      lastAgentActivityAt: Date.now(),
      pokeFailed: false,
    }));
    ctx.bus.publish(sessionId, { type: 'state-changed', session });
    return { ok: true };
  },
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd packages/daemon && bun test test/set-current-item-rpc.test.ts`
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Run full daemon suite, expect no regressions**

Run: `cd packages/daemon && bun test`
Expected: all green (35 prior + 3 new = 38 expected).

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/src/tools/index.ts packages/daemon/test/set-current-item-rpc.test.ts
git commit -m "feat(daemon): add set_current_item RPC tool"
```

---

## Task 2: `start_review` returns a `watcher` block

**Files:**
- Modify: `packages/daemon/src/config.ts` (add `scriptsDir` to `DaemonOpts` and resolve default)
- Modify: `packages/daemon/src/http/server.ts` (thread `scriptsDir` through `buildApp` opts)
- Modify: `packages/daemon/src/http/routes.ts` (pass `scriptsDir` into the tools `Ctx`)
- Modify: `packages/daemon/src/tools/index.ts` (extend `start_review` return; use `ctx.scriptsDir`)
- Test: `packages/daemon/test/start-review-watcher.test.ts` (create)

The mcp-adapter is the agent-facing surface for `start_review`. The daemon already returns `{ sessionId, url }`. Phase B adds `watcher: { command, description, persistent }` so the agent can immediately invoke `Monitor` with these exact parameters.

The script path is resolved at daemon startup. Default location: `<repo>/packages/scripts/pitstop-watch.sh` (computed relative to `packages/daemon`'s `import.meta.url`). Override via `PITSTOP_SCRIPTS_DIR` env var for non-default checkouts.

- [ ] **Step 1: Write the failing test**

Create `packages/daemon/test/start-review-watcher.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

test('start_review returns a watcher block with the script command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir, scriptsDir: '/custom/scripts' });
  const r = await app.fetch(new Request('http://localhost/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'start_review',
      params: { projectRoot: '/tmp/p', items: [{ title: 'A', body: 'a' }] },
    }),
  }));
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.sessionId).toBeTruthy();
  expect(body.url).toContain(`/?session=${body.sessionId}`);
  expect(body.watcher).toBeTruthy();
  expect(body.watcher.command).toBe(`/custom/scripts/pitstop-watch.sh ${body.sessionId}`);
  expect(body.watcher.description).toContain('pitstop');
  expect(body.watcher.description).toContain(body.sessionId);
  expect(body.watcher.persistent).toBe(true);
});

test('start_review uses default scriptsDir when not provided', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const r = await app.fetch(new Request('http://localhost/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'start_review',
      params: { projectRoot: '/tmp/p', items: [{ title: 'A', body: 'a' }] },
    }),
  }));
  const body = await r.json();
  // Default resolves to packages/scripts inside the repo
  expect(body.watcher.command).toMatch(/packages\/scripts\/pitstop-watch\.sh /);
  expect(body.watcher.command).toContain(body.sessionId);
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `cd packages/daemon && bun test test/start-review-watcher.test.ts`
Expected: FAIL — `body.watcher` is undefined.

- [ ] **Step 3: Wire `scriptsDir` through `DaemonOpts`**

In `packages/daemon/src/http/server.ts`, extend `DaemonOpts`:

```ts
export type DaemonOpts = {
  port: number;
  dataDir: string;
  spawn?: typeof NodeSpawn;
  pokeKind?: PokeKind;
  scriptsDir?: string;
};
```

The default resolution lives in `mountRoutes` (in `routes.ts`) where the tools `Ctx` is constructed.

- [ ] **Step 4: Compute default `scriptsDir` and pass it through `Ctx`**

In `packages/daemon/src/http/routes.ts`, find where the `Ctx` is built (search for `tools[`, or where `store`/`bus`/`baseUrl` are passed). At the top of `mountRoutes` (or wherever `Ctx` is constructed), add the resolution:

```ts
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DEFAULT_SCRIPTS_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  // routes.ts is at packages/daemon/src/http/, walk up to packages/, then into scripts/
  return join(here, '..', '..', '..', 'scripts');
})();

export function mountRoutes(app: Hono, opts: DaemonOpts) {
  // ...existing code...
  const scriptsDir = process.env.PITSTOP_SCRIPTS_DIR ?? opts.scriptsDir ?? DEFAULT_SCRIPTS_DIR;
  // ...
}
```

When the tools `Ctx` is constructed for the RPC handler (search for `await tools[name](ctx, ...)` or similar), include `scriptsDir` in the ctx object.

If you can't locate where the Ctx is built, run:
```bash
cd /Users/ammielyawson/work/studios/pitstop && grep -n 'tools\[\|tools\.' packages/daemon/src/http/routes.ts | head
```

Update the `Ctx` type in `packages/daemon/src/tools/index.ts`:

```ts
type Ctx = { store: Store; bus: Bus; baseUrl: string; clientSessionId?: string; scriptsDir: string };
```

- [ ] **Step 5: Extend `start_review` return**

In `packages/daemon/src/tools/index.ts`, modify `start_review`:

```ts
async start_review(ctx: Ctx, params: unknown) {
  const p = StartReviewZ.parse(params);
  const existing = await ctx.store.getActive(p.projectRoot);
  if (existing && existing.status !== 'idle') {
    throw new Error(`ALREADY_ACTIVE:${existing.id}`);
  }
  const session = await ctx.store.create({ ...p, clientSessionId: ctx.clientSessionId } as any);
  ctx.bus.publish(session.id, { type: 'state-snapshot', session });
  return {
    sessionId: session.id,
    url: `${ctx.baseUrl}/?session=${session.id}`,
    watcher: {
      command: `${ctx.scriptsDir}/pitstop-watch.sh ${session.id}`,
      description: `pitstop unread responses · session ${session.id}`,
      persistent: true,
    },
  };
},
```

- [ ] **Step 6: Run tests, expect pass**

Run: `cd packages/daemon && bun test test/start-review-watcher.test.ts`
Expected: 2 pass.

Run: `cd packages/daemon && bun test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/daemon/src/http/server.ts packages/daemon/src/http/routes.ts packages/daemon/src/tools/index.ts packages/daemon/test/start-review-watcher.test.ts
git commit -m "feat(daemon): start_review returns watcher block for Monitor"
```

---

## Task 3: Register `set_current_item` in mcp-adapter tool list

**Files:**
- Modify: `packages/mcp-adapter/src/index.ts`

The mcp-adapter exposes the tool list to Claude. It just needs to add `set_current_item` to the `tools` array. The tool itself is implemented at the daemon side (Task 1); the adapter just forwards.

- [ ] **Step 1: Open `packages/mcp-adapter/src/index.ts` and locate the `tools` array**

Run: `grep -n "name: 'mark_addressing'\|name: 'complete_review'" packages/mcp-adapter/src/index.ts`
Expected: matches the existing tool registrations.

- [ ] **Step 2: Add the new tool registration**

Insert immediately before `complete_review` in the `tools` array:

```ts
  {
    name: 'set_current_item',
    description: "Move the drawer's focused item to the given itemId. Call this after navigating the user's tab to a new item's surface so the drawer cursor matches the agent's chosen view.",
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'itemId'],
      properties: {
        sessionId: { type: 'string' },
        itemId: { type: 'string' },
      },
    },
  },
```

- [ ] **Step 3: Verify the tool list parses**

Run: `cd packages/mcp-adapter && bun --eval "import('./src/index.ts').catch(e => { console.error(e); process.exit(1); })"`

Note: this will hang because the adapter has a setInterval keepalive. Press `^C` after a few seconds. If it printed an error before hanging, that's a problem. If it printed nothing or just connected silently, it parsed fine.

Alternative simpler check:
```bash
cd /Users/ammielyawson/work/studios/pitstop && bun build packages/mcp-adapter/src/index.ts --outfile /tmp/mcp-adapter-check.js --target=node 2>&1 | tail -5
```
Expected: built successfully, no parse errors.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-adapter/src/index.ts
git commit -m "feat(mcp-adapter): register set_current_item tool"
```

---

## Task 4: Ship `pitstop-watch.sh` and `pitstop-context.sh` scripts

**Files:**
- Create: `packages/scripts/pitstop-watch.sh`
- Create: `packages/scripts/pitstop-context.sh`

Both scripts ship as executable bash; both depend only on `curl` and `jq` which the README will list as prerequisites.

- [ ] **Step 1: Create `packages/scripts/pitstop-watch.sh`**

```bash
#!/usr/bin/env bash
# pitstop-watch.sh — emits one stdout line per new unaddressed pitstop response.
# Designed to be invoked via Claude Code's `Monitor` tool; the start_review MCP
# call returns the exact command to invoke.
#
# Usage: pitstop-watch.sh <sessionId>
# Env:   PITSTOP_HOST (default http://localhost:7773)

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

Then make it executable:
```bash
chmod +x packages/scripts/pitstop-watch.sh
```

- [ ] **Step 2: Create `packages/scripts/pitstop-context.sh`**

```bash
#!/usr/bin/env bash
# pitstop-context.sh — UserPromptSubmit hook for Claude Code.
# Surfaces unread pitstop responses as additional context on every user prompt
# when an active pitstop session exists for $PWD. Read-only — does not flip
# `addressed: true`; the agent must call mcp__pitstop__get_unread_responses to
# atomically drain the queue.

set -uo pipefail

HOST="${PITSTOP_HOST:-http://localhost:7773}"

SID=$(curl -sf "$HOST/api/sessions/active?projectRoot=$PWD" 2>/dev/null | jq -r '.id // empty' 2>/dev/null)
[ -z "$SID" ] && exit 0

UNREAD=$(curl -sf "$HOST/api/sessions/$SID/responses?unaddressed=true" 2>/dev/null)
if [ -n "$UNREAD" ] && [ "$UNREAD" != "[]" ]; then
  echo "[pitstop unread responses] session=$SID"
  echo "$UNREAD" | jq -c '.[]?' 2>/dev/null
fi
exit 0
```

Then make it executable:
```bash
chmod +x packages/scripts/pitstop-context.sh
```

- [ ] **Step 3: Manual smoke test of the watcher script**

Start the daemon in one terminal:
```bash
cd /Users/ammielyawson/work/studios/pitstop && bun run packages/daemon/src/index.ts
```

In another terminal:
```bash
SID=$(curl -s -X POST http://localhost:7773/api/sessions \
  -H 'content-type: application/json' \
  -d '{"projectRoot":"/tmp/p","items":[{"title":"A","body":"a"},{"title":"B","body":"b"}]}' \
  | jq -r .id)
./packages/scripts/pitstop-watch.sh "$SID" &
WATCHER=$!
sleep 1
# Submit a response
curl -s -X POST "http://localhost:7773/api/sessions/$SID/responses" \
  -H 'content-type: application/json' \
  -d '{"itemId":"01","kind":"comment","body":"smoke"}' >/dev/null
sleep 2
kill $WATCHER
```

Expected: watcher prints one JSON line containing `"body":"smoke"` to stdout within ~2 seconds. If nothing prints, check that `curl` and `jq` are installed.

- [ ] **Step 4: Stop the daemon, commit**

```bash
git add packages/scripts/pitstop-watch.sh packages/scripts/pitstop-context.sh
git commit -m "feat(scripts): pitstop-watch.sh + pitstop-context.sh for Monitor and hook"
```

---

## Task 5: README rewrite — agent-driven mode + prompt template

**Files:**
- Modify: `README.md` (top-level)

The existing README assumed a static review queue. Phase B+C delivers the agent-driven flow, so the README needs to lead with that. Toolbelt-neutral throughout.

- [ ] **Step 1: Read the current README to understand baseline structure**

Run: `cat README.md | head -100`
Note the existing sections so the rewrite preserves what's still accurate (architecture diagram, "what is pitstop", install).

- [ ] **Step 2: Rewrite the README**

Replace the file's contents with the structure below. Adjust based on what already exists — don't delete sections that are still accurate; rephrase them in this new framing.

```markdown
# pitstop

A drawer in your dev app where the agent leaves you items to review. You answer with one keystroke. The agent acts on your answers — driving the user's browser tab through each surface, in order, with the work right in front of you.

> Agents can smoke-test their own implementations. But that's not the same as a human looking. Humans catch UX feel, taste calls, off-by-one visual bugs, "technically works but wrong" judgements that don't surface in agent reasoning. Pitstop's job is to make the *human* review process easier and friendlier — and the agent driving the tour is what makes it friendly.

## What it is

Four pieces:

- **drawer** — a custom element with Shadow DOM that mounts in your dev app's browser. Renders items, takes keystrokes, sends responses to the daemon, updates live via SSE.
- **daemon** — tiny HTTP server on `:7773`. Holds session state, serves `inject.js`, broadcasts SSE updates.
- **mcp-adapter** — stdio bridge Claude Code spawns per session. Exposes 7 MCP tools.
- **agent (Claude)** — drives the user's tab through each surface. Reads the user's drawer responses via MCP. Updates the drawer cursor as it goes.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- [Claude Code](https://claude.com/claude-code) (the CLI)
- A dev app to review work in (any framework that can host one `<script>` tag)
- `curl` and `jq` (for the watcher and hook scripts)
- A browser-driving toolbelt for Claude — **either** [Claude in Chrome](https://www.anthropic.com/claude-in-chrome) (drives your real Chrome tabs) **or** [agent-browser](https://github.com/...) (Playwright-managed Chrome you run headed). Pitstop is toolbelt-neutral; pick whichever fits your setup.

## Install

### 1. Clone and install

```bash
git clone https://github.com/AmmDuncan/pitstop.git ~/pitstop
cd ~/pitstop
bun install
```

### 2. Register the MCP adapter with Claude Code

Open `~/.claude.json`. Find the top-level `"mcpServers"` key and add:

```json
"pitstop": {
  "type": "stdio",
  "command": "node",
  "args": ["/Users/YOU/pitstop/packages/mcp-adapter/dist/index.js"]
}
```

> Use an absolute path. Replace `/Users/YOU/pitstop` with where you cloned. The adapter ships pre-built; if you cloned fresh, run `bun --cwd packages/mcp-adapter run build` once.

Restart Claude Code, then verify:

```bash
claude mcp list | grep pitstop
# pitstop: node /Users/YOU/pitstop/... - ✓ Connected
```

### 3. Wire the drawer into your dev app

The drawer needs one `<script>` tag in your dev app's HTML during dev. Tell your agent:

> *"Set up the pitstop drawer in this project."*

The agent will pick the right file for your stack and add this tag (or equivalent for your framework):

```html
<script src="http://localhost:7773/inject.js?pitstop-project=<absolute-project-path>" defer></script>
```

The script reads its own URL's `?pitstop-project=` query param to know which session to bind to. Vite, Nuxt, Next.js, SvelteKit, Astro, plain HTML — wherever the tag fits.

### 4. Install the UserPromptSubmit hook

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

> *"Start a pitstop review of [the work]. Drive me through each item using Claude in Chrome / agent-browser. After `start_review`, invoke `Monitor` with the parameters in the returned `watcher` block. On each notification, call `get_unread_responses`, navigate me to the relevant surface, then `set_current_item` and `mark_addressing`."*

(You can shorten this once Claude has done it a few times — it learns the pattern.)

What happens:

1. Claude calls `start_review` with the items it wants you to look at. The drawer paints; the daemon returns a `watcher` block.
2. Claude immediately invokes `Monitor` with that `watcher` (live heartbeat — fires whenever you click in the drawer).
3. Claude navigates your tab to item 0 using its browser-driving toolbelt, calls `set_current_item(0)` and `mark_addressing(0, "...")`. Drawer pill: `ADDRESSING · ...`.
4. You review item 0 on its actual surface. Press `⏎` to approve, or `c` then comment then `⌘⏎`.
5. Drawer pill flips `SENDING…` → `POKED_CLAUDE · WAITING`. The watcher emits a stdout line. Claude wakes up here, drains responses via `get_unread_responses`, drives your tab to the next surface, repeat.
6. When done, `complete_review` flips the pill green. Or click `DONE` in the drawer footer.

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
- Monitor (started once at session top) is the live heartbeat. Each new drawer response wakes the agent in this conversation as a chat-level notification.
- UserPromptSubmit hook covers the case where you happen to be typing.

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
```

- [ ] **Step 3: Verify the README references match shipped files**

Run:
```bash
cd /Users/ammielyawson/work/studios/pitstop
test -f packages/scripts/pitstop-context.sh && echo "context script: OK"
test -f packages/scripts/pitstop-watch.sh && echo "watch script: OK"
test -f packages/mcp-adapter/dist/index.js && echo "adapter dist: OK"
test -f docs/superpowers/specs/2026-05-04-pitstop-agent-driven-flow-design.md && echo "spec: OK"
```

If `packages/mcp-adapter/dist/index.js` doesn't exist, build it:
```bash
bun build packages/mcp-adapter/src/index.ts --outfile packages/mcp-adapter/dist/index.js --target=node --format=esm
```

- [ ] **Step 4: Commit**

```bash
git add README.md
# If you rebuilt the adapter, also: git add packages/mcp-adapter/dist/index.js (if dist/ is tracked — check .gitignore first)
git commit -m "docs(readme): rewrite for agent-driven mode (v0.2)"
```

---

## Task 6: End-to-end smoke test of the full Phase A+B+C flow

**Files:** none new — manual verification.

Validates that the agent-driven loop actually works end-to-end. Run from a fresh Claude Code session in a real dev app — but for this plan, the daemon-side is what we verify.

- [ ] **Step 1: Build the mcp-adapter dist**

```bash
cd /Users/ammielyawson/work/studios/pitstop
bun build packages/mcp-adapter/src/index.ts --outfile packages/mcp-adapter/dist/index.js --target=node --format=esm
```

- [ ] **Step 2: Start the daemon**

```bash
bun run packages/daemon/src/index.ts
```

Leave it running.

- [ ] **Step 3: Simulate `start_review` and verify the `watcher` block**

```bash
curl -s -X POST http://localhost:7773/api/rpc \
  -H 'content-type: application/json' \
  -d '{"method":"start_review","params":{"projectRoot":"/tmp/p","items":[{"title":"A","body":"aa"},{"title":"B","body":"bb"}]}}' | jq
```

Expected: returns `{ sessionId, url, watcher: { command, description, persistent: true } }`. The `watcher.command` should look like `/Users/YOU/pitstop/packages/scripts/pitstop-watch.sh <sessionId>`.

- [ ] **Step 4: Run the watcher in the background**

Save the sessionId from step 3:
```bash
SID="<the-sessionId-from-step-3>"
./packages/scripts/pitstop-watch.sh "$SID" &
WATCHER=$!
sleep 1
```

- [ ] **Step 5: Submit a response and verify the watcher emits**

```bash
curl -s -X POST "http://localhost:7773/api/sessions/$SID/responses" \
  -H 'content-type: application/json' \
  -d '{"itemId":"01","kind":"comment","body":"end-to-end smoke"}' >/dev/null
sleep 2
```

Expected: watcher prints one JSON line to stdout containing `"body":"end-to-end smoke"`.

- [ ] **Step 6: Test `set_current_item` via RPC**

```bash
curl -s -X POST http://localhost:7773/api/rpc \
  -H 'content-type: application/json' \
  -d "{\"method\":\"set_current_item\",\"params\":{\"sessionId\":\"$SID\",\"itemId\":\"02\"}}" | jq
```

Expected: `{ ok: true }`. Then verify:
```bash
curl -s "http://localhost:7773/api/sessions/$SID" | jq '.currentItemId'
```
Expected: `"02"`.

- [ ] **Step 7: Test `pitstop-context.sh` against the active session**

```bash
cd /tmp && mkdir -p p && cd p
PWD=$(pwd) /Users/ammielyawson/work/studios/pitstop/packages/scripts/pitstop-context.sh
```

Wait — the daemon binds the session to `projectRoot=/tmp/p`. The hook script uses `$PWD` to look up. Run the hook from `/tmp/p`:
```bash
cd /tmp/p && /Users/ammielyawson/work/studios/pitstop/packages/scripts/pitstop-context.sh
```

Expected: prints `[pitstop unread responses] session=<sid>` followed by the JSON for the unread comment from step 5 (since `get_unread_responses` was never called, the comment is still unread).

- [ ] **Step 8: Clean up**

```bash
kill $WATCHER 2>/dev/null
# Stop the daemon (Ctrl+C in its terminal)
```

If everything in steps 3-7 worked: you have a working agent-driven flow ready for use in real Claude Code sessions.

- [ ] **Step 9: No commit needed**

This is verification only.

---

## Self-Review Notes (for the implementer)

After all tasks complete:

1. **Spec coverage check:** Phase B from the spec covers (a) `set_current_item` MCP tool ✓ Tasks 1+3, (b) `start_review` watcher block ✓ Task 2, (c) `pitstop-watch.sh` and `pitstop-context.sh` scripts ✓ Task 4, (d) README rewrite ✓ Task 5. Phase C (agent prompt template) is folded into the README in Task 5.

2. **Backwards compat:** `set_current_item` is additive. The watcher block is a new field on `start_review`'s response — existing callers ignoring the field still work. Hook is opt-in via settings.json.

3. **Out of scope confirmed:** No `response-added` SSE event added. No drawer `navigate` response kind. No multi-tab handling.
