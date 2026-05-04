# Pitstop · Agent-Driven Flow · Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the daemon and drawer foundations the agent-driven flow needs — a session-state field for the agent's chosen cursor, two new HTTP endpoints, and drawer behaviour that treats the agent as the authoritative cursor while still showing pill activity for both approves and comments.

**Architecture:** Two surfaces touched. (1) Daemon: extend the `Session` shared type with a `currentItemId` field, add `GET /responses?since=&unaddressed=true` for the future Monitor script, add `POST /current-item` to back the future `set_current_item` MCP tool. SSE `state-changed` already broadcasts on session updates; reused as-is. (2) Drawer: when SSE delivers a session whose `currentItemId` differs from local state, rebase the local cursor to match. Detail.tsx's `onApprove` gains the same `submitState` lifecycle that `onComment` already has, so the user always sees pill activity after pressing ⏎.

**Tech Stack:** TypeScript (Bun runtime), Hono (HTTP), Zod (schema), bun:test (testing), Solid.js (drawer), Solid `createStore` (drawer state).

**Spec:** `docs/superpowers/specs/2026-05-04-pitstop-agent-driven-flow-design.md`

**Out of scope (other phases):** `set_current_item` MCP tool (Phase B), `pitstop-watch.sh` and the `Monitor`-launched watcher (Phase B), `UserPromptSubmit` hook script (Phase B), agent prompt template (Phase C), README rewrite (Phase B).

**Prerequisites:**
- The `fix/empty-drawer-collapsed` branch (event isolation, drawer stacking, pill UX overhaul, submitState plumbing) must already be on `main`. Phase A extends `submitState` to approves; the pre-existing comment lifecycle is the template.
- Working `bun install` at the repo root. Daemon tests run via `bun test packages/daemon`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/types.ts` | Modify | Add `currentItemId?: string` to `SessionZ`. |
| `packages/daemon/src/http/routes.ts` | Modify | Add `GET /api/sessions/:id/responses?since=&unaddressed=true` and `POST /api/sessions/:id/current-item`. Both broadcast SSE on mutation. |
| `packages/daemon/test/responses-since.test.ts` | Create | Test the new GET endpoint. |
| `packages/daemon/test/current-item.test.ts` | Create | Test the new POST endpoint. |
| `packages/inject/src/state/store.ts` | Modify | In `applyEvent`, when `session.currentItemId` is set and differs from the locally-resolved item, update `currentItemIdx` to match. |
| `packages/inject/src/components/Detail.tsx` | Modify | `onApprove` now flips `submitState` `'sending' → flagSent()` (matching `onComment`). |

No new shared utility modules. No new client-side tests (pitstop has no client test infra; Phase A drawer changes are validated by manual smoke test against the daemon).

---

## Task 1: Add `currentItemId` to the shared Session schema

**Files:**
- Modify: `packages/shared/src/types.ts:39-59`

- [ ] **Step 1: Read the current SessionZ definition**

Run: `grep -n "currentItemId\|SessionZ = " packages/shared/src/types.ts`
Expected: matches only the `SessionZ = z.object({...})` line; no existing `currentItemId`.

- [ ] **Step 2: Add the field to SessionZ**

In `packages/shared/src/types.ts`, find the `SessionZ` definition (currently lines 39-59). Add a new field after `lastAgentActivityAt`:

```ts
  /** The agent's authoritative cursor — which item should the drawer focus.
   *  When unset (legacy sessions), the drawer falls back to its local cursor.
   *  Updated by the agent via the (Phase B) `set_current_item` MCP tool. */
  currentItemId: z.string().optional(),
