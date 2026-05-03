import type { Session, SseEvent, WalkthroughConfig } from '@walkthrough/shared';

const baseUrl = (() => {
  if (typeof window === 'undefined') return 'http://localhost:7773';
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (src) {
    try {
      return new URL(src).origin;
    } catch {}
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

export async function submitResponse(
  sessionId: string,
  body: { itemId: string; kind: 'approve' | 'comment'; body?: string },
): Promise<void> {
  const r = await fetch(`${baseUrl}/api/sessions/${sessionId}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`submit failed: ${r.status}`);
}

let cachedConfig: WalkthroughConfig | null = null;

export async function fetchConfig(): Promise<WalkthroughConfig> {
  if (cachedConfig) return cachedConfig;
  const r = await fetch(`${baseUrl}/api/config`);
  if (!r.ok) throw new Error(`config fetch failed: ${r.status}`);
  cachedConfig = (await r.json()) as WalkthroughConfig;
  return cachedConfig;
}

export { baseUrl };
