import { floatingLeft, floatingTop, position, setFloatingLeft, setFloatingTop } from "./modes";

/** Pointer-down handler that drags the floating drawer. Header and metabar
 *  both use it. No-ops when the drawer isn't floating, and ignores clicks on
 *  buttons/links/inputs so chips and controls inside the dragged region keep
 *  working. Pointer capture means the release fires reliably even when the
 *  cursor leaves the viewport, crosses a shadow boundary, or goes off-screen. */
export function startFloatDrag(e: PointerEvent): void {
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
    setFloatingTop(Math.max(0, startTop + (ev.clientY - startY)));
    setFloatingLeft(Math.max(0, startLeft + (ev.clientX - startX)));
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
}
