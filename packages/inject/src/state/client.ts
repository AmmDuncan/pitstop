import type { PitstopConfig, Session, SseEvent } from "@pitstop/shared";

const baseUrl = (() => {
  if (typeof window === "undefined") return "http://localhost:7773";
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (src) {
    try {
      return new URL(src).origin;
    } catch {}
  }
  return "http://localhost:7773";
})();

export async function fetchActiveSession(projectRoot: string): Promise<Session | null> {
  const r = await fetch(`${baseUrl}/api/sessions/active?projectRoot=${encodeURIComponent(projectRoot)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`active fetch failed: ${r.status}`);
  return r.json();
}

/** Fallback for "no projectRoot wired" wiring — browser extension / bookmarklet
 *  / proxy. Sends `location.origin` so the daemon only returns sessions whose
 *  devUrls include this tab; falls back to a loose match (no devUrls set) if
 *  no scoped session matches. */
export async function fetchMostRecentActiveSession(): Promise<Session | null> {
  const origin = typeof window !== "undefined" ? window.location.origin : undefined;
  const url = origin
    ? `${baseUrl}/api/sessions/most-recent-active?origin=${encodeURIComponent(origin)}`
    : `${baseUrl}/api/sessions/most-recent-active`;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`most-recent-active fetch failed: ${r.status}`);
  return r.json();
}

export function openEventStream(sessionId: string, on: (e: SseEvent) => void): () => void {
  const es = new EventSource(`${baseUrl}/api/sessions/${sessionId}/events`);
  for (const t of ["state-snapshot", "state-changed", "item-added", "agent-activity", "complete"] as const) {
    es.addEventListener(t, (m) => on(JSON.parse((m as MessageEvent).data)));
  }
  return () => es.close();
}

/**
 * Open the project-scoped lobby SSE channel. Used while the drawer is mounted
 * but no session yet exists — the daemon will publish a `session-hello` event
 * the moment `start_review` creates one for this projectRoot, letting the
 * drawer transition to active without a manual reload.
 */
export function openProjectEventStream(projectRoot: string, on: (e: SseEvent) => void): () => void {
  const url = `${baseUrl}/api/projects/events?projectRoot=${encodeURIComponent(projectRoot)}`;
  const es = new EventSource(url);
  es.addEventListener("session-hello", (m) => on(JSON.parse((m as MessageEvent).data)));
  return () => es.close();
}

export async function submitResponse(
  sessionId: string,
  body: { itemId: string; kind: "approve" | "comment"; body?: string },
): Promise<void> {
  const r = await fetch(`${baseUrl}/api/sessions/${sessionId}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`submit failed: ${r.status}`);
}

let cachedConfig: PitstopConfig | null = null;

export async function fetchConfig(): Promise<PitstopConfig> {
  if (cachedConfig) return cachedConfig;
  const r = await fetch(`${baseUrl}/api/config`);
  if (!r.ok) throw new Error(`config fetch failed: ${r.status}`);
  cachedConfig = (await r.json()) as PitstopConfig;
  return cachedConfig;
}

export { baseUrl };
