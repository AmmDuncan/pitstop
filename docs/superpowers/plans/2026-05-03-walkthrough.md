# Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browser-injected review tool where AI agents emit walkthrough items via MCP and a developer reviews them in a drawer that pins to their dev app, with comments triggering agent re-engagement.

**Architecture:** Two-process Bun system. A long-running **daemon** owns port 7773, the JSON session store, the SSE stream, and the poke runner. Thin **MCP stdio adapters** are spawned by Claude Code per session and forward MCP tool calls to the daemon over HTTP. The browser drawer is a Solid.js app mounted into a closed Shadow DOM via a `<walkthrough-drawer>` Web Component, served as `/inject.js` from the daemon.

**Tech Stack:** Bun · TypeScript · Hono (HTTP) · Solid.js · Vite · `@modelcontextprotocol/sdk` · Zod · `nanoid`.

**Path-to-usable milestone:** End of **Phase 4**. After Phase 4 you can: configure walkthrough as an MCP server in Claude Code → ask the agent to walk you through some work → see items appear in your dev app's drawer → click LOOKS_GOOD or send a comment → watch the agent re-engage automatically.

---

## Phase 0 · Repo skeleton

### Task 0.1: Initialize git + Bun workspace

**Files:**
- Modify (run in): `~/work/studios/walkthrough/`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `biome.json`

- [ ] **Step 1: Init repo**

```bash
cd ~/work/studios/walkthrough
git init -b main
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "walkthrough-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test",
    "lint": "biome check --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/bun": "latest",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
.DS_Store
*.log
.env
.env.local
*.tsbuildinfo
```

Bun 1.x errors when the `workspaces: ["packages/*"]` glob has no matching dirs at install time. Create an empty `packages/.gitkeep` to unblock fresh-clone installs (it can be deleted once `packages/shared/` lands in Task 0.2).

- [ ] **Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "types": ["bun"]
  }
}
```

- [ ] **Step 5: Write `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 110 },
  "linter": { "enabled": true, "rules": { "recommended": true, "style": { "noNonNullAssertion": "off" } } },
  "organizeImports": { "enabled": true },
  "files": { "ignore": ["dist", "node_modules", "**/*.md"] }
}
```

- [ ] **Step 6: Install + commit**

```bash
bun install
git add .
git commit -m "chore: bootstrap monorepo skeleton"
```

### Task 0.2: Shared types package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: `packages/shared/package.json`**

```json
{
  "name": "@walkthrough/shared",
  "type": "module",
  "version": "0.0.1",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^3.23.0" }
}
```

- [ ] **Step 2: `packages/shared/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: `packages/shared/src/types.ts`**

```ts
import { z } from 'zod';

export const AttachmentZ = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file-ref'),
    path: z.string(),
    line: z.number().int().positive().optional(),
    diffStats: z.object({ add: z.number(), rem: z.number(), hunks: z.number() }).optional(),
  }),
  z.object({ kind: z.literal('image'), src: z.string(), caption: z.string().optional() }),
  z.object({ kind: z.literal('link'), href: z.string().url(), label: z.string() }),
]);

export const ItemZ = z.object({
  id: z.string(),
  index: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string(),
  question: z.string().optional(),
  attachments: z.array(AttachmentZ).default([]),
});

export const ResponseZ = z.object({
  itemId: z.string(),
  kind: z.enum(['approve', 'comment']),
  body: z.string().optional(),
  at: z.number(),
  addressed: z.boolean(),
});

export const ActivityEntryZ = z.object({
  at: z.number(),
  tool: z.string(),
  narration: z.string().optional(),
});

export const SessionStatusZ = z.enum(['idle', 'active', 'paused', 'complete']);

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
});

export type Attachment = z.infer<typeof AttachmentZ>;
export type Item = z.infer<typeof ItemZ>;
export type Response = z.infer<typeof ResponseZ>;
export type ActivityEntry = z.infer<typeof ActivityEntryZ>;
export type SessionStatus = z.infer<typeof SessionStatusZ>;
export type Session = z.infer<typeof SessionZ>;

/** SSE event payloads pushed from daemon → browser. */
export type SseEvent =
  | { type: 'state-snapshot'; session: Session }
  | { type: 'state-changed'; session: Session }
  | { type: 'item-added'; sessionId: string; items: Item[] }
  | { type: 'agent-activity'; sessionId: string; entry: ActivityEntry }
  | { type: 'complete'; sessionId: string };

export type PokeKind =
  | { kind: 'claude-resume' }
  | { kind: 'webhook'; url: string }
  | { kind: 'script'; command: string; args?: string[] };

export type WalkthroughConfig = {
  port: number;
  poke: PokeKind;
  editor: 'cursor' | 'vscode' | 'jetbrains' | 'none';
  drawer: { position: 'right' | 'left' | 'floating'; size: 'standard' | 'compact' | 'strip'; width: number };
  theme: 'auto' | 'dark' | 'light';
  session: { retentionDays: number };
};
```

- [ ] **Step 4: `packages/shared/src/index.ts`**

```ts
export * from './types';
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): session/item/response types and zod schemas"
```

---

## Phase 1 · Daemon foundation

### Task 1.1: Daemon package + Hono HTTP skeleton

**Files:**
- Create: `packages/daemon/package.json`
- Create: `packages/daemon/tsconfig.json`
- Create: `packages/daemon/src/index.ts`
- Create: `packages/daemon/src/http/server.ts`
- Create: `packages/daemon/src/http/routes.ts`
- Create: `packages/daemon/test/health.test.ts`

- [ ] **Step 1: `packages/daemon/package.json`**

```json
{
  "name": "@walkthrough/daemon",
  "type": "module",
  "version": "0.0.1",
  "bin": { "walkthrough-daemon": "./src/index.ts" },
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts"
  },
  "dependencies": {
    "@walkthrough/shared": "workspace:*",
    "hono": "^4.6.0",
    "nanoid": "^5.0.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: `packages/daemon/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 3: Write the failing health test** — `packages/daemon/test/health.test.ts`

```ts
import { test, expect } from 'bun:test';
import { buildApp } from '../src/http/server';

test('GET /health returns ok', async () => {
  const app = buildApp({ port: 0, dataDir: '/tmp/walkthrough-test' });
  const res = await app.fetch(new Request('http://localhost/health'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 4: Run test, see fail**

```bash
bun test packages/daemon/test/health.test.ts
```
Expected: fail with module-not-found.

- [ ] **Step 5: Write `src/http/server.ts`**

```ts
import { Hono } from 'hono';
import { mountRoutes } from './routes';

export type DaemonOpts = { port: number; dataDir: string };

export function buildApp(opts: DaemonOpts) {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));
  mountRoutes(app, opts);
  return app;
}
```

- [ ] **Step 6: Write `src/http/routes.ts` (stub)**

```ts
import type { Hono } from 'hono';
import type { DaemonOpts } from './server';

export function mountRoutes(_app: Hono, _opts: DaemonOpts): void {
  // Filled in by later tasks.
}
```

- [ ] **Step 7: Write `src/index.ts` (entry)**

```ts
import { buildApp } from './http/server';
import { homedir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.WALKTHROUGH_PORT ?? 7773);
const dataDir = join(homedir(), '.claude', 'walkthrough');

const app = buildApp({ port, dataDir });
const server = Bun.serve({ port, fetch: app.fetch });
console.log(`walkthrough-daemon listening on http://localhost:${server.port}`);
```

- [ ] **Step 8: Run test → pass**

```bash
bun test packages/daemon/test/health.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add packages/daemon
git commit -m "feat(daemon): hono skeleton + /health"
```

### Task 1.2: Atomic JSON store

**Files:**
- Create: `packages/daemon/src/store/atomic.ts`
- Create: `packages/daemon/src/store/sessions.ts`
- Create: `packages/daemon/test/sessions.test.ts`

- [ ] **Step 1: Write the failing test** — `test/sessions.test.ts`

```ts
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store/sessions';

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-'));
  store = new Store(dir);
});

test('round-trip a session through disk', async () => {
  const created = await store.create({ projectRoot: '/tmp/p', items: [] });
  const loaded = await store.get(created.id);
  expect(loaded?.id).toBe(created.id);
  expect(loaded?.projectRoot).toBe('/tmp/p');
  expect(loaded?.status).toBe('idle');
  rmSync(dir, { recursive: true, force: true });
});

