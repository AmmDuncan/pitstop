# Pitstop logo — design

## Decision

A flush 2×2 checker pattern: two amber squares on the diagonal, the other two transparent (rendered as the dark drawer background). Replaces the placeholder `🏁` emoji currently in the drawer header.

```svg
<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <rect x="0"  y="0"  width="12" height="12" fill="currentColor"/>
  <rect x="12" y="12" width="12" height="12" fill="currentColor"/>
</svg>
```

Amber comes from the existing `--amber` design token via `currentColor` on the parent.

## Why this shape

- **Distilled racing-flag DNA.** Two squares on a diagonal is the smallest unit of a checkered pattern — readable as "pit stop" without spelling it out.
- **Geometric, no letterforms.** Avoids the cross-OS rendering jitter of emoji and the cliché of a single-letter monogram.
- **Matches the existing visual language.** The drawer's CSS already uses amber accents and 1px square geometry throughout (pip strip, panel border-stripes, amber chevron on rank-0 feed lines).
- **Scales cleanly.** Two rectangles in a 24×24 viewBox stay crisp at every size — the drawer header (22×22), favicon (16×16), GitHub social card (1280×640), README banner.

## Where it goes

- **Drawer header `<div class="mark">`** — replace the `🏁` text node with inline SVG.
- **Drop the emoji-specific CSS** added in v0.3.23 (`font-size: 16px; line-height: 1;`) — SVG sizes itself via width/height.
- **Future:** extract to `packages/inject/src/components/Logo.tsx` if/when the mark is reused (favicon, README, etc.). Inline for now — one usage doesn't justify a component.

## Out of scope

- Animated variants, monogram lockup ("🏳 PITSTOP" in a single mark), README banner, OG image. Keep the mark itself committed; collateral comes later if/when it matters.
- Rebranding non-logo surfaces (palette stays, typography stays).

## Migration

Inline change. v0.3.23 already shipped the emoji + CSS adjustments; this swaps the emoji for the SVG and trims the now-unneeded `font-size`/`line-height` rules.
