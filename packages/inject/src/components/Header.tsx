import { type Component } from 'solid-js';
import { session, pokeStatus } from '../state/store';
import { StatusTag, derivePill } from './StatusTag';

export const Header: Component = () => {
  const pill = () => derivePill(session.s, pokeStatus());
  return (
    <header class="dheader">
      <div class="mark">W</div>
      <div>
        <div class="name">WALKTHROUGH</div>
        <div class="ctx">{session.s?.branch ?? session.s?.projectRoot ?? '—'}</div>
      </div>
      <StatusTag pill={pill()} />
      <button class="x-btn">×</button>
    </header>
  );
};
