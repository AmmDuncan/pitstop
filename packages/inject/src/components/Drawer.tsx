import { type Component, Show } from 'solid-js';
import tokensCss from '../styles/tokens.css?raw';
import drawerCss from '../styles/drawer.css?raw';
import googleFonts from '../styles/google-fonts.css?raw';
import { Header } from './Header';
import { PipStrip } from './PipStrip';
import { Footer } from './Footer';
import { Detail } from './Detail';
import { session } from '../state/store';

export const Drawer: Component = () => (
  <>
    <style>{googleFonts}</style>
    <style>{tokensCss}</style>
    <style>{drawerCss}</style>
    <Show when={session.s} fallback={<aside class="drawer empty">…</aside>}>
      <aside class="drawer">
        <div class="metabar">
          <span>~/.claude/walkthrough/sessions/{session.s?.id}.json</span>
          <span class="center">S#{session.s?.id}</span>
          <span class="right">T=…</span>
        </div>
        <Header />
        <PipStrip />
        <Detail />
        <Footer />
      </aside>
    </Show>
  </>
);
