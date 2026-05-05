import type { SseEvent } from "@pitstop/shared";

type Listener = (event: SseEvent) => void;

/**
 * In-process pub/sub bus with two channels:
 * - **Per-session** (`byId`): events scoped to a known session — `state-changed`,
 *   `agent-activity`, etc.
 * - **Per-project** (`byProject`): a "lobby" channel a drawer can subscribe to
 *   while it's waiting for a session to exist. Receives `session-hello` events
 *   as soon as `start_review` creates a session for that projectRoot.
 */
export class Bus {
  private byId = new Map<string, Set<Listener>>();
  private byProject = new Map<string, Set<Listener>>();

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

  /** Subscribe a listener to the project-scoped lobby for a given projectRoot. */
  subscribeToProject(projectRoot: string, listener: Listener): () => void {
    let set = this.byProject.get(projectRoot);
    if (!set) {
      set = new Set();
      this.byProject.set(projectRoot, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.byProject.delete(projectRoot);
    };
  }

  /** Publish an event to all listeners subscribed to the given session. */
  publish(sessionId: string, event: SseEvent): void {
    const set = this.byId.get(sessionId);
    if (!set) return;
    for (const l of set) l(event);
  }

  /** Publish an event to all listeners on the lobby channel for a project. */
  publishToProject(projectRoot: string, event: SseEvent): void {
    const set = this.byProject.get(projectRoot);
    if (!set) return;
    for (const l of set) l(event);
  }

  /**
   * Count active subscribers across both channels.
   * @param sessionId - If provided, count only per-session subscribers for that ID.
   */
  subscriberCount(sessionId?: string): number {
    if (sessionId) return this.byId.get(sessionId)?.size ?? 0;
    let n = 0;
    for (const s of this.byId.values()) n += s.size;
    for (const s of this.byProject.values()) n += s.size;
    return n;
  }
}