test('getActive returns the active session for a projectRoot', async () => {
  const a = await store.create({ projectRoot: '/tmp/p1', items: [] });
  await store.update(a.id, (s) => ({ ...s, status: 'active' }));
  await store.create({ projectRoot: '/tmp/p2', items: [] });
  const active = await store.getActive('/tmp/p1');
  expect(active?.id).toBe(a.id);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
bun test packages/daemon/test/sessions.test.ts
```

- [ ] **Step 3: Write `src/store/atomic.ts`**

```ts
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
}
```

- [ ] **Step 4: Write `src/store/sessions.ts`**

```ts
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { type Session, SessionZ, type Item } from '@walkthrough/shared';
import { writeAtomic } from './atomic';

type CreateInput = {
  projectRoot: string;
  branch?: string;
  items: Array<Omit<Item, 'index'> & { index?: number }>;
  clientSessionId?: string;
};

export class Store {
  private sessionsDir: string;
  constructor(dataDir: string) {
    this.sessionsDir = join(dataDir, 'sessions');
  }

  private path(id: string): string {
    return join(this.sessionsDir, `${id}.json`);
  }

  async create(input: CreateInput): Promise<Session> {
    const now = Date.now();
    const session: Session = {
      id: nanoid(8),
      projectRoot: input.projectRoot,
      branch: input.branch,
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      items: input.items.map((it, i) => ({
        id: it.id ?? String(i + 1).padStart(2, '0'),
        index: it.index ?? i + 1,
        title: it.title,
        body: it.body,
        question: it.question,
        attachments: it.attachments ?? [],
      })),
      responses: [],
      agentActivity: [],
      clientSessionId: input.clientSessionId,
    };
    SessionZ.parse(session);
    await writeAtomic(this.path(session.id), JSON.stringify(session, null, 2));
    return session;
  }

  async get(id: string): Promise<Session | null> {
    const p = this.path(id);
    if (!existsSync(p)) return null;
    return SessionZ.parse(JSON.parse(await readFile(p, 'utf8')));
  }

  async list(): Promise<Session[]> {
    if (!existsSync(this.sessionsDir)) return [];
    const files = await readdir(this.sessionsDir);
    const sessions: Session[] = [];
    for (const f of files) {
      if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
      const s = await this.get(f.replace(/\.json$/, ''));
      if (s) sessions.push(s);
    }
    return sessions;
  }

  async getActive(projectRoot: string): Promise<Session | null> {
    const all = await this.list();
    return all.find((s) => s.projectRoot === projectRoot && s.status !== 'complete') ?? null;
  }

  async update(id: string, updater: (s: Session) => Session): Promise<Session> {
    const cur = await this.get(id);
    if (!cur) throw new Error(`session ${id} not found`);
    const next = { ...updater(cur), updatedAt: Date.now() };
    SessionZ.parse(next);
    await writeAtomic(this.path(id), JSON.stringify(next, null, 2));
    return next;
  }
}
```

- [ ] **Step 5: Run tests → pass**

```bash
bun test packages/daemon/test/sessions.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/daemon
git commit -m "feat(daemon): atomic JSON session store"
```

### Task 1.3: SSE broadcast bus

**Files:**
- Create: `packages/daemon/src/http/sse.ts`
- Create: `packages/daemon/test/sse.test.ts`

- [ ] **Step 1: Write the failing test** — `test/sse.test.ts`

```ts
import { test, expect } from 'bun:test';
import { Bus } from '../src/http/sse';
import type { SseEvent } from '@walkthrough/shared';

test('Bus delivers events to subscribers, drops them on unsubscribe', () => {
  const bus = new Bus();
  const received: SseEvent[] = [];
  const unsub = bus.subscribe('s1', (e) => received.push(e));
  bus.publish('s1', { type: 'complete', sessionId: 's1' });
  bus.publish('s2', { type: 'complete', sessionId: 's2' }); // different session, ignored
  unsub();
  bus.publish('s1', { type: 'complete', sessionId: 's1' });
  expect(received).toHaveLength(1);
});

test('Bus tracks subscriber count', () => {
  const bus = new Bus();
  const u1 = bus.subscribe('s1', () => {});
  const u2 = bus.subscribe('s1', () => {});
  expect(bus.subscriberCount('s1')).toBe(2);
  u1();
  expect(bus.subscriberCount('s1')).toBe(1);
  u2();
  expect(bus.subscriberCount('s1')).toBe(0);
});
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Write `src/http/sse.ts`**

```ts
import type { SseEvent } from '@walkthrough/shared';

type Listener = (event: SseEvent) => void;

export class Bus {
  private byId = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.byId.get(sessionId);
    if (!set) {
      set = new Set();
      this.byId.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.byId.delete(sessionId);
    };
  }

  publish(sessionId: string, event: SseEvent): void {
    const set = this.byId.get(sessionId);
    if (!set) return;
    for (const l of set) l(event);
  }

  subscriberCount(sessionId?: string): number {
    if (sessionId) return this.byId.get(sessionId)?.size ?? 0;
    let n = 0;
    for (const s of this.byId.values()) n += s.size;
    return n;
  }
}
```

- [ ] **Step 4: Tests pass; commit**

```bash
git add packages/daemon
git commit -m "feat(daemon): in-process SSE bus"
```

### Task 1.4: Session HTTP routes (CRUD + active lookup)

**Files:**
- Modify: `packages/daemon/src/http/server.ts`
- Modify: `packages/daemon/src/http/routes.ts`
- Create: `packages/daemon/test/sessions-http.test.ts`

- [ ] **Step 1: Write the failing test** — `test/sessions-http.test.ts`

```ts
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

let dir: string;
let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-'));
  app = buildApp({ port: 0, dataDir: dir });
});

const json = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://localhost${path}`, init));

test('POST /api/sessions creates a session', async () => {
  const res = await json('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectRoot: '/tmp/p',
      items: [{ title: 'T1', body: 'B1' }],
    }),
  });
  expect(res.status).toBe(201);
  const s = await res.json();
  expect(s.id).toBeDefined();
  expect(s.items[0].id).toBe('01');
});

test('POST /api/sessions returns 409 for active duplicate', async () => {
  const body = JSON.stringify({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] });
  const r1 = await json('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const created = await r1.json();
  // mark it active so it's a "duplicate"
  await app.fetch(new Request(`http://localhost/api/sessions/${created.id}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'active' }),
  }));
  const r2 = await json('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  expect(r2.status).toBe(409);
});

test('GET /api/sessions/active returns the active session for a projectRoot', async () => {
  const created = await (await json('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] }),
  })).json();
  const res = await json(`/api/sessions/active?projectRoot=${encodeURIComponent('/tmp/p')}`);
  expect(res.status).toBe(200);
  const s = await res.json();
  expect(s.id).toBe(created.id);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Verify fail**

- [ ] **Step 3: Update `src/http/routes.ts`**

```ts
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonOpts } from './server';
import { Store } from '../store/sessions';
import { Bus } from './sse';
import { ItemZ, SessionStatusZ } from '@walkthrough/shared';

const CreateZ = z.object({
  projectRoot: z.string(),
  branch: z.string().optional(),
  items: z.array(ItemZ.omit({ index: true }).partial({ id: true, attachments: true })),
  clientSessionId: z.string().optional(),
});

export function mountRoutes(app: Hono, opts: DaemonOpts) {
  const store = new Store(opts.dataDir);
  const bus = new Bus();

  app.post('/api/sessions', async (c) => {
    const parsed = CreateZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

    const existing = await store.getActive(parsed.data.projectRoot);
    if (existing && existing.status !== 'idle') {
      return c.json({ error: 'ALREADY_ACTIVE', sessionId: existing.id }, 409);
    }
    const session = await store.create(parsed.data as any);
    bus.publish(session.id, { type: 'state-snapshot', session });
    return c.json(session, 201);
  });

  app.get('/api/sessions/active', async (c) => {
    const projectRoot = c.req.query('projectRoot');
    if (!projectRoot) return c.json({ error: 'projectRoot required' }, 400);
    const session = await store.getActive(projectRoot);
    if (!session) return c.json({ error: 'NO_ACTIVE_SESSION' }, 404);
    return c.json(session);
  });

  app.get('/api/sessions/:id', async (c) => {
    const session = await store.get(c.req.param('id'));
    if (!session) return c.json({ error: 'NOT_FOUND' }, 404);
    return c.json(session);
  });

  app.post('/api/sessions/:id/status', async (c) => {
    const Body = z.object({ status: SessionStatusZ });
    const parsed = Body.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);
    const session = await store.update(c.req.param('id'), (s) => ({ ...s, status: parsed.data.status }));
    bus.publish(session.id, { type: 'state-changed', session });
    return c.json(session);
  });

  // Expose for later tasks (response POST + SSE GET).
  Object.assign(app, { _store: store, _bus: bus });
}
```

- [ ] **Step 4: Run tests → pass; commit**

```bash
bun test packages/daemon
git add packages/daemon
git commit -m "feat(daemon): session CRUD + active lookup + 409 ALREADY_ACTIVE"
```

### Task 1.5: SSE GET endpoint with state-snapshot on connect

**Files:**
- Modify: `packages/daemon/src/http/routes.ts`
- Create: `packages/daemon/test/sse-http.test.ts`

- [ ] **Step 1: Test — connect SSE, expect first event is state-snapshot**

```ts
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

test('GET /api/sessions/:id/events emits state-snapshot first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  // create a session
  const cr = await app.fetch(new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] }),
  }));
  const session = await cr.json();
  const res = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/events`));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  expect(text).toContain('event: state-snapshot');
  expect(text).toContain(session.id);
  reader.cancel();
});
```

- [ ] **Step 2: Add SSE handler in `routes.ts` (append to `mountRoutes`)**

```ts
  app.get('/api/sessions/:id/events', (c) => {
    const id = c.req.param('id');
    return new Response(
      new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const send = (event: string, data: unknown) => {
            controller.enqueue(enc.encode(`event: ${event}\n`));
            controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
          };
          // Initial snapshot
          const session = await store.get(id);
          if (!session) {
            send('error', { error: 'NOT_FOUND' });
            controller.close();
            return;
          }
          send('state-snapshot', { type: 'state-snapshot', session });
          // Live stream
          const unsub = bus.subscribe(id, (event) => send(event.type, event));
          // Heartbeat every 25s so proxies don't close us
          const hb = setInterval(() => controller.enqueue(enc.encode(`: heartbeat\n\n`)), 25_000);
          c.req.raw.signal.addEventListener('abort', () => {
            clearInterval(hb);
            unsub();
            try { controller.close(); } catch {}
          });
        },
      }),
      { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } },
    );
  });
```

- [ ] **Step 3: Test passes; commit**

```bash
bun test packages/daemon
git add packages/daemon
git commit -m "feat(daemon): SSE event stream with state-snapshot on connect"
```

### Task 1.6: Response submission route

**Files:**
- Modify: `packages/daemon/src/http/routes.ts`
- Create: `packages/daemon/test/responses.test.ts`

- [ ] **Step 1: Test — POSTing a response persists + broadcasts**

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

test('POST /responses persists + broadcasts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const cr = await app.fetch(new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] }),
  }));
  const session = await cr.json();
  const r = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '01', kind: 'approve' }),
  }));
  expect(r.status).toBe(202);
  const updated = await app.fetch(new Request(`http://localhost/api/sessions/${session.id}`));
  const s = await updated.json();
  expect(s.responses).toHaveLength(1);
  expect(s.responses[0].kind).toBe('approve');
  expect(s.responses[0].addressed).toBe(false);
});
```

- [ ] **Step 2: Add the route handler in `mountRoutes`**

```ts
  const ResponseInZ = z.object({
    itemId: z.string(),
    kind: z.enum(['approve', 'comment']),
    body: z.string().optional(),
  });
  app.post('/api/sessions/:id/responses', async (c) => {
    const id = c.req.param('id');
    const parsed = ResponseInZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);
    const r = { ...parsed.data, at: Date.now(), addressed: false };
    const session = await store.update(id, (s) => ({ ...s, responses: [...s.responses, r] }));
    bus.publish(id, { type: 'state-changed', session });
    // Poke trigger lives in Phase 4 — wire it in there.
    return c.json({ accepted: true }, 202);
  });
