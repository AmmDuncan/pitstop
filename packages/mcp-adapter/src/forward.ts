import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

/** HTTP client that talks to the daemon's /api/rpc endpoint, auto-spawning the daemon if needed. */
export class Forwarder {
  constructor(
    private opts: {
      baseUrl: string;
      /**
       * Resolves the CC session id to send as `x-client-session-id` on each
       * RPC. Called per-call so a CC restart (with a new session id) flows
       * through immediately — pairs with the daemon's rebind logic.
       */
      resolveClientSessionId: () => string | undefined;
      adapterVersion?: string;
      adapterPid?: string;
    },
  ) {}

  /** Call a named RPC method on the daemon, spawning it first if it isn't running. */
  async call(method: string, params: unknown): Promise<unknown> {
    await this.ensureDaemon();
    const clientSessionId = this.opts.resolveClientSessionId();
    const res = await fetch(`${this.opts.baseUrl}/api/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(clientSessionId ? { "x-client-session-id": clientSessionId } : {}),
        ...(this.opts.adapterVersion ? { "x-pitstop-adapter-version": this.opts.adapterVersion } : {}),
        ...(this.opts.adapterPid ? { "x-pitstop-adapter-pid": this.opts.adapterPid } : {}),
      },
      body: JSON.stringify({ method, params }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(
        typeof body === "object" && body && "error" in body
          ? String((body as any).error)
          : `HTTP ${res.status}`,
      );
    }
    return body;
  }

  private async ensureDaemon(): Promise<void> {
    try {
      const r = await fetch(`${this.opts.baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch {
      // not running — spawn it
    }
    const child = spawn("bun", ["run", new URL("../../daemon/src/index.ts", import.meta.url).pathname], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PITSTOP_PORT: String(new URL(this.opts.baseUrl).port) },
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
    throw new Error("daemon failed to start");
  }
}
