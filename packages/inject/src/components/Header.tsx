import { type Component, Show } from "solid-js";
import { baseUrl } from "../state/client";
import {
  toggleSize,
  floatingLeft,
  floatingTop,
  position,
  setFloatingLeft,
  setFloatingTop,
  setSize,
  side,
  size,
  theme,
  toggleFloat,
  togglePinSide,
  toggleTheme,
} from "../state/modes";
import { currentItemIdx, session, setHelpOpen } from "../state/store";
import { FloatIcon, MinimizeIcon, SideIcon, SizeIcon, ThemeIcon } from "./Icons";
import { StatusTag, derivePill } from "./StatusTag";

export const Header: Component = () => {
  const pill = () => derivePill(session.s);
  const total = () => session.s?.items.length ?? 0;
  const current = () => Math.min(currentItemIdx() + 1, total());

  const onRetry = async () => {
    if (!session.s) return;
    try {
      await fetch(`${baseUrl}/api/sessions/${session.s.id}/retry-poke`, { method: "POST" });
    } catch (err) {
      console.error("retry-poke failed", err);
    }
  };

  // Floating-drawer drag uses pointer events with implicit capture so the
  // release fires reliably even when the cursor leaves the browser window or
  // crosses iframe/shadow boundaries mid-drag. The previous mousemove/mouseup
  // listeners on `window` could miss the up event in those cases, leaving the
  // drawer glued to the cursor until the user clicked again.
  const onHeaderPointerDown = (e: PointerEvent) => {
    if (position() !== "floating") return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, a, [role="button"]')) return;

    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const startTop = floatingTop();
    const startLeft = floatingLeft();

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dy = ev.clientY - startY;
      const dx = ev.clientX - startX;
      setFloatingTop(Math.max(0, startTop + dy));
      setFloatingLeft(Math.max(0, startLeft + dx));
    };
    const release = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("lostpointercapture", release);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  return (
    <header
      class="dheader"
      onPointerDown={onHeaderPointerDown}
      classList={{ draggable: position() === "floating" }}
    >
      <div class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16">
          <rect x="0" y="0" width="12" height="12" fill="currentColor" />
          <rect x="12" y="12" width="12" height="12" fill="currentColor" />
        </svg>
      </div>
      <div>
        <div class="name">PITSTOP</div>
        <div class="ctx">{session.s?.branch ?? session.s?.projectRoot ?? "—"}</div>
      </div>
      <Show when={total() > 0}>
        <span class="counter">
          <span class="counter-cur">{String(current()).padStart(2, "0")}</span>
          <span class="counter-sep">/</span>
          <span class="counter-total">{String(total()).padStart(2, "0")}</span>
        </span>
      </Show>
      {/* Hide the StatusTag once the session is complete — the ReviewComplete
          screen below already announces it big and green; the header pill
          just duplicates the signal and crowds the chrome at narrow widths. */}
      <Show when={pill().state !== "complete"}>
        <StatusTag pill={pill()} onRetry={onRetry} />
      </Show>
      <div class="x-btn-pair">
        <button
          class="x-btn side-btn"
          onClick={togglePinSide}
          title={`Drawer on ${side()} · Click to move to ${side() === "right" ? "left" : "right"}`}
        >
          <SideIcon />
        </button>
        <button
          class="x-btn float-btn"
          onClick={toggleFloat}
          title={
            position() === "floating"
              ? `Drawer floating · Click to dock to ${side()}`
              : "Drawer pinned · Click to float"
          }
        >
          <FloatIcon />
        </button>
      </div>
      <button
        class="x-btn size-btn"
        onClick={toggleSize}
        title={`Size: ${size()} · Click to switch to ${size() === "standard" ? "compact" : "standard"}`}
      >
        <SizeIcon />
      </button>
      <button
        class="x-btn theme-btn"
        onClick={toggleTheme}
        title={`Theme: ${theme()} · Click to switch to ${theme() === "dark" ? "light" : "dark"}`}
      >
        <ThemeIcon />
      </button>
      <button class="x-btn help-btn" onClick={() => setHelpOpen(true)} title="Show keyboard shortcuts">
        ?
      </button>
      <button class="x-btn min-btn" onClick={() => setSize("strip")} title="Minimize to strip">
        <MinimizeIcon />
      </button>
    </header>
  );
};
