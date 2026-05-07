import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ItemZ, SessionStatusZ } from "@pitstop/shared";
import type { Hono } from "hono";
import { z } from "zod";
import { PokeWatch } from "../lifecycle/poke-watch";
import { Store } from "../store/sessions";
import type { DaemonOpts } from "./server";
import { Bus } from "./sse";
// Bun supports JSON imports natively at runtime — release script bumps
// packages/daemon/package.json so DAEMON_VERSION stays in sync.
import pkg from "../../package.json" with { type: "json" };

const DAEMON_VERSION: string = pkg.version;

const DEFAULT_SCRIPTS_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  // routes.ts is at packages/daemon/src/http/. Walk up to packages/, then into scripts/.
  return join(here, "..", "..", "..", "scripts");
})();

const CreateZ = z.object({
  projectRoot: z.string(),
  branch: z.string().optional(),
  devUrls: z.array(z.string()).optional(),
  items: z.array(ItemZ.omit({ index: true }).partial({ id: true, attachments: true })),
  clientSessionId: z.string().optional(),
});

const StatusBodyZ = z.object({ status: SessionStatusZ });

const ResponseInZ = z.object({
  itemId: z.string(),
  kind: z.enum(["approve", "comment", "answer"]),
  body: z.string().optional(),
  questionText: z.string().optional(),
});

const CurrentItemInZ = z.object({
  itemId: z.string().min(1),
});