```

- [ ] **Step 3: Test passes; commit**

```bash
git add packages/daemon
git commit -m "feat(daemon): POST /responses persists + broadcasts (poke wired later)"
```

### Task 1.7: Daemon lifecycle (port-bind guard + idle shutdown)

**Files:**
- Modify: `packages/daemon/src/index.ts`
- Create: `packages/daemon/src/lifecycle/idle.ts`
- Create: `packages/daemon/test/idle.test.ts`

- [ ] **Step 1: Test the idle tracker**

```ts
import { test, expect } from 'bun:test';
import { IdleTracker } from '../src/lifecycle/idle';

test('IdleTracker fires shutdown after the configured ms with no activity', async () => {
  let fired = false;
  const tracker = new IdleTracker({ idleMs: 50, hasClients: () => false, onShutdown: () => { fired = true; } });
  tracker.start();
  tracker.touch();
  await new Promise((r) => setTimeout(r, 75));
  expect(fired).toBe(true);
  tracker.stop();
});

test('IdleTracker resets on touch', async () => {
  let fired = false;
  const tracker = new IdleTracker({ idleMs: 80, hasClients: () => false, onShutdown: () => { fired = true; } });
  tracker.start();
  tracker.touch();
  await new Promise((r) => setTimeout(r, 50));
  tracker.touch();
  await new Promise((r) => setTimeout(r, 50));
  expect(fired).toBe(false);
  tracker.stop();
});

test('IdleTracker holds off shutdown while clients connected', async () => {
  let fired = false;
  let connected = true;
  const tracker = new IdleTracker({ idleMs: 30, hasClients: () => connected, onShutdown: () => { fired = true; } });
  tracker.start();
  tracker.touch();
  await new Promise((r) => setTimeout(r, 60));
  expect(fired).toBe(false);
  connected = false;
  tracker.touch();
  await new Promise((r) => setTimeout(r, 60));
  expect(fired).toBe(true);
  tracker.stop();
});
```

- [ ] **Step 2: Write `src/lifecycle/idle.ts`**

```ts
type Opts = { idleMs: number; hasClients: () => boolean; onShutdown: () => void };

export class IdleTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private opts: Opts) {}
  start() { this.touch(); }
  stop() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  touch() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.opts.hasClients()) {
        this.touch(); // re-arm; clients keep us alive
        return;
      }
      this.opts.onShutdown();
    }, this.opts.idleMs);
  }
}
```

- [ ] **Step 3: Wire idle into `src/index.ts`**

```ts
import { buildApp } from './http/server';
import { IdleTracker } from './lifecycle/idle';
import { homedir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.WALKTHROUGH_PORT ?? 7773);
const dataDir = join(homedir(), '.claude', 'walkthrough');
const idleMs = Number(process.env.WALKTHROUGH_IDLE_MS ?? 30 * 60 * 1000);

const app = buildApp({ port, dataDir });
const bus = (app as any)._bus as { subscriberCount(): number };

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({ port, fetch: app.fetch });
} catch (err) {
  console.error(`port ${port} unavailable; another walkthrough-daemon is likely running. exiting.`);
  process.exit(0);
}

const idle = new IdleTracker({
  idleMs,
  hasClients: () => bus.subscriberCount() > 0,
  onShutdown: () => {
    console.log('walkthrough-daemon idle, shutting down');
    server.stop();
    process.exit(0);
  },
});
idle.start();
// Touch on every fetch
const origFetch = app.fetch.bind(app);
(app as any).fetch = (req: Request) => { idle.touch(); return origFetch(req); };

console.log(`walkthrough-daemon listening on http://localhost:${server.port}`);
```

- [ ] **Step 4: Tests pass; commit**

```bash
bun test packages/daemon
git add packages/daemon
git commit -m "feat(daemon): port-bind guard + idle shutdown timer"
```

---

## Phase 2 · MCP adapter

### Task 2.1: Adapter package + RPC endpoint on daemon

**Files:**
- Create: `packages/mcp-adapter/package.json`
- Create: `packages/mcp-adapter/tsconfig.json`
- Create: `packages/mcp-adapter/src/index.ts`
- Create: `packages/mcp-adapter/src/forward.ts`
- Modify: `packages/daemon/src/http/routes.ts` (add `/api/rpc`)
- Create: `packages/daemon/src/tools/index.ts`
- Create: `packages/daemon/test/rpc.test.ts`

- [ ] **Step 1: Test the RPC endpoint dispatches to a tool**

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

test('POST /api/rpc start_review creates a session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  const r = await app.fetch(new Request('http://localhost/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-session-id': 'cs-123' },
    body: JSON.stringify({ method: 'start_review', params: { projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] } }),
  }));
  expect(r.status).toBe(200);
  const result = await r.json();
  expect(result.sessionId).toBeDefined();
  expect(result.url).toContain('localhost');
});
```

- [ ] **Step 2: Write `src/tools/index.ts` (daemon side)**

```ts
import { z } from 'zod';
import { ItemZ, type Session } from '@walkthrough/shared';
import type { Store } from '../store/sessions';
import type { Bus } from '../http/sse';

type Ctx = { store: Store; bus: Bus; baseUrl: string; clientSessionId?: string };

const StartReviewZ = z.object({
  projectRoot: z.string(),
  branch: z.string().optional(),
  items: z.array(ItemZ.omit({ index: true }).partial({ id: true, attachments: true })),
});

export const tools = {
  async start_review(ctx: Ctx, params: unknown) {
    const p = StartReviewZ.parse(params);
    const existing = await ctx.store.getActive(p.projectRoot);
    if (existing && existing.status !== 'idle') {
      throw new Error(`ALREADY_ACTIVE:${existing.id}`);
    }
    const session = await ctx.store.create({ ...p, clientSessionId: ctx.clientSessionId } as any);
    ctx.bus.publish(session.id, { type: 'state-snapshot', session });
    return { sessionId: session.id, url: `${ctx.baseUrl}/?session=${session.id}` };
  },

  async add_items(ctx: Ctx, params: unknown) {
    const P = z.object({ sessionId: z.string(), items: z.array(ItemZ) });
    const { sessionId, items } = P.parse(params);
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      items: [...s.items, ...items.map((it, i) => ({ ...it, index: s.items.length + i + 1 }))],
    }));
    ctx.bus.publish(sessionId, { type: 'item-added', sessionId, items });
    ctx.bus.publish(sessionId, { type: 'state-changed', session });
    return { ok: true };
  },

  async get_state(ctx: Ctx, params: unknown) {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(params);
    const session = await ctx.store.get(sessionId);
    if (!session) throw new Error('NOT_FOUND');
    return session;
  },

  async get_unread_responses(ctx: Ctx, params: unknown) {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(params);
    let snapshot: Session | null = null;
    const session = await ctx.store.update(sessionId, (s) => {
      const unread = s.responses.filter((r) => !r.addressed);
      if (unread.length === 0) {
        snapshot = s;
        return s;
      }
      return { ...s, responses: s.responses.map((r) => ({ ...r, addressed: true })) };
    });
    return session.responses.filter((r) => snapshot ? !snapshot.responses.find((q) => q.itemId === r.itemId && q.at === r.at)?.addressed : true);
  },

  async mark_addressing(ctx: Ctx, params: unknown) {
    const P = z.object({ sessionId: z.string(), itemId: z.string().nullable(), narration: z.string() });
    const { sessionId, itemId, narration } = P.parse(params);
    const session = await ctx.store.update(sessionId, (s) => ({
      ...s,
      agentActivity: [...s.agentActivity, { at: Date.now(), tool: 'mark_addressing', narration }].slice(-50),
    }));
    ctx.bus.publish(sessionId, { type: 'agent-activity', sessionId, entry: { at: Date.now(), tool: 'mark_addressing', narration } });
    ctx.bus.publish(sessionId, { type: 'state-changed', session });
    return { ok: true };
  },

  async complete_review(ctx: Ctx, params: unknown) {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(params);
    const session = await ctx.store.update(sessionId, (s) => ({ ...s, status: 'complete' }));
    ctx.bus.publish(sessionId, { type: 'complete', sessionId });
    ctx.bus.publish(sessionId, { type: 'state-changed', session });
    return { ok: true };
  },
};

export type ToolName = keyof typeof tools;
```

- [ ] **Step 3: Wire `/api/rpc` in `routes.ts` (append to `mountRoutes`)**

```ts
  const RpcZ = z.object({ method: z.string(), params: z.unknown() });
  app.post('/api/rpc', async (c) => {
    const parsed = RpcZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);
    const { tools } = await import('../tools');
    const fn = (tools as Record<string, Function>)[parsed.data.method];
    if (!fn) return c.json({ error: `UNKNOWN_TOOL: ${parsed.data.method}` }, 404);
    try {
      const clientSessionId = c.req.header('x-client-session-id') ?? undefined;
      const baseUrl = `http://localhost:${opts.port}`;
      const result = await fn({ store, bus, baseUrl, clientSessionId }, parsed.data.params);
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.startsWith('ALREADY_ACTIVE') ? 409 : msg === 'NOT_FOUND' ? 404 : 500;
      return c.json({ error: msg }, status);
    }
  });
