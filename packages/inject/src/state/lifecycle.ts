import { createEffect, createMemo, createRoot, createSignal, onCleanup } from "solid-js";
import { baseUrl } from "./client";
import { currentItemIdx, flagSent, session, submitState } from "./store";

/**
 * Drawer-level lifecycle state — shared by `LifecycleStrip` (the visual
 * indicator) and `ActionArea` (which disables LOOKS_GOOD while the strip is
 * up). Single instance per drawer mount; lifted out of `Detail.tsx` so the
 * strip can survive auto-advance to a different item.
 *
 * Three observable states:
 * - `sending` — transient, sub-second; user just submitted via the UI.
 * - `poked` — user-submit lifecycle window; cleared on agent-activity.
 * - `awaiting` — current item not yet `mark_addressing(arrived: true)`'d
 *   by the agent; per-current-item.
 */

const STRIP_DRIVING_STALE_MS = 60_000;
const STRIP_DRIVING_TRUNCATE = 50;

export type StripKind = "sending" | "poked" | "awaiting";
/**
 * Strip state.
 * - `label`: short ALL-CAPS marker rendered in mono (DRIVING / POKED · WAITING / etc.)
 * - `narration?`: the prose driving message, when `kind === "awaiting"` and the
 *   agent has pushed a recent `mark_addressing(arrived: false)` narration.
 *   Rendered in sans, normal case — preserves the typography rule (mono
 *   uppercase = labels, sans = prose) when both coexist in one row.
 */
export type StripState = { kind: StripKind; label: string; narration?: string };

const lifecycle = createRoot(() => {
  /** True when the agent has signalled it's caught up on the current item
   *  AFTER the user's most recent comment. Two activity types count as
   *  "caught up":
   *    - `mark_addressing(arrived: true)` — the agent navigated the user
   *      to a surface for this item.
   *    - `agent_address_comment(itemId)` — the agent says "I've handled
   *      your comment" (per the tool's documented role: flips the pip to
   *      cyan ↻). Before v0.3.70, the strip only honored mark_addressing,
   *      so when Claude correctly used agent_address_comment after a
   *      comment, the strip stayed AWAITING CLAUDE indefinitely.
   *  Without the post-comment recency check, the original arrival
   *  narration would falsely keep the strip cleared even when the user
   *  re-comments.
   */
  const itemAddressed = createMemo(() => {
    const item = session.s?.items[currentItemIdx()];
    if (!item) return false;
    const responses = session.s?.responses ?? [];
    const lastUserCommentAt = responses
      .filter((r) => r.itemId === item.id && r.kind === "comment")
      .reduce((max, r) => (r.at > max ? r.at : max), 0);
    return (session.s?.agentActivity ?? []).some(
      (e) =>
        e.itemId === item.id &&
        e.at > lastUserCommentAt &&
        ((e.tool === "mark_addressing" && e.arrived !== false) ||
          e.tool === "agent_address_comment"),
    );
  });

  const [stripStartedAt, setStripStartedAt] = createSignal<number | null>(null);
  const [now, setNow] = createSignal(Date.now());

  /** Most recent mid-drive narration (`mark_addressing` with `arrived: false`)
   *  for the current item, within the last 60s. Surfaces in the strip while
   *  awaiting so the user knows WHAT the agent is doing. Subscribes to the
   *  1Hz tick so the staleness window re-evaluates without manual polling. */
  const drivingNarration = createMemo(() => {
    const item = session.s?.items[currentItemIdx()];
    if (!item) return null;
    const cutoff = now() - STRIP_DRIVING_STALE_MS;
    let best: { at: number; narration: string } | null = null;
    for (const e of session.s?.agentActivity ?? []) {
      if (e.tool !== "mark_addressing") continue;
      if (e.itemId !== item.id) continue;
      if (e.arrived !== false) continue;
      if (!e.narration) continue;
      if (e.at < cutoff) continue;
      if (!best || e.at > best.at) best = { at: e.at, narration: e.narration };
    }
    return best?.narration ?? null;
  });

  const stripState = (): StripState | null => {
    if (submitState() === "sending") return { kind: "sending", label: "SENDING…" };
    if (submitState() === "poked") return { kind: "poked", label: "POKED · WAITING" };
    if (!itemAddressed()) {
      const drv = drivingNarration();
      if (drv) {
        const truncated =
          drv.length > STRIP_DRIVING_TRUNCATE ? `${drv.slice(0, STRIP_DRIVING_TRUNCATE - 1)}…` : drv;
        return { kind: "awaiting", label: "DRIVING", narration: truncated };
      }
      return { kind: "awaiting", label: "AWAITING CLAUDE" };
    }
    return null;
  };

  // Reset the elapsed counter whenever the strip's kind changes (so a
  // sending → poked → awaiting cascade doesn't show 4:00 the moment it
  // first lands on awaiting).
  let lastStripKind: StripKind | null = null;
  createEffect(() => {
    const ss = stripState();
    const kind = ss?.kind ?? null;
    if (kind !== lastStripKind) {
      lastStripKind = kind;
      setStripStartedAt(kind ? Date.now() : null);
    }
  });

  // Tick `now` once per second only while the strip is up — no point
  // wasting timer fires when the strip isn't visible.
  let tick: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    if (stripState() && !tick) {
      tick = setInterval(() => setNow(Date.now()), 1000);
    } else if (!stripState() && tick) {
      clearInterval(tick);
      tick = null;
    }
  });
  onCleanup(() => {
    if (tick) clearInterval(tick);
  });

  const elapsedFormatted = (): string => {
    const start = stripStartedAt();
    if (!start) return "";
    const s = Math.max(0, Math.floor((now() - start) / 1000));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}:${String(ss).padStart(2, "0")}`;
  };

  const [poking, setPoking] = createSignal(false);
  const [pokeError, setPokeError] = createSignal<string | null>(null);

  /** POKE button handler — fires `/api/sessions/:id/retry-poke` and flips the
   *  strip back to `POKED · WAITING` via flagSent so the user sees the click
   *  landed. Surfaces daemon errors inline; pre-v0.3.43 these were silently
   *  swallowed which masked the env-var-name regression. */
  const onPoke = async (): Promise<void> => {
    if (!session.s || poking()) return;
    setPoking(true);
    setPokeError(null);
    try {
      const r = await fetch(`${baseUrl}/api/sessions/${session.s.id}/retry-poke`, { method: "POST" });
      if (r.ok) {
        flagSent();
        // Keep the button disabled for ~5s so spamming doesn't stack pokes —
        // claude --resume only takes one at a time anyway, and the
        // second-and-after attempts 409 silently.
        setTimeout(() => setPoking(false), 5000);
        return;
      }
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setPokeError(body.error ? `POKE_FAILED · ${body.error}` : `POKE_FAILED · HTTP ${r.status}`);
      setTimeout(() => setPokeError(null), 6000);
    } catch (err) {
      console.error("poke failed", err);
      setPokeError("POKE_FAILED · network error");
      setTimeout(() => setPokeError(null), 6000);
    }
    setPoking(false);
  };

  return { stripState, elapsedFormatted, poking, pokeError, onPoke };
});

export const stripState = lifecycle.stripState;
export const elapsedFormatted = lifecycle.elapsedFormatted;
export const poking = lifecycle.poking;
export const pokeError = lifecycle.pokeError;
export const onPoke = lifecycle.onPoke;
