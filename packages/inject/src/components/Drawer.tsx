import { type Component, Show } from 'solid-js';
import tokensCss from '../styles/tokens.css?raw';
import drawerCss from '../styles/drawer.css?raw';
import googleFonts from '../styles/google-fonts.css?raw';
import { Header } from './Header';
import { PipStrip } from './PipStrip';
import { Footer } from './Footer';
import { Detail } from './Detail';
import { session } from '../state/store';
import { position, size, width, floatingTop, floatingLeft } from '../state/modes';

export const Drawer: Component = () => {
  const modeClasses = () => `drawer pos-${position()} size-${size()}`;
  const floatStyle = () =>
    position() === 'floating'
      ? { top: `${floatingTop()}px`, left: `${floatingLeft()}px`, right: 'auto', bottom: 'auto', width: `${width()}px`, height: '600px' }
      : { width: `${width()}px` };

  return (
    <>
      <style>{googleFonts}</style>
      <style>{tokensCss}</style>
      <style>{drawerCss}</style>
      <Show when={session.s} fallback={<aside class={`${modeClasses()} empty`} style={floatStyle()}>…</aside>}>
        <aside class={modeClasses()} style={floatStyle()}>
          <Show when={size() !== 'strip'} fallback={
            <div class="strip">
              <span class="v-label">WALKTHROUGH</span>
              <span class="v-num">{String(session.s?.items.length ?? 0).padStart(2, '0')}</span>
              <span class="v-dot" />
            </div>
          }>
            <div class="metabar">
              <span>~/.claude/walkthrough/sessions/{session.s?.id}.json</span>
              <span class="center">S#{session.s?.id}</span>
              <span class="right">T=…</span>
            </div>
            <Header />
            <PipStrip />
            <Detail />
            <Footer />
          </Show>
        </aside>
      </Show>
    </>
  );
};