```

- [ ] **Step 4: Tests pass; commit**

```bash
bun test packages/daemon
git add packages/daemon
git commit -m "feat(daemon): tools + /api/rpc dispatcher"
```

### Task 2.2: MCP stdio adapter — forwarder + auto-spawn-daemon

**Files:**
- Create: `packages/mcp-adapter/src/forward.ts`
- Create: `packages/mcp-adapter/src/index.ts`
- Create: `packages/mcp-adapter/test/forward.test.ts`

- [ ] **Step 1: `packages/mcp-adapter/package.json`**

```json
{
  "name": "@walkthrough/mcp-adapter",
  "type": "module",
  "version": "0.0.1",
  "bin": { "walkthrough-mcp": "./src/index.ts" },
  "dependencies": {
    "@walkthrough/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: `packages/mcp-adapter/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 3: Test the forwarder against a running daemon**

```ts
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '@walkthrough/daemon/src/http/server';
import { Forwarder } from '../src/forward';

let server: ReturnType<typeof Bun.serve>;
let port: number;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir });
  server = Bun.serve({ port: 0, fetch: app.fetch });
  port = server.port;
});
afterAll(() => server.stop());

test('Forwarder.call hits /api/rpc and returns the result', async () => {
  const fwd = new Forwarder({ baseUrl: `http://localhost:${port}`, clientSessionId: 'cs-1' });
  const result = await fwd.call('start_review', { projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }] });
  expect((result as any).sessionId).toBeDefined();
});
```

- [ ] **Step 4: Write `src/forward.ts`**

```ts
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export class Forwarder {
  constructor(private opts: { baseUrl: string; clientSessionId?: string }) {}

  async call(method: string, params: unknown): Promise<unknown> {
    await this.ensureDaemon();
    const res = await fetch(`${this.opts.baseUrl}/api/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.clientSessionId ? { 'x-client-session-id': this.opts.clientSessionId } : {}),
      },
      body: JSON.stringify({ method, params }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(typeof body === 'object' && body && 'error' in body ? String((body as any).error) : `HTTP ${res.status}`);
    return body;
  }

  private async ensureDaemon(): Promise<void> {
    try {
      const r = await fetch(`${this.opts.baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch {
      // not running — spawn it
    }
    const child = spawn('bun', ['run', new URL('../../daemon/src/index.ts', import.meta.url).pathname], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, WALKTHROUGH_PORT: String(new URL(this.opts.baseUrl).port) },
    });
    child.unref();
    // Wait up to 3s for the daemon to bind
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(`${this.opts.baseUrl}/health`, { signal: AbortSignal.timeout(200) });
        if (r.ok) return;
      } catch {}
      await sleep(100);
    }
    throw new Error('daemon failed to start');
  }
}
```

- [ ] **Step 5: Test passes; commit**

```bash
bun test packages/mcp-adapter
git add packages
git commit -m "feat(mcp-adapter): HTTP forwarder + auto-spawn-daemon"
```

### Task 2.3: MCP stdio bindings

**Files:**
- Create: `packages/mcp-adapter/src/index.ts`

- [ ] **Step 1: Write `src/index.ts`**

```ts
#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Forwarder } from './forward';

const port = Number(process.env.WALKTHROUGH_PORT ?? 7773);
const baseUrl = `http://localhost:${port}`;
const clientSessionId = process.env.CLAUDE_SESSION_ID;
const fwd = new Forwarder({ baseUrl, clientSessionId });

