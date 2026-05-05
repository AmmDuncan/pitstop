import type { SseEvent } from "@pitstop/shared";

type Listener = (event: SseEvent) => void;

/** In-process pub/sub bus that routes SseEvents to all SSE-subscribed clients for a session. */
export class Bus {
  private byId = new Map<string, Set<Listener>>();

  /** Subscribe a listener to events for a specific session. Returns an unsubscribe function. */
  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.byId.get(sessionId);
    if (!set) {
      set = new Set();
      this.byId.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.byId.delete(sessionId);
    };
  }

  /** Publish an event to all listeners subscribed to the given session. */
  publish(sessionId: string, event: SseEvent): void {
    const set = this.byId.get(sessionId);
    if (!set) return;
    for (const l of set) l(event);
  }

  /**
   * Count active subscribers.
   * @param sessionId - If provided, count only subscribers for that session; otherwise count all.
   */
  subscriberCount(sessionId?: string): number {
    if (sessionId) return this.byId.get(sessionId)?.size ?? 0;
    let n = 0;
    for (const s of this.byId.values()) n += s.size;
    return n;
  }
}
