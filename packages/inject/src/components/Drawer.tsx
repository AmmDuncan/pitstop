import { type Component, Show } from "solid-js";
import {
  floatingLeft,
  floatingTop,
  height,
  interactiveResize,
  position,
  reflow,
  setFloatingLeft,
  setFloatingTop,
  setHeight,
  setSize,
  setWidth,
  size,
  width,
} from "../state/modes";
import { helpOpen, reviewingComplete, session, summaryOpen } from "../state/store";
import drawerCss from "../styles/drawer.css?raw";
import googleFonts from "../styles/google-fonts.css?raw";
import tokensCss from "../styles/tokens.css?raw";
import { AgentFeed } from "./AgentFeed";
import { Detail } from "./Detail";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { KeymapOverlay } from "./KeymapOverlay";
import { PipStrip } from "./PipStrip";
import { ResizeHandle } from "./ResizeHandle";
import { ReviewComplete } from "./ReviewComplete";
import { ReviewSummary } from "./ReviewSummary";

const MIN_W = 360;
const MAX_W = 800;
const MIN_H = 280;
const MAX_H = 900;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const Drawer: Component = () => {
  const modeClasses = () => {
    const cls = [`drawer pos-${position()} size-${size()}`];
    if (session.s?.status === "paused") cls.push("paused");
    if (interactiveResize()) cls.push("resizing");
    if (reflow()) cls.push("reflow-on");
    return cls.join(" ");
  };
  const floatStyle = () =>
    position() === "floating"
      ? {
          top: `${floatingTop()}px`,
          left: `${floatingLeft()}px`,
          right: "auto",
          bottom: "auto",
          width: `${width()}px`,
          height: `${height()}px`,
        }
      : { width: `${width()}px` };

  /** Strip mode has no header, so the strip body itself doubles as click-to-
   *  expand AND (when floating) drag-to-move. Distinguishes drag from click
   *  by movement threshold; same pointer-capture pattern as the header drag
   *  so the release fires reliably even when the cursor leaves the viewport. */
  const onStripPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);

    const isFloating = position() === "floating";
    const startX = e.clientX;
    const startY = e.clientY;
    const startTop = floatingTop();
    const startLeft = floatingLeft();
    let dragged = false;
    const DRAG_THRESHOLD = 3;

    const onMove = (ev: PointerEvent) => {
      if (!isFloating) return;
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        dragged = true;
        document.body.style.cursor = "grabbing";
      }
      if (dragged) {
        setFloatingTop(Math.max(0, startTop + dy));
        setFloatingLeft(Math.max(0, startLeft + dx));
      }
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
      if (!dragged) {
        setSize("standard");
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
  };

  return (
    <>
      <style>{googleFonts}</style>
      <style>{tokensCss}</style>
      <style>{drawerCss}</style>
      <Show
        when={session.s}
        fallback={
          <Show
            when={size() === "strip"}
            fallback={
              <aside class="drawer pos-right size-standard empty" style={{ width: `${width()}px` }}>
                <div class="metabar">
                  <span>pitstop · idle</span>
                  <span class="center">NO SESSION</span>
                  <span class="right">localhost:7773</span>
                </div>
                <div class="empty-body">
                  <div class="empty-headline">No active review</div>
                  <p class="empty-text">
                    Pitstop is connected and waiting. To start a review, ask your agent:
                  </p>
                  <pre class="empty-prompt">"Start a pitstop review of the work you just did."</pre>
                  <p class="empty-text empty-hint">
                    The agent will list items it wants you to look at, then wait here for your <kbd>⏎</kbd>{" "}
                    approve or <kbd>c</kbd> comment on each one.
                  </p>
                  <button class="empty-collapse" onClick={() => setSize("strip")} title="Collapse to strip">
                    collapse
                  </button>
                </div>
                <ResizeHandle
                  direction="edge-left"
                  onDrag={(dx) => setWidth(clamp(width() - dx, MIN_W, MAX_W))}
                />
              </aside>
            }
          >
            <aside class="drawer pos-right size-strip empty" title="Click to expand — no active review">
              <div class="strip" onClick={() => setSize("standard")}>
                <span class="v-label">PITSTOP</span>
                <span class="v-dot waiting" />
              </div>
            </aside>
          </Show>
        }
      >
        <aside class={modeClasses()} style={floatStyle()}>
          <Show
            when={size() !== "strip"}
            fallback={
              <div
                class="strip"
                onPointerDown={onStripPointerDown}
                title={position() === "floating" ? "Click to expand · drag to move" : "Click to expand"}
              >
                <div class="strip-top">
                  <span class="v-mark" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      <rect x="0" y="0" width="12" height="12" fill="currentColor" />
                      <rect x="12" y="12" width="12" height="12" fill="currentColor" />
                    </svg>
                  </span>
                  <span class="v-label">PITSTOP</span>
                </div>
                <div class="strip-bottom">
                  <span class="v-num">{String(session.s?.items.length ?? 0).padStart(2, "0")}</span>
                  <span class="v-dot" />
                </div>
              </div>
            }
          >
            <div class="metabar">
              <span>~/.claude/pitstop/sessions/{session.s?.id}.json</span>
              <span class="center">S#{session.s?.id}</span>
              <span class="right">T=…</span>
            </div>
            <Header />
            <PipStrip />
            <Show
              when={session.s?.status === "complete" && !reviewingComplete()}
              fallback={
                <Show when={summaryOpen()} fallback={<Detail />}>
                  <ReviewSummary />
                </Show>
              }
            >
              <ReviewComplete />
            </Show>
            <AgentFeed />
            <Footer />
          </Show>
          <Show when={helpOpen()}>
            <KeymapOverlay />
          </Show>
          <Show when={size() !== "strip"}>
            <Show when={position() === "right"}>
              <ResizeHandle
                direction="edge-left"
                onDrag={(dx) => setWidth(clamp(width() - dx, MIN_W, MAX_W))}
              />
            </Show>
            <Show when={position() === "left"}>
              <ResizeHandle
                direction="edge-right"
                onDrag={(dx) => setWidth(clamp(width() + dx, MIN_W, MAX_W))}
              />
            </Show>
            <Show when={position() === "floating"}>
              <ResizeHandle
                direction="corner-se"
                onDrag={(dx, dy) => {
                  setWidth(clamp(width() + dx, MIN_W, MAX_W));
                  setHeight(clamp(height() + dy, MIN_H, MAX_H));
                }}
              />
              <ResizeHandle
                direction="corner-sw"
                onDrag={(dx, dy) => {
                  const nextW = clamp(width() - dx, MIN_W, MAX_W);
                  const appliedDx = width() - nextW;
                  setWidth(nextW);
                  setHeight(clamp(height() + dy, MIN_H, MAX_H));
                  setFloatingLeft(floatingLeft() + appliedDx);
                }}
              />
              <ResizeHandle
                direction="corner-ne"
                onDrag={(dx, dy) => {
                  const nextH = clamp(height() - dy, MIN_H, MAX_H);
                  const appliedDy = height() - nextH;
                  setWidth(clamp(width() + dx, MIN_W, MAX_W));
                  setHeight(nextH);
                  setFloatingTop(floatingTop() + appliedDy);
                }}
              />
              <ResizeHandle
                direction="corner-nw"
                onDrag={(dx, dy) => {
                  const nextW = clamp(width() - dx, MIN_W, MAX_W);
                  const appliedDx = width() - nextW;
                  const nextH = clamp(height() - dy, MIN_H, MAX_H);
                  const appliedDy = height() - nextH;
                  setWidth(nextW);
                  setHeight(nextH);
                  setFloatingTop(floatingTop() + appliedDy);
                  setFloatingLeft(floatingLeft() + appliedDx);
                }}
              />
            </Show>
          </Show>
        </aside>
      </Show>
    </>
  );
};