const tools = [
  {
    name: 'start_review',
    description: 'Start a walkthrough review session with N items. Returns { sessionId, url }.',
    inputSchema: {
      type: 'object',
      required: ['projectRoot', 'items'],
      properties: {
        projectRoot: { type: 'string' },
        branch: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'body'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              body: { type: 'string' },
              question: { type: 'string' },
              attachments: { type: 'array' },
            },
          },
        },
      },
    },
  },
  { name: 'add_items', description: 'Append items to an existing session.', inputSchema: { type: 'object', required: ['sessionId', 'items'], properties: { sessionId: { type: 'string' }, items: { type: 'array' } } } },
  { name: 'get_state', description: 'Read the full session state.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } } },
  { name: 'get_unread_responses', description: 'Get all unread responses; marks them addressed atomically.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } } },
  { name: 'mark_addressing', description: 'Update the status pill so the user sees what the agent is doing.', inputSchema: { type: 'object', required: ['sessionId', 'narration'], properties: { sessionId: { type: 'string' }, itemId: { type: 'string' }, narration: { type: 'string' } } } },
  { name: 'complete_review', description: 'End the review session.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } } },
];

const server = new Server({ name: 'walkthrough', version: '0.0.1' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await fwd.call(req.params.name, req.params.arguments ?? {});
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

await server.connect(new StdioServerTransport());
```

- [ ] **Step 2: Smoke test manually**

```bash
# Start daemon in one terminal
bun run packages/daemon/src/index.ts
# In another, send a list-tools request via stdio
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | bun run packages/mcp-adapter/src/index.ts
```

Expected: JSON response listing the 6 tools.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-adapter
git commit -m "feat(mcp-adapter): stdio bindings for all 6 tools"
```

---

## Phase 3 · Browser drawer (the visible result)

### Task 3.1: Inject package + Vite + Solid + Web Component shell

**Files:**
- Create: `packages/inject/package.json`
- Create: `packages/inject/tsconfig.json`
- Create: `packages/inject/vite.config.ts`
- Create: `packages/inject/src/index.tsx`
- Create: `packages/inject/src/components/App.tsx`
- Modify: `packages/daemon/src/http/routes.ts` (serve `/inject.js`)
- Create: `packages/daemon/test-fixtures/host.html` (manual test page)

- [ ] **Step 1: `packages/inject/package.json`**

```json
{
  "name": "@walkthrough/inject",
  "type": "module",
  "version": "0.0.1",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch"
  },
  "dependencies": {
    "@walkthrough/shared": "workspace:*",
    "solid-js": "^1.8.0"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "vite-plugin-solid": "^2.10.0"
  }
}
```

- [ ] **Step 2: `packages/inject/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "preserve", "jsxImportSource": "solid-js" },
  "include": ["src"]
}
```

- [ ] **Step 3: `packages/inject/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  build: {
    target: 'es2022',
    lib: { entry: 'src/index.tsx', formats: ['iife'], name: 'WalkthroughDrawer', fileName: () => 'inject.js' },
    rollupOptions: { output: { extend: true } },
    minify: 'esbuild',
    cssCodeSplit: false,
  },
});
```

- [ ] **Step 4: `packages/inject/src/components/App.tsx` (placeholder)**

```tsx
import { type Component } from 'solid-js';

export const App: Component = () => {
  return (
    <div style={{ position: 'fixed', top: '12px', right: '12px', padding: '8px 12px', background: '#000', color: '#fff', 'font-family': 'monospace', 'font-size': '11px', 'z-index': 999_999 }}>
      WALKTHROUGH · attached
    </div>
  );
};
```

- [ ] **Step 5: `packages/inject/src/index.tsx`**

```tsx
import { render } from 'solid-js/web';
import { App } from './components/App';

class WalkthroughDrawer extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'closed' });
    render(() => <App />, root);
  }
}

if (!customElements.get('walkthrough-drawer')) {
  customElements.define('walkthrough-drawer', WalkthroughDrawer);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(new WalkthroughDrawer()));
  } else {
    document.body.appendChild(new WalkthroughDrawer());
  }
}
```

- [ ] **Step 6: Build the inject bundle**

```bash
cd packages/inject && bun run build && cd ../..
ls packages/inject/dist/inject.js
```

- [ ] **Step 7: Daemon serves `/inject.js`** — append to `mountRoutes` in `routes.ts`

```ts
  app.get('/inject.js', async () => {
    const file = Bun.file(new URL('../../../inject/dist/inject.js', import.meta.url));
    return new Response(file, { headers: { 'content-type': 'application/javascript', 'cache-control': 'no-cache' } });
  });
```

- [ ] **Step 8: Manual smoke** — `packages/daemon/test-fixtures/host.html`

```html
<!doctype html>
<html><body>
<h1>Host app</h1>
<script src="http://localhost:7773/inject.js"></script>
</body></html>
```

Open in browser after starting the daemon — you should see "WALKTHROUGH · attached" in the top right.

- [ ] **Step 9: Commit**

```bash
git add packages
git commit -m "feat(inject): Web Component + Solid app skeleton served by daemon"
```

### Task 3.2: SSE client + state store

**Files:**
- Create: `packages/inject/src/state/client.ts`
- Create: `packages/inject/src/state/store.ts`
- Modify: `packages/inject/src/components/App.tsx`

- [ ] **Step 1: Write `src/state/client.ts`**

```ts
import type { Session, SseEvent } from '@walkthrough/shared';

const baseUrl = (() => {
  // The inject script lives on the daemon's port; same-origin works.
  if (typeof window === 'undefined') return 'http://localhost:7773';
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (src) {
    try { return new URL(src).origin; } catch {}
  }
  return 'http://localhost:7773';
})();

export async function fetchActiveSession(projectRoot: string): Promise<Session | null> {
  const r = await fetch(`${baseUrl}/api/sessions/active?projectRoot=${encodeURIComponent(projectRoot)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`active fetch failed: ${r.status}`);
  return r.json();
}

export function openEventStream(sessionId: string, on: (e: SseEvent) => void): () => void {
  const es = new EventSource(`${baseUrl}/api/sessions/${sessionId}/events`);
  for (const t of ['state-snapshot', 'state-changed', 'item-added', 'agent-activity', 'complete'] as const) {
    es.addEventListener(t, (m) => on(JSON.parse((m as MessageEvent).data)));
  }
  return () => es.close();
}

export async function submitResponse(sessionId: string, body: { itemId: string; kind: 'approve' | 'comment'; body?: string }): Promise<void> {
  const r = await fetch(`${baseUrl}/api/sessions/${sessionId}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`submit failed: ${r.status}`);
}

export { baseUrl };
```

- [ ] **Step 2: Write `src/state/store.ts`**

```ts
import { createSignal, createEffect } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { Session, SseEvent } from '@walkthrough/shared';
import { fetchActiveSession, openEventStream } from './client';

export const [session, setSession] = createStore<Session | null>(null);
export const [currentItemIdx, setCurrentItemIdx] = createSignal(0);
export const [pokeStatus, setPokeStatus] = createSignal<'idle' | 'working' | 'failed'>('idle');

export function applyEvent(e: SseEvent): void {
  switch (e.type) {
    case 'state-snapshot':
    case 'state-changed':
      setSession(e.session);
      break;
    case 'item-added':
      setSession(produce((s) => {
        if (!s) return;
        const start = s.items.length;
        for (let i = 0; i < e.items.length; i++) {
          s.items.push({ ...e.items[i]!, index: start + i + 1 });
        }
      }));
      break;
    case 'agent-activity':
      setSession(produce((s) => { s?.agentActivity.push(e.entry); }));
      setPokeStatus('working');
      break;
    case 'complete':
      setSession(produce((s) => { if (s) s.status = 'complete'; }));
      break;
  }
}

export async function bootstrap(projectRoot: string): Promise<() => void> {
  const initial = await fetchActiveSession(projectRoot);
  if (initial) {
    setSession(initial);
    return openEventStream(initial.id, applyEvent);
  }
  return () => {};
}
```

- [ ] **Step 3: Update `App.tsx` to bootstrap**

```tsx
import { type Component, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { bootstrap, session } from '../state/store';

export const App: Component = () => {
  const [closer, setCloser] = createSignal<() => void>(() => {});

  onMount(async () => {
    // For MVP, projectRoot comes from a query param injected by the agent or just window.location.
    const projectRoot = new URLSearchParams(window.location.search).get('walkthrough-project') ?? window.location.origin;
    const close = await bootstrap(projectRoot);
    setCloser(() => close);
  });

  onCleanup(() => closer()());

  return (
    <Show when={session} fallback={<div style={{ position: 'fixed', top: '12px', right: '12px', padding: '8px 12px', background: '#000', color: '#fff', 'font-family': 'monospace', 'font-size': '11px', 'z-index': 999_999 }}>WALKTHROUGH · idle</div>}>
      <div style={{ position: 'fixed', top: '12px', right: '12px', padding: '8px 12px', background: '#000', color: '#0f0', 'font-family': 'monospace', 'font-size': '11px', 'z-index': 999_999 }}>
        WALKTHROUGH · {session?.items.length ?? 0} items · session {session?.id}
      </div>
    </Show>
  );
};
```

- [ ] **Step 4: Rebuild + smoke test**

```bash
cd packages/inject && bun run build && cd ../..
# In two terminals:
bun run packages/daemon/src/index.ts
# Then in browser, with host.html open at localhost:8080?walkthrough-project=/tmp/p
# Trigger a session via curl:
curl -X POST http://localhost:7773/api/sessions -H 'content-type: application/json' \
  -d '{"projectRoot":"/tmp/p","items":[{"title":"T","body":"B"}]}'
```

Refresh the host page; the floater should switch from "idle" to "1 items · session …".

- [ ] **Step 5: Commit**

```bash
git add packages/inject
git commit -m "feat(inject): SSE client + reactive store, bootstraps on mount"
```

### Task 3.3: Drawer chrome + dot-grid + type pair (visual)

**Files:**
- Create: `packages/inject/src/styles/tokens.css`
- Create: `packages/inject/src/styles/drawer.css`
- Create: `packages/inject/src/components/Drawer.tsx`
- Create: `packages/inject/src/components/Header.tsx`
- Create: `packages/inject/src/components/PipStrip.tsx`
- Create: `packages/inject/src/components/Footer.tsx`
- Create: `packages/inject/src/components/StatusTag.tsx`
- Modify: `packages/inject/src/components/App.tsx`

- [ ] **Step 1: `src/styles/tokens.css`** — paste the OKLCH palette from §7 of the spec (dark + light)

```css
:host { color-scheme: dark; }

:host {
  --bg-paper: oklch(0.165 0.004 70);
  --bg-rail: oklch(0.185 0.004 70);
  --bg-panel: oklch(0.205 0.005 70);
  --bg-input: oklch(0.13 0.004 70);
  --dot: oklch(0.27 0.005 70);
  --t1: oklch(0.94 0.006 70);
  --t2: oklch(0.78 0.008 70);
  --t3: oklch(0.62 0.010 70);
  --t4: oklch(0.46 0.010 70);
  --rule-1: oklch(0.26 0.006 70);
  --rule-2: oklch(0.34 0.008 70);
  --rule-3: oklch(0.50 0.010 70);
  --amber: oklch(0.84 0.15 70);
  --amber-soft: oklch(0.32 0.06 70);
  --amber-text: oklch(0.88 0.13 70);
  --ok: oklch(0.74 0.13 150);
  --err: oklch(0.66 0.18 30);
  --mono: 'Martian Mono', ui-monospace, 'SF Mono', monospace;
  --sans: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
}

:host(.theme-light) {
  color-scheme: light;
  --bg-paper: oklch(0.985 0.003 70);
  --bg-rail: oklch(0.97 0.004 70);
  --bg-panel: oklch(0.99 0.003 70);
  --bg-input: oklch(1 0 0);
  --dot: oklch(0.84 0.006 70);
  --t1: oklch(0.18 0.005 70);
  --t2: oklch(0.36 0.008 70);
  --t3: oklch(0.50 0.010 70);
  --t4: oklch(0.66 0.010 70);
  --rule-1: oklch(0.92 0.006 70);
  --rule-2: oklch(0.84 0.008 70);
  --rule-3: oklch(0.66 0.010 70);
  --amber: oklch(0.62 0.18 60);
  --amber-soft: oklch(0.93 0.10 75);
  --amber-text: oklch(0.45 0.18 50);
}
```

- [ ] **Step 2: `src/styles/drawer.css`** — drawer layout (paste the full CSS we used in the v2 craft mockup; it's at `/tmp/brainstorm-87856-1777817845/content/craft-v2-injected.html`, all the `.drawer`, `.metabar`, `.dheader`, `.tag`, `.pips`, `.dfooter` rules. Trim the `.stage` and `.app` host-app simulation; keep the drawer-internal styles only.)

- [ ] **Step 3: `src/components/StatusTag.tsx`**

```tsx
import { type Component, Show } from 'solid-js';
import type { Session } from '@walkthrough/shared';

export type PillState = 'idle' | 'working' | 'addressing' | 'writing' | 'failed' | 'complete';

export function derivePill(session: Session | null, pokeStatus: 'idle' | 'working' | 'failed'): { state: PillState; label: string } {
  if (!session) return { state: 'idle', label: '' };
  if (session.status === 'complete') return { state: 'complete', label: 'REVIEW_COMPLETE' };
  if (pokeStatus === 'failed') return { state: 'failed', label: 'POKE_FAILED · CLICK_RETRY' };
  const last = session.agentActivity.at(-1);
  const fresh = last && Date.now() - last.at < 5000;
  if (fresh && last.tool === 'mark_addressing') return { state: 'addressing', label: last.narration ?? 'ADDRESSING' };
  if (fresh && last.tool === 'add_items') return { state: 'writing', label: 'WRITING_ITEMS' };
  if (fresh) return { state: 'working', label: 'PREPARING_NEXT' };
  return { state: 'idle', label: '' };
}

export const StatusTag: Component<{ pill: ReturnType<typeof derivePill> }> = (props) => (
  <Show when={props.pill.state !== 'idle'}>
    <span class={`tag ${props.pill.state}`}>
      <span class="dot-cell"><span class={props.pill.state === 'working' || props.pill.state === 'addressing' ? 'pulse-dot' : 'static-dot'} /></span>
      <span class="rule-cell" />
      <span class="label-cell">{props.pill.label}</span>
    </span>
  </Show>
);
```

- [ ] **Step 4: `src/components/Header.tsx`**

```tsx
import { type Component } from 'solid-js';
import { session, pokeStatus } from '../state/store';
import { StatusTag, derivePill } from './StatusTag';

export const Header: Component = () => {
  const pill = () => derivePill(session, pokeStatus());
  return (
    <header class="dheader">
      <div class="mark">W</div>
      <div>
        <div class="name">WALKTHROUGH</div>
        <div class="ctx">{session?.branch ?? session?.projectRoot ?? '—'}</div>
      </div>
      <StatusTag pill={pill()} />
      <button class="x-btn">×</button>
    </header>
  );
};
```

- [ ] **Step 5: `src/components/PipStrip.tsx`**

```tsx
import { type Component, For } from 'solid-js';
import { session, currentItemIdx, setCurrentItemIdx } from '../state/store';

function glyphFor(state: 'approved' | 'commented' | 'focused' | 'pending'): string {
  return { approved: '✓', commented: '•', focused: '▸', pending: '·' }[state];
}

export const PipStrip: Component = () => {
  const items = () => session?.items ?? [];
  const responsesByItem = () => {
    const m = new Map<string, 'approved' | 'commented'>();
    for (const r of session?.responses ?? []) {
      const cur = m.get(r.itemId);
      if (r.kind === 'comment') m.set(r.itemId, 'commented');
      else if (cur !== 'commented') m.set(r.itemId, 'approved');
    }
    return m;
  };
  return (
    <div class="pips">
      <For each={items()}>
        {(item, i) => {
          const state = (): 'approved' | 'commented' | 'focused' | 'pending' => {
            if (i() === currentItemIdx()) return 'focused';
            return responsesByItem().get(item.id) ?? 'pending';
          };
          return (
            <div class={`pip ${state()}`} onClick={() => setCurrentItemIdx(i())}>
              <span class="glyph">{glyphFor(state())}</span>
              <span class="num">{item.id}</span>
            </div>
          );
        }}
      </For>
    </div>
  );
};
```

- [ ] **Step 6: `src/components/Footer.tsx`**

```tsx
import { type Component, createMemo } from 'solid-js';
import { session } from '../state/store';

export const Footer: Component = () => {
  const counts = createMemo(() => {
    const items = session?.items ?? [];
    const responses = session?.responses ?? [];
    const approved = items.filter((i) => responses.some((r) => r.itemId === i.id && r.kind === 'approve')).length;
    const commented = items.filter((i) => responses.some((r) => r.itemId === i.id && r.kind === 'comment')).length;
    const left = items.length - approved - commented;
    return { approved, commented, left };
  });
  return (
    <footer class="dfooter">
      <div class="counts">
        <span class="ok-c"><span class="v">{String(counts().approved).padStart(2, '0')}</span>_OK</span>
        <span class="am-c"><span class="v">{String(counts().commented).padStart(2, '0')}</span>_QUEUED</span>
        <span><span class="v">{String(counts().left).padStart(2, '0')}</span>_LEFT</span>
      </div>
      <div class="actions-r">
        <button class="footer-btn">STOP</button>
        <button class="footer-btn">DONE</button>
      </div>
    </footer>
  );
};
```

- [ ] **Step 7: `src/components/Drawer.tsx`**

```tsx
import { type Component, Show } from 'solid-js';
import tokensCss from '../styles/tokens.css?raw';
import drawerCss from '../styles/drawer.css?raw';
import googleFonts from '../styles/google-fonts.css?raw';
import { Header } from './Header';
import { PipStrip } from './PipStrip';
import { Footer } from './Footer';
import { Detail } from './Detail';
import { session } from '../state/store';

export const Drawer: Component = () => (
  <>
    <style>{googleFonts}</style>
    <style>{tokensCss}</style>
    <style>{drawerCss}</style>
    <Show when={session} fallback={<aside class="drawer empty">…</aside>}>
      <aside class="drawer">
        <div class="metabar">
          <span>~/.claude/walkthrough/sessions/{session?.id}.json</span>
          <span class="center">S#{session?.id}</span>
          <span class="right">T=…</span>
        </div>
        <Header />
        <PipStrip />
        <Detail />
        <Footer />
      </aside>
    </Show>
  </>
);
```

- [ ] **Step 8: `src/styles/google-fonts.css`** (loaded via Shadow DOM-injected `<style>` since `@import` works inside `<style>`)

```css
@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Martian+Mono:wght@300;400;500;600&display=swap');
```

- [ ] **Step 9: Update `App.tsx` to render `<Drawer />` instead of the placeholder**

```tsx
import { type Component, onCleanup, onMount, createSignal } from 'solid-js';
import { bootstrap } from '../state/store';
import { Drawer } from './Drawer';

export const App: Component = () => {
  const [closer, setCloser] = createSignal<() => void>(() => {});
  onMount(async () => {
    const projectRoot = new URLSearchParams(window.location.search).get('walkthrough-project') ?? window.location.origin;
    const close = await bootstrap(projectRoot);
    setCloser(() => close);
  });
  onCleanup(() => closer()());
  return <Drawer />;
};
```

- [ ] **Step 10: Stub `Detail.tsx` so the Drawer compiles**

```tsx
import { type Component } from 'solid-js';
export const Detail: Component = () => <div class="detail-scroll">…detail comes in next task…</div>;
```

- [ ] **Step 11: Build + smoke + commit**

```bash
cd packages/inject && bun run build && cd ../..
# Refresh host.html — drawer chrome should appear with pip-strip + counts
git add packages/inject
git commit -m "feat(inject): drawer chrome (header, pip-strip, footer, status pill)"
```

### Task 3.4: Detail pane (markdown body, file refs, comment box, actions)

**Files:**
- Modify: `packages/inject/src/components/Detail.tsx`
- Create: `packages/inject/src/components/FileRef.tsx`
- Add dep: `marked` (markdown rendering)
- Modify: `packages/inject/package.json`

- [ ] **Step 1: Add marked**

```bash
cd packages/inject && bun add marked && cd ../..
```

- [ ] **Step 2: `src/components/FileRef.tsx`**

```tsx
import { type Component } from 'solid-js';
import type { Attachment } from '@walkthrough/shared';

const editorScheme = 'cursor'; // overridden by config in Phase 6

function buildEditorUrl(att: Extract<Attachment, { kind: 'file-ref' }>): string {
  const lineSuffix = att.line ? `:${att.line}` : '';
  return `${editorScheme}://file/${att.path}${lineSuffix}`;
}

export const FileRef: Component<{ att: Extract<Attachment, { kind: 'file-ref' }> }> = (props) => (
  <div class="fileref">
    <a class="path" href={buildEditorUrl(props.att)}>{props.att.path}{props.att.line ? `:${props.att.line}` : ''}</a>
    <span class="stats">
      {props.att.diffStats && (
        <>
          <span class="add">+{props.att.diffStats.add}</span>
          <span class="sep">/</span>
          <span class="rem">−{props.att.diffStats.rem}</span>
          <span class="sep">·</span>
          <span>{props.att.diffStats.hunks} hunk{props.att.diffStats.hunks === 1 ? '' : 's'}</span>
        </>
      )}
    </span>
  </div>
);
```

- [ ] **Step 3: Rewrite `src/components/Detail.tsx`**

```tsx
import { type Component, createSignal, For, Show } from 'solid-js';
import { marked } from 'marked';
import { session, currentItemIdx, setCurrentItemIdx } from '../state/store';
import { submitResponse } from '../state/client';
import { FileRef } from './FileRef';

export const Detail: Component = () => {
  const item = () => session?.items[currentItemIdx()];
  const [comment, setComment] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);

  const onApprove = async () => {
    const it = item();
    if (!it || !session) return;
    setSubmitting(true);
    try {
      await submitResponse(session.id, { itemId: it.id, kind: 'approve' });
      // Local auto-advance
      const next = Math.min((session.items.length - 1), currentItemIdx() + 1);
      setCurrentItemIdx(next);
    } finally {
      setSubmitting(false);
    }
  };

  const onComment = async () => {
    const it = item();
    if (!it || !session || !comment().trim()) return;
    setSubmitting(true);
    try {
      await submitResponse(session.id, { itemId: it.id, kind: 'comment', body: comment().trim() });
      setComment('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show when={item()} fallback={<div class="detail-scroll">No items.</div>}>
      <div class="detail-scroll">
        <div class="detail-eyebrow">
          ITEM_{item()!.id} <span class="sep">/</span> {String((session?.items.length ?? 0)).padStart(2, '0')}
        </div>
        <h2 class="detail-title">{item()!.title}</h2>
        <div class="detail-body" innerHTML={marked.parse(item()!.body) as string} />
        <For each={item()!.attachments.filter((a) => a.kind === 'file-ref')}>
          {(att) => <FileRef att={att as any} />}
        </For>
        <Show when={item()!.question}>
          <div class="qline">{item()!.question}</div>
        </Show>
        <textarea
          class="cbox"
          placeholder="optional comment · leave blank if it's good as-is"
          value={comment()}
          onInput={(e) => setComment(e.currentTarget.value)}
          disabled={submitting()}
        />
        <div class="actions">
          <button class="btn btn-primary" onClick={onApprove} disabled={submitting()}>LOOKS_GOOD <span class="kbd">↵</span></button>
          <button class="btn btn-secondary" onClick={onComment} disabled={submitting() || !comment().trim()}>SEND_COMMENT <span class="kbd">⌘↵</span></button>
        </div>
      </div>
    </Show>
  );
};
```

- [ ] **Step 4: Build + smoke**

```bash
cd packages/inject && bun run build && cd ../..
# Trigger a session with multiple items via curl, then:
# - Click LOOKS_GOOD → next item should focus, response persists.
# - Type a comment + click SEND_COMMENT → comment persists, comment-count goes up.
```

- [ ] **Step 5: Commit**

```bash
git add packages/inject
git commit -m "feat(inject): detail pane with markdown body, file refs, comment + approve actions"
```

### Task 3.5: Keyboard shortcuts (j/k/⏎/c/⌘⏎/esc)

**Files:**
- Create: `packages/inject/src/state/keyboard.ts`
- Modify: `packages/inject/src/components/App.tsx`

- [ ] **Step 1: Write `src/state/keyboard.ts`**

```ts
import { onCleanup } from 'solid-js';
import { session, currentItemIdx, setCurrentItemIdx } from './store';
import { submitResponse } from './client';

type Handler = (e: KeyboardEvent) => boolean | void;

export function installKeyboard(getCommentEl: () => HTMLTextAreaElement | null) {
  const next = () => {
    if (!session) return;
    setCurrentItemIdx(Math.min(session.items.length - 1, currentItemIdx() + 1));
  };
  const prev = () => setCurrentItemIdx(Math.max(0, currentItemIdx() - 1));

  const handlers: Record<string, Handler> = {
    j: next,
    ArrowDown: next,
    k: prev,
    ArrowUp: prev,
    Enter: (e) => {
      // ⏎ on its own approves; ⌘⏎ inside the comment box submits the comment
      if (document.activeElement === getCommentEl()) return false;
      if (!session) return;
      const item = session.items[currentItemIdx()];
      if (!item) return;
      submitResponse(session.id, { itemId: item.id, kind: 'approve' }).then(next);
      e.preventDefault();
    },
    c: (e) => {
      const ta = getCommentEl();
      if (ta) { ta.focus(); e.preventDefault(); }
    },
    Escape: () => {
      const ta = getCommentEl();
      if (document.activeElement === ta) ta?.blur();
    },
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey && e.key === 'Enter') {
      // ⌘⏎ — submit comment
      const ta = getCommentEl();
      const body = ta?.value.trim();
      if (session && body) {
        const item = session.items[currentItemIdx()];
        if (item) {
          submitResponse(session.id, { itemId: item.id, kind: 'comment', body });
          if (ta) ta.value = '';
        }
      }
      return;
    }
    const h = handlers[e.key];
    if (h) h(e);
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
}
```

- [ ] **Step 2: Wire in `App.tsx`**

```tsx
import { onMount } from 'solid-js';
import { installKeyboard } from '../state/keyboard';

// inside App component, after onMount bootstrap:
onMount(() => {
  installKeyboard(() => document.querySelector('walkthrough-drawer')?.shadowRoot?.querySelector('textarea.cbox') as HTMLTextAreaElement | null);
});
```

- [ ] **Step 3: Smoke + commit**

```bash
cd packages/inject && bun run build && cd ../..
# Verify j/k cycles items; ⏎ approves; c focuses comment; ⌘⏎ submits.
git add packages/inject
git commit -m "feat(inject): keyboard shortcuts j/k/⏎/c/⌘⏎/esc"
```

---

## Phase 4 · Poke runner (close the loop)

### Task 4.1: Poke abstraction + claude-resume strategy

**Files:**
- Create: `packages/daemon/src/poke/index.ts`
- Create: `packages/daemon/src/poke/claude-resume.ts`
- Create: `packages/daemon/test/poke.test.ts`

- [ ] **Step 1: Test the spawn args**

```ts
import { test, expect, mock } from 'bun:test';
import { ClaudeResumePoke } from '../src/poke/claude-resume';

test('claude-resume builds the right argv', async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const fakeSpawn = mock((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { unref: () => {}, pid: 12345, on: () => {} } as any;
  });
  const poke = new ClaudeResumePoke({ spawn: fakeSpawn as any });
  await poke.trigger({
    sessionId: 'abc',
    clientSessionId: 'cs-1',
    context: 'User commented on item 03: please tighten the layout.',
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.cmd).toBe('claude');
  expect(calls[0]!.args).toContain('--resume');
  expect(calls[0]!.args).toContain('cs-1');
  expect(calls[0]!.args).toContain('--print');
  expect(calls[0]!.args.at(-1)).toContain('item 03');
});

test('claude-resume throws when clientSessionId is missing', async () => {
  const poke = new ClaudeResumePoke({});
  await expect(poke.trigger({ sessionId: 'abc', clientSessionId: undefined as any, context: 'x' })).rejects.toThrow(/clientSessionId/);
});
```

- [ ] **Step 2: Write `src/poke/index.ts`**

```ts
export type PokeArgs = {
  sessionId: string;
  clientSessionId?: string;
  context: string;
};

export interface Poke {
  trigger(args: PokeArgs): Promise<{ pid: number }>;
}
```

- [ ] **Step 3: Write `src/poke/claude-resume.ts`**

```ts
import { spawn as nodeSpawn } from 'node:child_process';
import type { Poke, PokeArgs } from './index';

type Opts = { spawn?: typeof nodeSpawn; command?: string };

export class ClaudeResumePoke implements Poke {
  constructor(private opts: Opts = {}) {}

  async trigger(args: PokeArgs): Promise<{ pid: number }> {
    if (!args.clientSessionId) throw new Error('claude-resume requires clientSessionId');
    const spawnFn = this.opts.spawn ?? nodeSpawn;
    const cmd = this.opts.command ?? 'claude';
    const argv = ['--resume', args.clientSessionId, '--print', args.context];
    const child = spawnFn(cmd, argv, { detached: true, stdio: 'ignore' });
    child.unref();
    return { pid: child.pid! };
  }
}
```

- [ ] **Step 4: Tests pass; commit**

```bash
bun test packages/daemon
git add packages/daemon
git commit -m "feat(daemon): poke runner — claude-resume strategy"
```

### Task 4.2: Wire poke into the response POST + at-most-one-poke invariant

**Files:**
- Modify: `packages/daemon/src/http/routes.ts`
- Modify: `packages/daemon/src/store/sessions.ts` (track pokePid + pokeSpawnedAt)
- Create: `packages/daemon/test/poke-policy.test.ts`

- [ ] **Step 1: Test the policy** — comment fires poke; second comment during in-flight does NOT fire a second poke; looks-good never fires.

```ts
import { test, expect, mock } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/http/server';

test('poke policy: comment fires poke, second comment piggybacks, looks-good silent', async () => {
  const fakeSpawn = mock(() => ({ unref: () => {}, pid: 99, on: () => {} } as any));
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  const app = buildApp({ port: 0, dataDir: dir, spawn: fakeSpawn as any });

  const create = await app.fetch(new Request('http://localhost/api/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectRoot: '/tmp/p', items: [{ title: 'T', body: 'B' }], clientSessionId: 'cs-1' }),
  }));
  const session = await create.json();

  // looks-good: no poke
  await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/responses`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '01', kind: 'approve' }),
  }));
  expect(fakeSpawn).toHaveBeenCalledTimes(0);

  // first comment: poke fires
  await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/responses`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '01', kind: 'comment', body: 'too tight' }),
  }));
  expect(fakeSpawn).toHaveBeenCalledTimes(1);

  // second comment: in-flight, no second spawn
  await app.fetch(new Request(`http://localhost/api/sessions/${session.id}/responses`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: '01', kind: 'comment', body: 'also dim the chip' }),
  }));
  expect(fakeSpawn).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Update `DaemonOpts`** — `src/http/server.ts`