```

The full updated SessionZ block (insert the field at the end, before the closing `})`):

```ts
export const SessionZ = z.object({
  id: z.string(),
  projectRoot: z.string(),
  branch: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  status: SessionStatusZ,
  items: z.array(ItemZ),
  responses: z.array(ResponseZ),
  agentActivity: z.array(ActivityEntryZ),
  /** Most-recent Claude Code session id seen on an MCP forward, used as `claude --resume` target. */
  clientSessionId: z.string().optional(),
  /** PID of the in-flight poke subprocess, if any. */
  pokePid: z.number().optional(),
  /** Timestamp when the in-flight poke was spawned (for POKE_FAILED detection). */
  pokeSpawnedAt: z.number().optional(),
  /** True when a spawned poke didn't elicit any agent activity within the watch window. */
  pokeFailed: z.boolean().default(false).optional(),
  /** Timestamp of the most recent MCP/RPC tool call landing for this session. */
  lastAgentActivityAt: z.number().optional(),
  /** The agent's authoritative cursor — which item should the drawer focus.
   *  When unset (legacy sessions), the drawer falls back to its local cursor.
   *  Updated by the agent via the (Phase B) `set_current_item` MCP tool. */
  currentItemId: z.string().optional(),
});
```

- [ ] **Step 3: Verify the type compiles**

Run: `bun --cwd packages/shared run tsc --noEmit 2>&1 | tail -5`
Expected: empty output (no type errors). If `tsc` script doesn't exist in shared, run `bun tsc --noEmit packages/shared/src/types.ts` from the repo root.

- [ ] **Step 4: Verify existing daemon tests still pass**

Run: `cd packages/daemon && bun test`
Expected: all tests green. The new optional field is backwards-compatible — Zod parses absent `currentItemId` as undefined.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add Session.currentItemId for agent-driven cursor"
```

---

## Task 2: New endpoint — `GET /api/sessions/:id/responses?since=&unaddressed=true`

**Files:**
- Modify: `packages/daemon/src/http/routes.ts` (add a new route handler near the existing POST handler around line 141)
- Test: `packages/daemon/test/responses-since.test.ts` (create)

This endpoint backs the Phase B Monitor script. The script polls every ~1s with `?since=<lastSeenAt>` to fetch only responses it hasn't emitted yet.

- [ ] **Step 1: Write the failing test**

Create `packages/daemon/test/responses-since.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

async function createSessionWithResponses(app: any) {
  const cr = await app.fetch(new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] }),
  }));
  const session = await cr.json();
  // Submit two responses
  await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '01', kind: 'approve' }),
  }));
  await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '01', kind: 'comment', body: 'hello' }),
  }));
  return session.id;
}

test('GET /responses returns all when no filters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const id = await createSessionWithResponses(app);
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${id}/responses`));
  expect(r.status).toBe(200);
  const list = await r.json();
  expect(list.length).toBe(2);
});

test('GET /responses?unaddressed=true filters to !addressed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const id = await createSessionWithResponses(app);
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${id}/responses?unaddressed=true`));
  expect(r.status).toBe(200);
  const list = await r.json();
  expect(list.length).toBe(2);
  expect(list.every((x: any) => x.addressed === false)).toBe(true);
});

test('GET /responses?since=<ts> filters to at > ts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const id = await createSessionWithResponses(app);
  // Fetch all, grab first timestamp
  const all = await (await app.fetch(new Request(`http://localhost/api/sessions/${id}/responses`))).json();
  const firstTs = all[0].at;
  // since=firstTs should exclude the first one (strict >)
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${id}/responses?since=${firstTs}`));
  const filtered = await r.json();
  expect(filtered.length).toBe(1);
  expect(filtered[0].at).toBeGreaterThan(firstTs);
});

test('GET /responses returns 404 for unknown session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const r = await app.fetch(new Request(`http://localhost/api/sessions/missing/responses`));
  expect(r.status).toBe(404);
});

test('GET /responses returns ascending by `at`', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const id = await createSessionWithResponses(app);
  const list = await (await app.fetch(new Request(`http://localhost/api/sessions/${id}/responses`))).json();
  for (let i = 1; i < list.length; i++) {
    expect(list[i].at).toBeGreaterThanOrEqual(list[i-1].at);
  }
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd packages/daemon && bun test test/responses-since.test.ts`
Expected: FAIL — likely 404 for the new GET endpoint that doesn't exist yet.

- [ ] **Step 3: Add the GET handler in routes.ts**

In `packages/daemon/src/http/routes.ts`, find the existing `POST /api/sessions/:id/responses` handler (currently around line 141). Add a new GET handler immediately above it:

```ts
  app.get('/api/sessions/:id/responses', async (c) => {
    const id = c.req.param('id');
    const session = await store.get(id);
    if (!session) return c.json({ error: 'not found' }, 404);

    const since = c.req.query('since');
    const unaddressed = c.req.query('unaddressed') === 'true';

    const sinceTs = since ? Number(since) : null;
    let list = session.responses.slice().sort((a, b) => a.at - b.at);
    if (sinceTs !== null && Number.isFinite(sinceTs)) {
      list = list.filter((r) => r.at > sinceTs);
    }
    if (unaddressed) {
      list = list.filter((r) => !r.addressed);
    }
    return c.json(list);
  });
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd packages/daemon && bun test test/responses-since.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Run the full daemon test suite to confirm no regressions**

Run: `cd packages/daemon && bun test`
Expected: all tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/src/http/routes.ts packages/daemon/test/responses-since.test.ts
git commit -m "feat(daemon): GET /responses with since= and unaddressed= filters"
```

---

## Task 3: New endpoint — `POST /api/sessions/:id/current-item`

**Files:**
- Modify: `packages/daemon/src/http/routes.ts` (add a new route handler near `POST /status` around line 73)
- Test: `packages/daemon/test/current-item.test.ts` (create)

This endpoint backs the Phase B `set_current_item` MCP tool. It validates the `itemId` exists in `session.items`, persists `currentItemId` on the session, and broadcasts `state-changed` over SSE so the drawer rebases its cursor.

- [ ] **Step 1: Write the failing test**

Create `packages/daemon/test/current-item.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

async function createSession(app: any, items = [{ title: 'A', body: 'a' }, { title: 'B', body: 'b' }]) {
  const cr = await app.fetch(new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectRoot: '/tmp/p', items }),
  }));
  return cr.json();
}