export function mountRoutes(app: Hono, opts: DaemonOpts) {
  const store = new Store(opts.dataDir);
  const bus = new Bus();
  const pokeWatch = new PokeWatch({ store, bus });
  const scriptsDir = process.env.PITSTOP_SCRIPTS_DIR ?? opts.scriptsDir ?? DEFAULT_SCRIPTS_DIR;

  // Tracks the most recent /inject.js fetch per projectRoot. Lets start_review
  // warn the agent when the drawer hasn't been wired into the dev app — without
  // it, the agent would otherwise drive a tab full of items the user can't see.
  // /inject.js is served with `Cache-Control: no-cache`, so the browser
  // revalidates on every reload and we get a fresh signal each time.
  const drawerSeen = new Map<string, number>();

  /** Dedupe set for stale-adapter notifications. Keyed by
   *  `${projectRoot}|${adapterVersion}|${adapterPid}`. Once we publish a
   *  stale-adapter event for a tuple we won't republish for it from the
   *  same daemon process — the drawer banner only needs to appear once
   *  per stale subprocess, not per RPC. Cleared on daemon restart. */
  const notifiedStaleAdapters = new Set<string>();
  const notifyStaleAdapter = (
    projectRoot: string,
    adapterVersion: string,
    adapterPid: string | undefined,
  ): void => {
    const key = `${projectRoot}|${adapterVersion}|${adapterPid ?? ""}`;
    if (notifiedStaleAdapters.has(key)) return;
    notifiedStaleAdapters.add(key);
    bus.publishToProject(projectRoot, {
      type: "stale-adapter",
      adapterVersion,
      daemonVersion: DAEMON_VERSION,
      adapterPid,
    });
  };

  /** Spawn a `claude --resume` poke and arm the session for it: writes
   *  pokePid + pokeSpawnedAt, clears pokeFailed, broadcasts state-changed,
   *  arms pokeWatch. Used by all three poke sites (resume-from-pause,
   *  comment-poke, retry-poke). Centralizes the pokePid lifecycle invariants
   *  so a future field added here lands in one place. Each caller still owns
   *  its own `exited.then` cleanup (e.g. drain logic differs per site).
   *  Returns null on spawn failure. */
  const armPoke = async (
    id: string,
    clientSessionId: string,
    context: string,
    errLabel: string,
  ): Promise<{ pid: number; exited: Promise<number> } | null> => {
    const { ClaudeResumePoke } = await import("../poke/claude-resume");
    const poke = new ClaudeResumePoke({ spawn: opts.spawn });
    try {
      const result = await poke.trigger({ sessionId: id, clientSessionId, context });
      const updated = await store.update(id, (s) => ({
        ...s,
        pokePid: result.pid,
        pokeSpawnedAt: Date.now(),
        pokeFailed: false,
      }));
      bus.publish(id, { type: "state-changed", session: updated });
      pokeWatch.arm(id);
      return result;
    } catch (err) {
      console.error(`${errLabel} poke failed`, err);
      return null;
    }
  };

  // Permissive CORS — drawer is injected into arbitrary local dev hosts.
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,x-client-session-id",
          "access-control-max-age": "86400",
        },
      });
    }
    await next();
    c.res.headers.set("access-control-allow-origin", "*");
  });

  app.post("/api/sessions", async (c) => {
    const parsed = CreateZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

    const existing = await store.getActive(parsed.data.projectRoot);
    if (existing && existing.status !== "idle") {
      return c.json({ error: "ALREADY_ACTIVE", sessionId: existing.id }, 409);
    }
    const session = await store.create(parsed.data as Parameters<typeof store.create>[0]);
    bus.publish(session.id, { type: "state-snapshot", session });
    // Notify any drawer that subscribed to the project lobby before this
    // session existed — without this, the drawer keeps showing "no active
    // review" until the user reloads.
    bus.publishToProject(session.projectRoot, { type: "session-hello", session });
    return c.json(session, 201);
  });

  // Fallback for "no projectRoot in URL" wiring (browser extension, bookmarklet,
  // proxy). Returns the most-recently-updated non-complete session, optionally
  // scoped by `?origin=` so the extension only matches sessions whose `devUrls`
  // include the page's location.origin.
  //
  // Resolution order:
  //   1. If origin given: prefer active sessions whose devUrls include it.
  //   2. Otherwise (or if none of the above): any active session with empty
  //      devUrls (loose mode — backwards-compatible with v0.2.x).
  //   3. Otherwise: 404.
  app.get("/api/sessions/most-recent-active", async (c) => {
    const origin = c.req.query("origin");
    const all = await store.list();
    const active = all.filter((s) => s.status !== "complete");
    active.sort((a, b) => b.updatedAt - a.updatedAt);
    if (origin) {
      const scoped = active.find((s) => s.devUrls?.includes(origin));
      if (scoped) return c.json(scoped);
    }
    const loose = active.find((s) => !s.devUrls || s.devUrls.length === 0);
    if (loose) return c.json(loose);
    return c.json({ error: "NO_ACTIVE_SESSION" }, 404);
  });

  app.get("/api/sessions/active", async (c) => {
    const projectRoot = c.req.query("projectRoot");
    if (!projectRoot) return c.json({ error: "projectRoot required" }, 400);
    const session = await store.getActive(projectRoot);
    if (!session) return c.json({ error: "NO_ACTIVE_SESSION" }, 404);
    return c.json(session);
  });

  app.get("/api/sessions/:id", async (c) => {
    const session = await store.get(c.req.param("id"));
    if (!session) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(session);
  });

  app.post("/api/sessions/:id/status", async (c) => {
    const id = c.req.param("id");
    const parsed = StatusBodyZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);
    // Capture the prior status inside the updater so we don't need a
    // separate `before = store.get(id)` read (the resume-detection branch
    // below only needed `before?.status === "paused"`, nothing else from it).
    let prevStatus: typeof parsed.data.status | undefined;
    const session = await store.update(id, (s) => {
      prevStatus = s.status;
      return { ...s, status: parsed.data.status };
    });
    bus.publish(session.id, { type: "state-changed", session });

    // DONE button or any path that flips status to 'complete' — drop the
    // file. Subscribers got the SSE update first; nothing reads completed
    // sessions afterward (responses are already in the agent's context via
    // get_unread_responses).
    if (parsed.data.status === "complete") {
      bus.publish(session.id, { type: "complete", sessionId: session.id });
      await store.delete(id);
    }

    // Resume detection: paused → active with unaddressed responses → fire summarizing poke
    const wasPaused = prevStatus === "paused";
    const nowActive = parsed.data.status === "active";
    const unaddressed = session.responses.filter((r) => !r.addressed && r.kind === "comment");
    if (wasPaused && nowActive && unaddressed.length > 0 && !session.pokePid && session.clientSessionId) {
      const ctx = `Pitstop session ${id} resumed from paused. ${unaddressed.length} comment${unaddressed.length === 1 ? "" : "s"} queued during pause. Read get_unread_responses(${id}) for the full list.`;
      const result = await armPoke(id, session.clientSessionId, ctx, "resume");
      if (result) {
        result.exited.then(async () => {
          await store.update(id, (s) => ({ ...s, pokePid: undefined, pokeSpawnedAt: undefined }));
        });
      }
    }

    return c.json(session);
  });

  app.post("/api/sessions/:id/current-item", async (c) => {
    const id = c.req.param("id");
    const session = await store.get(id);
    if (!session) return c.json({ error: "NOT_FOUND" }, 404);

    const parsed = CurrentItemInZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

    const { itemId } = parsed.data;
    if (!session.items.some((it) => it.id === itemId)) {
      return c.json({ error: `unknown itemId: ${itemId}` }, 400);
    }

    const updated = await store.update(id, (s) => ({ ...s, currentItemId: itemId }));
    bus.publish(id, { type: "state-changed", session: updated });
    return c.json({ ok: true });
  });

  app.get("/api/sessions/:id/events", (c) => {
    const id = c.req.param("id");
    return new Response(
      new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const send = (event: string, data: unknown) => {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          // Initial snapshot
          const session = await store.get(id);
          if (!session) {
            send("error", { error: "NOT_FOUND" });
            controller.close();
            return;
          }
          send("state-snapshot", { type: "state-snapshot", session });
          // Live stream
          const unsub = bus.subscribe(id, (event) => send(event.type, event));
          // Heartbeat every 25s so proxies don't close the connection on idle
          const hb = setInterval(() => controller.enqueue(enc.encode(`: heartbeat\n\n`)), 25_000);
          c.req.raw.signal.addEventListener("abort", () => {
            clearInterval(hb);
            unsub();
            try {
              controller.close();
            } catch {}
          });
        },
      }),
      {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      },
    );
  });

  // Project-scoped lobby SSE — a drawer subscribes to this while it's
  // mounted but no session exists for its projectRoot yet. The daemon
  // publishes a `session-hello` event the moment `start_review` creates a
  // matching session, so the drawer can switch from idle to active without
  // the user having to reload the dev tab.
  app.get("/api/projects/events", (c) => {
    const projectRoot = c.req.query("projectRoot");
    if (!projectRoot) {
      return c.json({ error: "MISSING_PROJECT_ROOT" }, 400);
    }
    return new Response(
      new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const send = (event: string, data: unknown) => {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          const unsub = bus.subscribeToProject(projectRoot, (event) => send(event.type, event));
          const hb = setInterval(() => controller.enqueue(enc.encode(`: heartbeat\n\n`)), 25_000);
          c.req.raw.signal.addEventListener("abort", () => {
            clearInterval(hb);
            unsub();
            try {
              controller.close();
            } catch {}
          });
        },
      }),
      {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      },
    );
  });

  app.get("/api/sessions/:id/responses", async (c) => {
    const id = c.req.param("id");
    const session = await store.get(id);
    if (!session) return c.json({ error: "NOT_FOUND" }, 404);

    const since = c.req.query("since");
    const unaddressed = c.req.query("unaddressed") === "true";

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

  app.post("/api/sessions/:id/responses", async (c) => {
    const id = c.req.param("id");
    const parsed = ResponseInZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);

    const r = { ...parsed.data, at: Date.now(), addressed: false };
    const session = await store.update(id, (s) => ({
      ...s,
      responses: [...s.responses, r],
      // Answers clear the pending question that prompted them. The agent gets
      // the answer body via get_unread_responses on the next poke.
      pendingQuestion: r.kind === "answer" ? undefined : s.pendingQuestion,
    }));
    bus.publish(id, { type: "state-changed", session });

    // Poke policy:
    //   - looks-good (kind === 'approve'): never poke
    //   - comment / answer + paused: never poke (queues for resume)
    //   - comment / answer + in-flight poke: piggy-back on existing
    //   - comment / answer otherwise: spawn one poke; on exit, drain any queued
    const shouldPoke =
      (r.kind === "comment" || r.kind === "answer") && session.status !== "paused" && !session.pokePid;

    if (shouldPoke && session.clientSessionId) {
      const ctx = `Pitstop item ${r.itemId} got a new comment: ${r.body}. Read get_unread_responses(${id}) for the full list.`;
      const result = await armPoke(id, session.clientSessionId, ctx, "comment");
      if (result) {
        // When the poke subprocess exits: clear pokePid; if responses still
        // unaddressed, fire one drain poke through the same helper.
        result.exited.then(async () => {
          const updated = await store.update(id, (s) => ({
            ...s,
            pokePid: undefined,
            pokeSpawnedAt: undefined,
          }));
          const stillUnread = updated.responses.some((rr) => !rr.addressed);
          if (stillUnread && updated.status !== "paused" && updated.clientSessionId) {
            const ctx2 = `Some responses queued while you were busy on session ${id}. Read get_unread_responses(${id}).`;
            await armPoke(id, updated.clientSessionId, ctx2, "drain");
          }
        });
      }
    }

    return c.json({ accepted: true }, 202);
  });

  app.post("/api/sessions/:id/retry-poke", async (c) => {
    const id = c.req.param("id");
    const session = await store.get(id);
    if (!session) return c.json({ error: "NOT_FOUND" }, 404);
    if (session.pokePid) return c.json({ error: "ALREADY_IN_FLIGHT" }, 409);
    if (!session.clientSessionId) return c.json({ error: "NO_CLIENT_SESSION_ID" }, 400);

    // Context tailors to what the agent should do next: pick up unread
    // comments if any, otherwise a user-initiated nudge ("are you stuck?")
    // that just asks the agent to look at current state and continue.
    const unaddressed = session.responses.filter((r) => !r.addressed && r.kind === "comment");
    const ctx =
      unaddressed.length > 0
        ? `Pitstop session ${id} retry: ${unaddressed.length} comment${unaddressed.length === 1 ? "" : "s"} pending. Read get_unread_responses(${id}).`
        : `Pitstop session ${id}: user-initiated poke from the drawer (likely thinks you're stuck). Read get_state(${id}) and continue driving the review.`;
    const result = await armPoke(id, session.clientSessionId, ctx, "retry");
    if (!result) return c.json({ error: "POKE_FAILED" }, 500);
    result.exited.then(async () => {
      await store.update(id, (s) => ({ ...s, pokePid: undefined, pokeSpawnedAt: undefined }));
    });
    return c.json({ ok: true });
  });

  const RpcZ = z.object({ method: z.string(), params: z.unknown() });
  app.post("/api/rpc", async (c) => {
    const parsed = RpcZ.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.format() }, 400);
    const { tools } = await import("../tools");
    const fn = (tools as Record<string, Function>)[parsed.data.method];
    if (!fn) return c.json({ error: `UNKNOWN_TOOL: ${parsed.data.method}` }, 404);
    try {
      const clientSessionId = c.req.header("x-client-session-id") ?? undefined;
      const adapterVersion = c.req.header("x-pitstop-adapter-version") ?? undefined;
      const adapterPid = c.req.header("x-pitstop-adapter-pid") ?? undefined;
      const adapterStale = adapterVersion !== undefined && adapterVersion !== DAEMON_VERSION;
      const params = parsed.data.params as
        | { sessionId?: string; projectRoot?: string }
        | undefined;
      // Single store.get for both self-heal and stale-adapter projectRoot
      // lookup. start_review carries projectRoot directly in params; other
      // tools take sessionId, so we read the session for its projectRoot.
      let existingSession: Awaited<ReturnType<typeof store.get>> = null;
      const needLookup =
        params?.sessionId !== undefined && (clientSessionId !== undefined || adapterStale);
      if (needLookup && params?.sessionId) {
        existingSession = await store.get(params.sessionId);
      }
      // Self-heal + cross-session rebind: keep session.clientSessionId
      // pointing at whichever Claude Code session is currently making MCP
      // calls. Two cases this covers:
      //   1. Pre-fix sessions where clientSessionId was never captured
      //      (env-var name regression, fixed in v0.3.43).
      //   2. Resume — Claude session A ended, session B picks up the
      //      same pitstop. Without rebind, pokes target the dead A and
      //      the user's clicks silently fail to wake B.
      // Trust the active caller: if a different CC session is making
      // tool calls for this pitstop, by definition they're the one
      // currently driving and pokes should wake them.
      if (
        existingSession &&
        clientSessionId &&
        existingSession.clientSessionId !== clientSessionId &&
        params?.sessionId
      ) {
        await store.update(params.sessionId, (s) => ({ ...s, clientSessionId }));
      }
      // Stale-adapter detection: if the MCP subprocess is running an older
      // version than the daemon, broadcast a one-shot warning to the project
      // lobby so the drawer can prompt the user to restart Claude Code.
      if (adapterStale && adapterVersion) {
        const projectRoot = existingSession?.projectRoot ?? params?.projectRoot;
        if (projectRoot) notifyStaleAdapter(projectRoot, adapterVersion, adapterPid);
      }
      const baseUrl = `http://localhost:${opts.port}`;
      const result = await fn(
        { store, bus, baseUrl, clientSessionId, scriptsDir, drawerSeen },
        parsed.data.params,
      );
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.startsWith("ALREADY_ACTIVE") ? 409 : msg === "NOT_FOUND" ? 404 : 500;
      return c.json({ error: msg }, status);
    }
  });

  app.get("/inject.js", async (c) => {
    const projectRoot = c.req.query("pitstop-project");
    if (projectRoot) drawerSeen.set(projectRoot, Date.now());
    const file = Bun.file(new URL("../../../inject/dist/inject.js", import.meta.url));
    // If the bundle is missing, Bun.file() returns an HTML error fallback —
    // the browser would load that as JS, the custom element would never
    // register, and the user would see no drawer with no obvious reason
    // why. Catch it here, return plaintext + 503 with a recovery hint.
    if (!(await file.exists())) {
      return c.text(
        "pitstop: inject bundle not built. Run `bun run setup` (or `bun run --cwd packages/inject build`) in the pitstop checkout.",
        503,
        { "content-type": "text/plain; charset=utf-8" },
      );
    }
    return new Response(file, {
      headers: { "content-type": "application/javascript", "cache-control": "no-cache" },
    });
  });

  app.get("/demo", async (c) => {
    const projectRoot = c.req.query("projectRoot") ?? "/tmp/pitstop-demo";
    return new Response(
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Pitstop demo host</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, sans-serif; padding: 32px; max-width: 920px; margin: 0 auto; line-height: 1.5; }
      pre { background: #f5f5f4; padding: 12px 14px; border-radius: 4px; overflow: auto; font-size: 12.5px; }
      h1 { font-size: 22px; margin-bottom: 4px; }
      .muted { color: #71717a; font-size: 13px; }
      code { background: #f5f5f4; padding: 1px 5px; border-radius: 3px; font-size: 13px; }
    </style>
  </head>
  <body>
    <h1>Pitstop · demo host</h1>
    <p class="muted">This page mimics a dev app. The drawer auto-mounts via the inject script below. To trigger a session, in another terminal:</p>
    <pre>curl -X POST http://localhost:7773/api/sessions \\
  -H 'content-type: application/json' \\
  -d '{"projectRoot":"${projectRoot}","items":[{"title":"Demo item 1","body":"Markdown body works **fine**."},{"title":"Demo item 2","body":"Second item."}]}'</pre>
    <p class="muted">Or use the agent: register <code>pitstop-mcp</code> in your Claude Code settings and ask the agent to <code>start_review</code>.</p>
    <h2>Project root used for active-session lookup</h2>
    <pre>${projectRoot}</pre>
    <script src="http://localhost:${opts.port}/inject.js?pitstop-project=${encodeURIComponent(projectRoot)}"></script>
    <script>
      // Fallback: also stash on window so the inject script can read it.
      window.__PITSTOP_PROJECT__ = ${JSON.stringify(projectRoot)};
    </script>
  </body>
</html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  });

  app.get("/api/config", async () => {
    const { loadConfig } = await import("../config");
    const config = await loadConfig();
    return Response.json(config, { headers: { "cache-control": "no-cache" } });
  });

  // Update status — drawer reads this on mount to decide whether to render
  // the metabar update chip. Returns whatever's in the in-memory cache
  // (populated by initUpdateCheck on daemon startup); never blocks on the
  // GitHub fetch. Returns null fields when the lookup hasn't completed yet
  // or failed; the drawer just renders no chip in that case.
  app.get("/api/update-status", async () => {
    const { getUpdateStatus } = await import("../lifecycle/update-check");
    const status = getUpdateStatus();
    return Response.json(status ?? { current: "unknown", latest: null, updateAvailable: false });
  });

  Object.assign(app, { _store: store, _bus: bus });
}
