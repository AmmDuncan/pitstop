import { type Component, Show } from 'solid-js';
import tokensCss from '../styles/tokens.css?raw';
import drawerCss from '../styles/drawer.css?raw';
import googleFonts from '../styles/google-fonts.css?raw';
import { Header } from './Header';
import { PipStrip } from './PipStrip';
import { Footer } from './Footer';
import { Detail } from './Detail';
import { ReviewSummary } from './ReviewSummary';
import { ResizeHandle } from './ResizeHandle';
import { KeymapOverlay } from './KeymapOverlay';
import { session, summaryOpen, helpOpen } from '../state/store';
import {
  position,
  size,
  setSize,
  width,
  setWidth,
  height,
  setHeight,
  floatingTop,
  setFloatingTop,
  floatingLeft,
  setFloatingLeft,
} from '../state/modes';

const MIN_W = 360;
const MAX_W = 800;
const MIN_H = 280;
const MAX_H = 900;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const Drawer: Component = () => {
  const modeClasses = () => {
    const cls = [`drawer pos-${position()} size-${size()}`];
    if (session.s?.status === 'paused') cls.push('paused');
    return cls.join(' ');
  };
  const floatStyle = () =>
    position() === 'floating'
      ? {
          top: `${floatingTop()}px`,
          left: `${floatingLeft()}px`,
          right: 'auto',
          bottom: 'auto',
          width: `${width()}px`,
          height: `${height()}px`,
        }
      : { width: `${width()}px` };

  return (
    <>
      <style>{googleFonts}</style>
      <style>{tokensCss}</style>
      <style>{drawerCss}</style>
      <Show when={session.s} fallback={<aside class={`${modeClasses()} empty`} style={floatStyle()}>…</aside>}>
        <aside class={modeClasses()} style={floatStyle()}>
          <Show when={size() !== 'strip'} fallback={
            <div class="strip" onClick={() => setSize('standard')} title="Click to expand">
              <span class="v-label">PITSTOP</span>
              <span class="v-num">{String(session.s?.items.length ?? 0).padStart(2, '0')}</span>
              <span class="v-dot" />
            </div>
          }>
            <div class="metabar">
              <span>~/.claude/pitstop/sessions/{session.s?.id}.json</span>
              <span class="center">S#{session.s?.id}</span>
              <span class="right">T=…</span>
            </div>
            <Header />
            <PipStrip />
            <Show when={summaryOpen()} fallback={<Detail />}>
              <ReviewSummary />
            </Show>
            <Footer />
          </Show>
          <Show when={helpOpen()}>
            <KeymapOverlay />
          </Show>
          <Show when={size() !== 'strip'}>
            <Show when={position() === 'right'}>
              <ResizeHandle
                direction="edge-left"
                onDrag={(dx) => setWidth(clamp(width() - dx, MIN_W, MAX_W))}
              />
            </Show>
            <Show when={position() === 'left'}>
              <ResizeHandle
                direction="edge-right"
                onDrag={(dx) => setWidth(clamp(width() + dx, MIN_W, MAX_W))}
              />
            </Show>
            <Show when={position() === 'floating'}>
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
