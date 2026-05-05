import type { Bus } from "../http/sse";
import type { Store } from "../store/sessions";

export type PokeWatchOpts = {
  store: Store;
  bus: Bus;
  /** Window in ms to wait for agent activity after a poke is spawned. Defaults to 30s. */
  windowMs?: number;
};

/**
 * Watches spawned poke subprocesses. If no agent activity lands for the session
 * within `windowMs`, the session's `pokeFailed` flag is flipped and broadcast.
 */
export class PokeWatch {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private windowMs: number;

  constructor(private opts: PokeWatchOpts) {
    this.windowMs = opts.windowMs ?? 30_000;
  }

  /** Start a watch when a poke is spawned. Replaces any existing watch for the session. */
  arm(sessionId: string): void {
    this.clear(sessionId);
    const t = setTimeout(async () => {
      this.timers.delete(sessionId);
      const session = await this.opts.store.get(sessionId);
      if (!session || !session.pokeSpawnedAt) return;
      const lastActivity = session.lastAgentActivityAt ?? 0;
      if (lastActivity >= session.pokeSpawnedAt) return;
      const updated = await this.opts.store.update(sessionId, (s) => ({ ...s, pokeFailed: true }));
      this.opts.bus.publish(sessionId, { type: "state-changed", session: updated });
    }, this.windowMs);
    if (typeof (t as any).unref === "function") (t as any).unref();
    this.timers.set(sessionId, t);
  }

  /** Cancel a watch (e.g., before a fresh arm). */
  clear(sessionId: string): void {
    const t = this.timers.get(sessionId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(sessionId);
    }
  }
}