test('POST /current-item sets currentItemId for a known item', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/current-item`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '02' }),
  }));
  expect(r.status).toBe(200);
  // Verify persisted
  const fetched = await (await app.fetch(new Request(`http://localhost/api/sessions/${session.id}`))).json();
  expect(fetched.currentItemId).toBe('02');
});

test('POST /current-item rejects an unknown itemId with 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/current-item`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: 'bogus' }),
  }));
  expect(r.status).toBe(400);
});

test('POST /current-item returns 404 for unknown session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const r = await app.fetch(new Request(`http://localhost/api/sessions/missing/current-item`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '01' }),
  }));
  expect(r.status).toBe(404);
});

test('POST /current-item rejects malformed body with 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/current-item`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}), // missing itemId
  }));
  expect(r.status).toBe(400);
});

test('POST /current-item broadcasts state-changed over SSE', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const session = await createSession(app);
  const eventsRes = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/events`));
  const reader = eventsRes.body!.getReader();
  // Drain the initial state-snapshot
  await reader.read();
  // Trigger the update
  await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/current-item`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '02' }),
  }));
  // Read the next chunk from the SSE stream
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  expect(text).toContain('event: state-changed');
  expect(text).toContain('"currentItemId":"02"');
  reader.cancel();
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `cd packages/daemon && bun test test/current-item.test.ts`
Expected: FAIL — endpoint doesn't exist yet, expect 404 for the POST.

- [ ] **Step 3: Add the POST handler in routes.ts**