```ts
export type DaemonOpts = { port: number; dataDir: string; spawn?: typeof import('node:child_process').spawn; pokeKind?: import('@walkthrough/shared').PokeKind };
```

- [ ] **Step 3: Update the response handler in `mountRoutes`** — replace the existing handler with:

```ts
  app.post('/api/sessions/:id/responses', async (c) => {
    const id = c.req.param('id');
    const parsed = ResponseInZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

    const r = { ...parsed.data, at: Date.now(), addressed: false };
    const session = await store.update(id, (s) => ({ ...s, responses: [...s.responses, r] }));
    bus.publish(id, { type: 'state-changed', session });

    // Poke policy
    const shouldPoke =
      r.kind === 'comment' &&
      session.status !== 'paused' &&
      !session.pokePid; // at-most-one-poke

    if (shouldPoke) {
      const { ClaudeResumePoke } = await import('../poke/claude-resume');
      const poke = new ClaudeResumePoke({ spawn: opts.spawn });
      const ctx = `Walkthrough item ${r.itemId} got a new comment: ${r.body}. Read get_unread_responses(${id}) for the full list.`;
      try {
        const { pid } = await poke.trigger({ sessionId: id, clientSessionId: session.clientSessionId, context: ctx });
        await store.update(id, (s) => ({ ...s, pokePid: pid, pokeSpawnedAt: Date.now() }));
      } catch (err) {
        console.error('poke failed', err);
      }
    }

    return c.json({ accepted: true }, 202);
  });
```

- [ ] **Step 4: Clear pokePid on poke completion** — in the same `routes.ts`, watch the spawned process. Update `ClaudeResumePoke` to expose an exit promise or make the route accept a callback. Simplest: use the spawn's `on('exit')`.

Update `claude-resume.ts`:

```ts
  async trigger(args: PokeArgs): Promise<{ pid: number; exited: Promise<number> }> {
    if (!args.clientSessionId) throw new Error('claude-resume requires clientSessionId');
    const spawnFn = this.opts.spawn ?? nodeSpawn;
    const cmd = this.opts.command ?? 'claude';
    const argv = ['--resume', args.clientSessionId, '--print', args.context];
    const child = spawnFn(cmd, argv, { detached: true, stdio: 'ignore' });
    child.unref();
    const exited = new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? 0)));
    return { pid: child.pid!, exited };
  }
```

Then update the route to clear pokePid after exit:

```ts
        const { pid, exited } = await poke.trigger({ sessionId: id, clientSessionId: session.clientSessionId, context: ctx });
        await store.update(id, (s) => ({ ...s, pokePid: pid, pokeSpawnedAt: Date.now() }));
        exited.then(async () => {
          const updated = await store.update(id, (s) => ({ ...s, pokePid: undefined, pokeSpawnedAt: undefined }));
          // If responses queued during in-flight remain unaddressed, fire one more.
          const stillUnread = updated.responses.some((r) => !r.addressed);
          if (stillUnread && updated.status !== 'paused') {
            const ctx2 = `Some responses queued while you were busy on session ${id}. Read get_unread_responses(${id}).`;
            try {
              const next = await poke.trigger({ sessionId: id, clientSessionId: updated.clientSessionId, context: ctx2 });
              await store.update(id, (s) => ({ ...s, pokePid: next.pid, pokeSpawnedAt: Date.now() }));
            } catch {}
          }
        });
```

- [ ] **Step 5: Test passes; commit**

```bash
bun test packages/daemon
git add packages/daemon
git commit -m "feat(daemon): wire response POST → poke; at-most-one-poke invariant"
```

### Task 4.3: End-to-end smoke

**Files:** none (manual integration)

- [ ] **Step 1: Build the inject bundle**

```bash
cd packages/inject && bun run build && cd ../..
```

- [ ] **Step 2: Configure walkthrough as an MCP server in your Claude Code settings**

Append to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "walkthrough": {
      "command": "bun",
      "args": ["run", "/Users/ammielyawson/work/studios/walkthrough/packages/mcp-adapter/src/index.ts"]
    }
  }
}
```

- [ ] **Step 3: Add the inject script to a test app**

Pick any local dev app you're running. Add to `index.html`:

```html
<script src="http://localhost:7773/inject.js"></script>
```

- [ ] **Step 4: From a Claude Code session, ask the agent to run a walkthrough**

```
Use start_review with three small items about the recent changes you made.
```

- [ ] **Step 5: Verify the loop**

- Drawer appears in the dev app showing 3 items
- Click LOOKS_GOOD — moves to item 2
- Type a comment + ⌘⏎ — submits, status pill flips to PREPARING_NEXT, then ADDRESSING_NN
- Agent's next turn (in your other terminal/UI) addresses the comment

- [ ] **Step 6: Commit any tweaks discovered**

```bash
git add -A
git commit -m "chore: phase-4 smoke-test fixups"
```

---

## Phase 5 · Drawer modes (position, size, resize)

### Task 5.1: Mode store + localStorage persistence

**Files:**
- Create: `packages/inject/src/state/modes.ts`

- [ ] **Step 1: Write the mode signals + localStorage**

```ts
import { createSignal, createEffect } from 'solid-js';

type Position = 'right' | 'left' | 'floating';
type Size = 'standard' | 'compact' | 'strip';

const KEY = 'walkthrough.modes.v1';
type Modes = { position: Position; size: Size; width: number; floatingTop: number; floatingLeft: number };

function load(): Modes {
  if (typeof localStorage === 'undefined') return { position: 'right', size: 'standard', width: 504, floatingTop: 80, floatingLeft: 80 };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...{ position: 'right' as Position, size: 'standard' as Size, width: 504, floatingTop: 80, floatingLeft: 80 }, ...JSON.parse(raw) };
  } catch {}
  return { position: 'right', size: 'standard', width: 504, floatingTop: 80, floatingLeft: 80 };
}

const initial = load();
export const [position, setPosition] = createSignal<Position>(initial.position);
export const [size, setSize] = createSignal<Size>(initial.size);
export const [width, setWidth] = createSignal(initial.width);
export const [floatingTop, setFloatingTop] = createSignal(initial.floatingTop);
export const [floatingLeft, setFloatingLeft] = createSignal(initial.floatingLeft);

createEffect(() => {
  const m: Modes = { position: position(), size: size(), width: width(), floatingTop: floatingTop(), floatingLeft: floatingLeft() };
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch {}
});

export function cyclePosition() { setPosition(({ right: 'left' as Position, left: 'floating' as Position, floating: 'right' as Position })[position()]); }
export function cycleSize() { setSize(({ standard: 'compact' as Size, compact: 'strip' as Size, strip: 'standard' as Size })[size()]); }
```

- [ ] **Step 2: Apply mode classes to the Drawer**

In `Drawer.tsx`, wrap the `<aside class="drawer">` with dynamic classes from `position()` and `size()`. Add CSS rules for each combo in `drawer.css`:

```css
.drawer.pos-right { right: 0; left: auto; top: 0; bottom: 0; }
.drawer.pos-left { left: 0; right: auto; top: 0; bottom: 0; border-left: none; border-right: 1px solid var(--rule-2); }
.drawer.pos-floating { position: fixed; }
.drawer.size-strip { width: 32px !important; }
.drawer.size-compact .detail-body { display: none; }
```

- [ ] **Step 3: Bind keymap entries `[`, `]`, `=`**

In `keyboard.ts`, add:

```ts
    '[': () => cyclePosition(),
    ']': () => cyclePosition(),
    '=': () => cycleSize(),