In `packages/daemon/src/http/routes.ts`, find the existing `app.post('/api/sessions/:id/status', ...)` handler (currently around line 73). Add a new handler immediately above or below it. Also add the import for `z` and a request schema near the top of the file (or reuse existing ones — check the file's existing imports first).

Locate the existing route imports near the top of the file (around line 1-10) and confirm `import { z } from 'zod';` is already imported. If not, add it.

Add the schema definition near the other `*InZ` definitions (search for `ResponseInZ` to locate them):

```ts
const CurrentItemInZ = z.object({
  itemId: z.string().min(1),
});
```

Then add the handler:

```ts
  app.post('/api/sessions/:id/current-item', async (c) => {
    const id = c.req.param('id');
    const session = await store.get(id);
    if (!session) return c.json({ error: 'not found' }, 404);

    const parsed = CurrentItemInZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

    const { itemId } = parsed.data;
    if (!session.items.some((it) => it.id === itemId)) {
      return c.json({ error: `unknown itemId: ${itemId}` }, 400);
    }

    const updated = await store.update(id, (s) => ({ ...s, currentItemId: itemId }));
    bus.publish(id, { type: 'state-changed', session: updated });
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd packages/daemon && bun test test/current-item.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Run the full daemon test suite to confirm no regressions**

Run: `cd packages/daemon && bun test`
Expected: all tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/src/http/routes.ts packages/daemon/test/current-item.test.ts
git commit -m "feat(daemon): POST /current-item endpoint backing future set_current_item MCP tool"
```

---

## Task 4: Drawer rebases local cursor to `session.currentItemId`

**Files:**
- Modify: `packages/inject/src/state/store.ts` (add a reconciliation step in `applyEvent`)

When the daemon broadcasts `state-changed` with a `currentItemId` set, the drawer's local `currentItemIdx` should rebase to match. This is what makes the agent the authoritative cursor: the agent calls `set_current_item` (Phase B), the daemon broadcasts, the drawer follows.

For backwards compatibility: when `currentItemId` is unset (legacy sessions, or before any `set_current_item` call), the local cursor stays where it is.

- [ ] **Step 1: Read the current `applyEvent` and `setCurrentItemIdx`**

Run: `grep -n "applyEvent\|setCurrentItemIdx\|currentItemIdx" packages/inject/src/state/store.ts`
Expected: matches the existing `currentItemIdx` signal and `applyEvent` function (currently around lines 7 and 23-49).

- [ ] **Step 2: Update `applyEvent` to rebase the local cursor on state-snapshot and state-changed**

In `packages/inject/src/state/store.ts`, find the `applyEvent` function. Locate the `'state-snapshot'` and `'state-changed'` cases (currently sharing one branch around line 25). Update them to rebase `currentItemIdx` whenever `e.session.currentItemId` is set:

```ts
export function applyEvent(e: SseEvent): void {
  switch (e.type) {
    case 'state-snapshot':
    case 'state-changed':
      setSession('s', e.session);
      // Agent-authoritative cursor: when the daemon's session has a
      // currentItemId, snap the local cursor to match. This is how the
      // agent moves the user via set_current_item (Phase B).
      if (e.session.currentItemId) {
        const idx = e.session.items.findIndex((it) => it.id === e.session.currentItemId);
        if (idx >= 0 && idx !== currentItemIdx()) {
          setCurrentItemIdx(idx);
        }
      }
      break;
    case 'item-added':
      setSession(
        's',
        produce((s) => {
          if (!s) return;
          const start = s.items.length;
          for (let i = 0; i < e.items.length; i++) {
            s.items.push({ ...e.items[i]!, index: start + i + 1 });
          }
        }),
      );
      break;
    case 'agent-activity':
      setSession('s', produce((s) => { s?.agentActivity.push(e.entry); }));
      break;
    case 'complete':
      setSession('s', produce((s) => { if (s) s.status = 'complete'; }));
      break;
  }
}
```

The diff is the new `if (e.session.currentItemId)` block inside the merged state-snapshot/state-changed case. The rest of the function is unchanged.

- [ ] **Step 3: Build the inject bundle**

Run: `cd packages/inject && bun run build`
Expected: build succeeds; `dist/inject.js` updated; new bundle size noted (no big jump).

- [ ] **Step 4: Manual smoke test against a running daemon**

In one terminal:
```bash
cd /Users/ammielyawson/work/studios/pitstop && bun run packages/daemon/src/index.ts
```

In another terminal:
```bash
SID=$(curl -s -X POST http://localhost:7773/api/sessions \
  -H 'content-type: application/json' \
  -d '{"projectRoot":"/tmp/p","items":[{"title":"A","body":"aa"},{"title":"B","body":"bb"},{"title":"C","body":"cc"}]}' \
  | jq -r .id)
echo "Session: $SID"
```

Open `http://localhost:7773/demo` in a browser. Open DevTools console. Verify the drawer mounts with 3 items, default cursor on item 1.

In a third terminal:
```bash
curl -s -X POST "http://localhost:7773/api/sessions/$SID/current-item" \
  -H 'content-type: application/json' -d '{"itemId":"03"}'
```

Expected (in the browser): drawer cursor jumps to item 3 within ~1s. The pip-strip highlight moves; the detail pane shows item 3's content.

If the drawer doesn't snap: open DevTools, run `document.querySelector('pitstop-drawer').shadowRoot.querySelector('.detail-eyebrow').textContent` — should report `ITEM_03 / 03`. If it reports the old item, the SSE event isn't reaching the drawer, or `applyEvent` isn't reading `currentItemId`. Re-check Step 2.

- [ ] **Step 5: Stop the daemon, commit**

```bash
git add packages/inject/src/state/store.ts
git commit -m "feat(drawer): rebase local cursor to session.currentItemId on SSE state-changed"
```

---

## Task 5: Drawer's `onApprove` flips `submitState` (matching `onComment`)

**Files:**
- Modify: `packages/inject/src/components/Detail.tsx:24-46`

Today only `onComment` calls `setSubmitState('sending')` and `flagSent()`. Approves are silent on the pill — the user can't tell whether the agent saw their ⏎ approve or whether anything's happening. After this change, both kinds fire the pill cycle; only the cursor behaviour differs.

- [ ] **Step 1: Read the current Detail.tsx imports and the onComment lifecycle for reference**

Run: `grep -n "setSubmitState\|flagSent\|onApprove\|onComment" packages/inject/src/components/Detail.tsx`
Expected: shows `onComment` already calls `setSubmitState('sending')` and `flagSent()`. `onApprove` does not.

- [ ] **Step 2: Update the imports if necessary**

In `packages/inject/src/components/Detail.tsx`, near the top (currently lines 3-12), confirm `setSubmitState` and `flagSent` are already imported from `'../state/store'`. They should be — they were added when comment lifecycle was wired. If not, add them:

```ts
import {
  session,
  currentItemIdx,
  setCurrentItemIdx,
  setSummaryOpen,
  unreviewedIndices,
  getDraft,
  setDraft,
  clearDraft,
  setSubmitState,
  flagSent,
} from '../state/store';
```

- [ ] **Step 3: Update `onApprove` to mirror `onComment`'s submitState lifecycle**

Find `onApprove` (currently lines 24-46). Replace the entire function body with:

```ts
  const onApprove = async () => {
    const it = item();
    if (!it || !session.s) return;
    setSubmitting(true);
    setSubmitState('sending');
    try {
      await submitResponse(session.s.id, { itemId: it.id, kind: 'approve' });
      flagSent();
      const total = session.s.items.length;
      const wasLast = currentItemIdx() === total - 1;
      if (wasLast) {
        // Did the user skip anything earlier? Open the summary so they can address gaps.
        // Filter the just-approved index in case the response hasn't propagated through the memo yet.
        const stillSkipped = unreviewedIndices().filter((i) => i !== currentItemIdx());
        if (stillSkipped.length > 0) {
          setSummaryOpen(true);
        }
        // No skipped items — stay on the last item; complete_review will flip session.status.
        return;
      }
      setCurrentItemIdx(Math.min(total - 1, currentItemIdx() + 1));
    } catch {
      setSubmitState('idle');
    } finally {
      setSubmitting(false);
    }
  };
```

The differences vs the existing code:
- After `setSubmitting(true)`: also `setSubmitState('sending')`.
- After the awaited `submitResponse`: call `flagSent()` (sets state to `'poked'`).
- Wrapped in `try { ... } catch { setSubmitState('idle') }` so a failed POST clears the pill.

- [ ] **Step 4: Rebuild the inject bundle**

Run: `cd packages/inject && bun run build`
Expected: build succeeds.

- [ ] **Step 5: Manual smoke test**

In one terminal: `bun run packages/daemon/src/index.ts`.

In another:
```bash
SID=$(curl -s -X POST http://localhost:7773/api/sessions \
  -H 'content-type: application/json' \
  -d '{"projectRoot":"/tmp/p","items":[{"title":"A","body":"aa"},{"title":"B","body":"bb"}]}' \
  | jq -r .id)
echo "Session: $SID"
```

Open `http://localhost:7773/demo`, focus the drawer. Press `⏎` to approve item 1.

Expected behaviour:
- The pill in the drawer header flashes `SENDING…` (briefly) then `POKED_CLAUDE · WAITING`.
- Cursor advances to item 2.
- The pill stays at `POKED_CLAUDE · WAITING` until the 60-second `flagSent()` safety timeout clears it. (Phase B's `set_current_item` and `mark_addressing` will clear it sooner via SSE `agent-activity`. There's no way to simulate that in Phase A — the daemon doesn't expose mark_addressing as an HTTP endpoint, only as an MCP tool. So for this smoke test, just wait or move on.)

If the pill never appears: open DevTools, check that `derivePill(session.s)` returns `{ state: 'working', label: 'SENDING…' }` during the in-flight POST. The fix path is `setSubmitState('sending')` not being called or `submitState` being read stale.

- [ ] **Step 6: Stop the daemon, commit**

```bash
git add packages/inject/src/components/Detail.tsx
git commit -m "feat(drawer): fire submitState lifecycle on approve (was comment-only)"
```

---

## Task 6: End-to-end smoke test the new endpoints with a polling client

**Files:** none new — this task validates the work from Tasks 2-5 holistically with a temporary script.

This task verifies that the future Monitor script's polling pattern works against the real endpoints. The script we'd ship in Phase B is documented here as a smoke-test artifact so we know the daemon is correct.

- [ ] **Step 1: Start the daemon**

```bash
cd /Users/ammielyawson/work/studios/pitstop && bun run packages/daemon/src/index.ts
```

Leave it running.

- [ ] **Step 2: Create a session**

In another terminal:
```bash
SID=$(curl -s -X POST http://localhost:7773/api/sessions \
  -H 'content-type: application/json' \
  -d '{"projectRoot":"/tmp/p","items":[{"title":"A","body":"a"},{"title":"B","body":"b"}]}' \
  | jq -r .id)
echo "Session: $SID"
```

- [ ] **Step 3: Run a temporary watcher polling the new endpoint**

Save this to `/tmp/pitstop-watch-smoke.sh` and run it:

```bash
#!/usr/bin/env bash
set -uo pipefail
SID="${1:?sessionId required}"
HOST="${PITSTOP_HOST:-http://localhost:7773}"
LAST=0
echo "watching session $SID..."
while true; do
  RESP=$(curl -sf "$HOST/api/sessions/$SID/responses?since=$LAST&unaddressed=true" 2>/dev/null || echo '[]')
  echo "$RESP" | jq -c '.[]?' 2>/dev/null | while IFS= read -r line; do
    echo ">> $line"
  done
  LAST_NEW=$(echo "$RESP" | jq -r 'map(.at) | max // empty' 2>/dev/null)
  [ -n "$LAST_NEW" ] && LAST=$LAST_NEW
  sleep 1
done
```

Run:
```bash
chmod +x /tmp/pitstop-watch-smoke.sh
/tmp/pitstop-watch-smoke.sh "$SID"
```

Expected: the watcher prints `watching session <id>...` and then waits.

- [ ] **Step 4: Submit a response in another terminal**

```bash
curl -s -X POST "http://localhost:7773/api/sessions/$SID/responses" \
  -H 'content-type: application/json' \
  -d '{"itemId":"01","kind":"comment","body":"hello from smoke"}'
```

Expected (in the watcher terminal): within ~1s, a line like `>> {"itemId":"01","kind":"comment","body":"hello from smoke","at":...,"addressed":false}` appears.

- [ ] **Step 5: Submit another response, verify only the new one is emitted**

```bash
curl -s -X POST "http://localhost:7773/api/sessions/$SID/responses" \
  -H 'content-type: application/json' \
  -d '{"itemId":"02","kind":"approve"}'
```

Expected: only the new `{"itemId":"02","kind":"approve",...}` line is emitted in the watcher (the previous comment is not re-emitted because `since=` excludes it).

- [ ] **Step 6: Test the current-item endpoint**

```bash
curl -s -X POST "http://localhost:7773/api/sessions/$SID/current-item" \
  -H 'content-type: application/json' \
  -d '{"itemId":"02"}'
```

Expected: response `{"ok":true}`. No new line in the watcher (this isn't a response — it's a session state mutation).

- [ ] **Step 7: Verify the session state**

```bash
curl -s "http://localhost:7773/api/sessions/$SID" | jq '.currentItemId'
```

Expected: `"02"`.

- [ ] **Step 8: Stop the watcher (Ctrl+C), stop the daemon, clean up**

```bash
rm /tmp/pitstop-watch-smoke.sh
```

- [ ] **Step 9: Commit-style note (no code changes; this is verification only)**

No commit necessary — Task 6 verifies that Tasks 2-5 work end-to-end without writing new code.

---

## Self-Review Notes (for the implementer)

After all tasks complete:

1. **Spec coverage:** Phase A in the spec covers (a) daemon `?since=` filter ✓ Task 2, (b) daemon `currentItemId` field + endpoint ✓ Tasks 1+3, (c) drawer rebasing to `currentItemId` ✓ Task 4, (d) drawer pill cycles fire on both approve and comment ✓ Task 5. Task 6 is verification.
2. **Backwards compatibility:** the `currentItemId` field is `.optional()` in Zod — existing on-disk sessions parse fine. The drawer's rebase logic is gated on `if (e.session.currentItemId)` — legacy sessions without the field stay on the local cursor.
3. **Out of scope confirmed:** no `set_current_item` MCP tool yet (Phase B). No watcher script shipped (Phase B). No agent prompt changes (Phase C).

If any test fails or smoke-test step doesn't behave as expected, stop and diagnose before commiting. Don't paper over a broken test with `it.skip()`.