```

(`=` is unmodified `=`; if user wants `+`, also bind '+'.)

- [ ] **Step 4: Smoke + commit**

```bash
cd packages/inject && bun run build && cd ../..
git add packages/inject
git commit -m "feat(inject): mode store with position/size/width persisted in localStorage"
```

### Task 5.2: Edge resize (docked) + corner resize (floating)

**Files:**
- Create: `packages/inject/src/components/ResizeHandle.tsx`
- Modify: `packages/inject/src/components/Drawer.tsx`
- Modify: `packages/inject/src/styles/drawer.css`

- [ ] **Step 1: `ResizeHandle.tsx`**

```tsx
import { type Component, createSignal, onCleanup } from 'solid-js';

type Props = { onDrag: (dx: number, dy: number) => void; corner?: boolean };

export const ResizeHandle: Component<Props> = (props) => {
  const [dragging, setDragging] = createSignal(false);
  let lastX = 0;
  let lastY = 0;
  const onMove = (e: MouseEvent) => {
    if (!dragging()) return;
    props.onDrag(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = () => { setDragging(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  const onDown = (e: MouseEvent) => { setDragging(true); lastX = e.clientX; lastY = e.clientY; window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); e.preventDefault(); };
  onCleanup(() => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); });
  return <div class={`resize-handle ${props.corner ? 'corner' : 'edge'}`} onMouseDown={onDown} />;
};
```

- [ ] **Step 2: Add CSS**

```css
.resize-handle.edge { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; cursor: ew-resize; z-index: 10; }
.drawer.pos-left .resize-handle.edge { left: auto; right: 0; }
.resize-handle.corner { position: absolute; right: 0; bottom: 0; width: 12px; height: 12px; cursor: nwse-resize; z-index: 10; }
```

- [ ] **Step 3: Wire it to width**

In `Drawer.tsx`, when position is right/left, render `<ResizeHandle onDrag={(dx) => setWidth(Math.max(360, Math.min(800, width() + (position() === 'left' ? dx : -dx))))} />`.

- [ ] **Step 4: Build + smoke + commit**

```bash
cd packages/inject && bun run build && cd ../..
git add packages/inject
git commit -m "feat(inject): edge resize for docked drawer; corner resize for floating"
```

---

## Phase 6 · Polish

### Task 6.1: Light mode + auto theme

**Files:**
- Modify: `packages/inject/src/state/modes.ts` (add `theme`)
- Modify: `packages/inject/src/components/Drawer.tsx`

- [ ] **Step 1: Add theme signal**

```ts
type Theme = 'auto' | 'dark' | 'light';
const [theme, setTheme] = createSignal<Theme>(initial.theme ?? 'auto');
const isDark = () => theme() === 'dark' || (theme() === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
```

- [ ] **Step 2: Apply class on host element**

In `index.tsx`, when theme changes, set `host.classList.toggle('theme-light', !isDark())`.

- [ ] **Step 3: Smoke + commit**

```bash
git add packages/inject && git commit -m "feat(inject): light mode + auto theme detection"
```

### Task 6.2: Editor URI scheme config + clipboard fallback

**Files:**
- Create: `packages/daemon/src/config.ts` — read `~/.claude/walkthrough/config.json`
- Add: `GET /api/config` route on daemon
- Modify: `packages/inject/src/components/FileRef.tsx` — fetch editor scheme from `/api/config`

- [ ] **Step 1: Daemon reads config + serves /api/config** (config schema already in shared/types.ts as `WalkthroughConfig`).

- [ ] **Step 2: FileRef calls `/api/config` once on mount** to learn the editor scheme. Falls back to clipboard copy when scheme = 'none'.

- [ ] **Step 3: Commit** `feat: configurable editor URI scheme + clipboard fallback`

### Task 6.3: Pause / resume + queued summarizing poke

**Files:**
- Modify: `packages/daemon/src/http/routes.ts` (POST /api/sessions/:id/status handler already exists; ensure paused suppresses pokes)
- Modify: `packages/inject/src/components/Footer.tsx` (STOP button toggles paused/active)

Adding a single test: POSTing comments while paused does NOT spawn pokes. Set status back to active → spawn one summarizing poke.

- [ ] **Step 1: Test pause behavior** — append to `poke-policy.test.ts`

```ts
test('paused state suppresses poke; resume fires summarizing poke', async () => {
  // similar harness as previous test
  // 1. mark session paused
  // 2. POST comment, assert spawn not called
  // 3. mark session active
  // 4. assert spawn called once with context that mentions multiple queued
});
```

- [ ] **Step 2: Update the resume path** — when POST /api/sessions/:id/status flips from 'paused' → 'active' AND there are unread responses AND no in-flight poke, spawn one with a "summarizing" context.

- [ ] **Step 3: Wire STOP button in `Footer.tsx`** to POST status='paused' / 'active'.

- [ ] **Step 4: Commit** `feat: pause/resume with summarizing poke on resume`

### Task 6.4: POKE_FAILED detection + click-retry

**Files:**
- Modify: `packages/daemon/src/http/routes.ts` — track pokeSpawnedAt, fire `state-changed` with poke-failed status if 30s elapsed and no MCP call landed.
- Modify: `packages/inject/src/state/store.ts` — derive pokeStatus from session.pokePid + session.pokeSpawnedAt.
- Modify: `packages/inject/src/components/StatusTag.tsx` — clicking the failed pill POSTs to `/api/sessions/:id/retry-poke`.

- [ ] **Step 1: Add `/api/sessions/:id/retry-poke`** that re-triggers the poke if the session has unaddressed comments.

- [ ] **Step 2: Add a 30s timer in routes.ts** that, after spawning a poke, checks if any forwarded MCP call has landed referencing this session; otherwise sets a poke-failed flag and broadcasts.

- [ ] **Step 3: Commit** `feat: POKE_FAILED detection + click-retry`

### Task 6.5: Image attachments (inline + lightbox)

**Files:**
- Create: `packages/inject/src/components/Lightbox.tsx`
- Modify: `packages/inject/src/components/Detail.tsx` — render image attachments below body text; click → open Lightbox.

- [ ] **Step 1: `Lightbox.tsx`** — full-viewport overlay, click to dismiss, esc to close.

- [ ] **Step 2: Detail renders `<img>` for each `image` attachment, click opens lightbox.**

- [ ] **Step 3: Commit** `feat: image attachments inline + lightbox`

---

## Phase 7 · Vite/Nuxt plugin (stretch)

### Task 7.1: Vite plugin scaffold

**Files:**
- Create: `packages/vite-plugin/package.json`
- Create: `packages/vite-plugin/src/index.ts`

- [ ] **Step 1: Plugin code**

```ts
import type { Plugin } from 'vite';

export default function walkthrough(opts: { port?: number } = {}): Plugin {
  const port = opts.port ?? 7773;
  return {
    name: 'walkthrough',
    apply: 'serve',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { src: `http://localhost:${port}/inject.js`, defer: true }, injectTo: 'body' }];
    },
  };
}
```

- [ ] **Step 2: Smoke** — install the plugin in a Nuxt project; confirm script tag injected in dev only.

- [ ] **Step 3: Commit** `feat: @walkthrough/vite-plugin auto-injector for Vite/Nuxt dev`

---

## Self-Review

**Spec coverage walk:**

- §1 Overview → Phases 1–4 deliver this. ✓
- §2 Goals → all MVP goals mapped:
  - Item-by-item walkthrough → 3.4, 3.5
  - Local auto-advance → 3.4 (Detail's onApprove sets next index)
  - Comments trigger re-engagement → 4.2
  - Pause/resume → 6.3
  - Injected drawer → 3.1
  - Keyboard-first → 3.5, 5.1 (cycle keys)
  - Multi-position drawer → 5.1
  - Resizable docked + floating → 5.2
  - Three size variants → 5.1
  - Light AND dark → 6.1
  - Visual identity → 3.3 styles
  - Harness-agnostic protocol → 2.1 RPC endpoint usable from any HTTP client
- §3 Architecture two-process model → 1.7 (daemon lifecycle) + 2.1–2.3 (adapter forwards to daemon). ✓
- §4 Data model → 0.2 shared types. ✓
- §5 MCP tools (6 tools) → all in 2.1 daemon-side handler + 2.3 adapter declarations. ✓
- §5 Status pill states → 3.3 derivePill function. ✓
- §5 At-most-one-poke → 4.2 wired into POST /responses. ✓
- §6 Injection script tag → 3.1 daemon serves /inject.js, host.html shows tag. ✓
- §6 Vite plugin → 7.1. ✓
- §6 Mount via Web Component + Shadow DOM → 3.1. ✓
- §6 SSE state-snapshot first → 1.5. ✓
- §6 Modes → 5.1, 5.2. ✓
- §6 Keyboard → 3.5, 5.1. ✓
- §7 Visual direction → 3.3 styles. ✓
- §8 Configuration → 6.2 wires editor URI; full config file reading is also 6.2. ✓
- §10 Lifecycle → covered by E2E smoke 4.3. ✓
- §11 Open questions:
  - Distribution: deferred to release prep, not blocking MVP. Plan ships `bun run` invocation in adapter & daemon.
  - Vite plugin: phase 7, stretch. ✓
  - Retention: not in MVP — sessions just accumulate. Fine to defer.
  - Concurrency: 409 ALREADY_ACTIVE handled in 1.4 + 2.1. ✓
  - Internal RPC shape: plain JSON-RPC over HTTP — what 2.1 does. ✓

**Placeholder scan:** No `TBD` / `TODO` / `implement later` strings in the plan; every step shows the actual file content or test code. Tasks 6.2, 6.3, 6.4, 6.5, 7.1 are tighter (less inline code) — they're polish phases where the engineer reading sequentially will already have the patterns from earlier phases. Acceptable per "DRY" — but flagging for the executor that these tasks deserve fuller code expansion if subagent-driven execution stumbles.

**Type consistency check:** `Session`, `Item`, `Response`, `Attachment` are defined once in `packages/shared/src/types.ts` (Task 0.2) and imported everywhere. `pokePid`, `pokeSpawnedAt`, `clientSessionId` added to Session in 0.2 are used consistently in 4.2.

**Sequencing sanity:** Phase 4 ends with a real E2E smoke test (Task 4.3). After that, the user can use the tool. Phases 5–7 are pure additions — none of them break what was built in 1–4.

---

## Execution Handoff

Plan complete and saved to `~/work/studios/walkthrough/docs/superpowers/plans/2026-05-03-walkthrough.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration. Best for a project this size where you want to inspect each step.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batched with checkpoints. Best if you want me to plow through phases without dispatching fresh agents.

Which approach?
