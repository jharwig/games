// =============================================================================
// menu.ts — the front menu, the results screen and the tilt-permission prompt.
// Pure DOM again: main owns the save data, this just renders it and calls back.
// =============================================================================
import { CARS, type CarId, type CarSpec } from './cars';
import { TRACKS, type TrackId } from './tracks';
import type { BestTime } from './types';
import { clamp, fmtTime } from './util';

export interface MenuState {
  coins: number;
  unlocked: CarId[];
  best: Partial<Record<TrackId, BestTime>>;
  track: TrackId;
  car: CarId;
  muted: boolean;
  tilt: 'on' | 'off' | null;
  touch: boolean;
}

export interface MenuHandlers {
  onStart(track: TrackId, car: CarId): void;
  /** buy the car; return whether the purchase went through (menu re-renders) */
  onBuy(car: CarId): boolean;
  /** toggle sound; return the NEW muted state */
  onMute(): boolean;
  /** turn tilt steering on/off (called from inside the click gesture) */
  onTilt(on: boolean): void;
}

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const menuEl = el('menu');
const coinsEl = el('menu-coins');
const trackList = el('track-list');
const carList = el('car-list');
const raceBtn = el<HTMLButtonElement>('race-btn');
const muteBtn = el<HTMLButtonElement>('mute-btn');
const muteLabel = el('mute-label');
const muteWaves = document.getElementById('mute-on-waves') as unknown as SVGGElement;
const muteX = document.getElementById('mute-off-x') as unknown as SVGGElement;
const tiltBtn = el<HTMLButtonElement>('tilt-btn');
const tiltLabel = el('tilt-label');

const resultsEl = el('results');
const resultsTitle = el('results-title');
const resTime = el('res-time');
const resBest = el('res-best');
const resCoins = el('res-coins');
const resBanked = el('res-banked');
const againBtn = el<HTMLButtonElement>('again-btn');
const menuBtn = el<HTMLButtonElement>('menu-btn');

const promptEl = el('tilt-prompt');
const tiltYes = el<HTMLButtonElement>('tilt-yes');
const tiltNo = el<HTMLButtonElement>('tilt-no');

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const bestStr = (b: BestTime | undefined) => (b ? fmtTime(b.time) : '--:--.--');

// stat bars: fixed scales (not per-car maxima) so the differences read clearly
const STAT_RANGE: Record<string, [number, number]> = {
  speed: [32, 48], accel: [14, 28], grip: [0.6, 1.4], handling: [0.75, 1.3],
};
function statFrac(kind: keyof typeof STAT_RANGE, v: number): number {
  const [lo, hi] = STAT_RANGE[kind];
  return clamp((v - lo) / (hi - lo), 0.1, 1);
}

const CAR_SILHOUETTE =
  '<svg viewBox="0 0 40 22" aria-hidden="true">'
  + '<path d="M3 16h34a2 2 0 0 0 2-2v-2a3 3 0 0 0-2.4-2.9L28 7.4 24 3.6A3 3 0 0 0 22 3h-7a3 3 0 0 0-2.3 1.1L9 9 3.6 10.1A3 3 0 0 0 1 13v1a2 2 0 0 0 2 2z"'
  + ' fill="rgba(0,0,0,0.45)"/>'
  + '<circle cx="11" cy="16.5" r="4" fill="#1b1b22"/><circle cx="11" cy="16.5" r="1.6" fill="#d8d8e0"/>'
  + '<circle cx="30" cy="16.5" r="4" fill="#1b1b22"/><circle cx="30" cy="16.5" r="1.6" fill="#d8d8e0"/>'
  + '</svg>';

const LOCK_ICON =
  '<svg class="lock-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"'
  + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<rect x="4" y="10" width="16" height="11" rx="2.5" fill="currentColor" stroke="none"/>'
  + '<path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

const COIN_ICON =
  '<svg class="coin-ico" viewBox="0 0 24 24" aria-hidden="true">'
  + '<circle cx="12" cy="12" r="10" fill="#20143a" opacity=".25"/>'
  + '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>';

// =============================================================================
// menu
// =============================================================================
let state: MenuState | null = null;
let handlers: MenuHandlers | null = null;
let wired = false;

export function showMenu(s: MenuState, h: MenuHandlers): void {
  state = { ...s, unlocked: [...s.unlocked] };
  handlers = h;
  wire();
  menuEl.classList.remove('hidden');
  render();
}

export function hideMenu(): void {
  menuEl.classList.add('hidden');
}

export function refreshMenu(s: MenuState): void {
  state = { ...s, unlocked: [...s.unlocked] };
  render();
}

function wire(): void {
  if (wired) return;
  wired = true;

  raceBtn.addEventListener('click', () => {
    if (state && handlers) handlers.onStart(state.track, state.car);
  });

  muteBtn.addEventListener('click', () => {
    if (!handlers || !state) return;
    state.muted = handlers.onMute();
    renderMute();
  });

  tiltBtn.addEventListener('click', () => {
    if (!handlers || !state) return;
    const on = state.tilt !== 'on';
    state.tilt = on ? 'on' : 'off';
    renderTilt();
    handlers.onTilt(on);   // stays inside the gesture, so iOS can ask
  });
}

function render(): void {
  if (!state) return;
  coinsEl.textContent = String(state.coins);
  if (state.touch) document.body.classList.add('touch');
  renderMute();
  renderTilt();
  renderTracks();
  renderCars();
}

function renderMute(): void {
  if (!state) return;
  muteLabel.textContent = state.muted ? 'SOUND OFF' : 'SOUND ON';
  muteBtn.classList.toggle('on', !state.muted);
  muteWaves.style.display = state.muted ? 'none' : '';
  muteX.style.display = state.muted ? '' : 'none';
}

function renderTilt(): void {
  if (!state) return;
  const on = state.tilt === 'on';
  tiltLabel.textContent = on ? 'TILT ON' : 'TILT OFF';
  tiltBtn.classList.toggle('on', on);
}

function renderTracks(): void {
  if (!state) return;
  trackList.textContent = '';
  for (const t of TRACKS) {
    const b = document.createElement('button');
    b.className = 'track-chip' + (t.id === state.track ? ' selected' : '');
    b.type = 'button';
    b.innerHTML =
      `<div class="nm">${t.name}</div>`
      + `<div class="ty">${t.type}</div>`
      + `<div class="bt"><em>BEST</em>${bestStr(state.best[t.id])}</div>`;
    b.addEventListener('click', () => {
      if (!state) return;
      state.track = t.id;
      renderTracks();
    });
    trackList.appendChild(b);
  }
}

function renderCars(): void {
  if (!state) return;
  carList.textContent = '';
  for (const c of CARS) {
    carList.appendChild(carCard(c, state));
  }
}

function carCard(c: CarSpec, s: MenuState): HTMLElement {
  const owned = c.cost === 0 || s.unlocked.includes(c.id);
  const selected = owned && c.id === s.car;

  const card = document.createElement('div');
  card.className = 'car-card' + (selected ? ' selected' : '') + (owned ? '' : ' locked');

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'car-pick';
  pick.innerHTML =
    `<div class="car-head">`
    + `<span class="car-swatch" style="background:${hex(c.color)}">${CAR_SILHOUETTE}</span>`
    + `<span class="car-name">${c.name}</span>`
    + `</div>`
    + `<div class="car-ability">${owned ? '' : LOCK_ICON + ' '}${c.abilityName.toUpperCase()}</div>`
    + `<div class="car-blurb">${c.abilityBlurb}</div>`
    + statRow('speed', c.topSpeed) + statRow('accel', c.accel)
    + statRow('grip', c.grip) + statRow('handling', c.turn);
  if (owned) {
    pick.addEventListener('click', () => {
      if (!state) return;
      state.car = c.id;
      renderCars();
    });
  } else {
    pick.disabled = true;
  }
  card.appendChild(pick);

  const foot = document.createElement('div');
  foot.className = 'car-foot';
  if (owned) {
    foot.innerHTML = `<span class="owned-tag">${selected ? 'SELECTED' : 'OWNED'}</span>`;
  } else {
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'buy-btn';
    buy.disabled = s.coins < c.cost;
    buy.innerHTML = `${COIN_ICON}<span>BUY ${c.cost}</span>`;
    buy.addEventListener('click', () => {
      if (!handlers || !state) return;
      if (!handlers.onBuy(c.id)) return;
      // optimistic local update so the card flips straight away; main can
      // still call refreshMenu() with the authoritative numbers.
      state.coins -= c.cost;
      if (!state.unlocked.includes(c.id)) state.unlocked.push(c.id);
      state.car = c.id;
      coinsEl.textContent = String(state.coins);
      renderCars();
    });
    foot.appendChild(buy);
  }
  card.appendChild(foot);
  return card;
}

function statRow(kind: 'speed' | 'accel' | 'grip' | 'handling', v: number): string {
  const pct = (statFrac(kind, v) * 100).toFixed(0);
  return `<div class="stat"><span class="n">${kind}</span>`
    + `<span class="bar"><i style="width:${pct}%"></i></span></div>`;
}

// =============================================================================
// results
// =============================================================================
export interface ResultsData {
  time: number; best: number; newBest: boolean; coins: number; banked: number;
}
export interface ResultsHandlers { onAgain(): void; onMenu(): void }

let resultsWired = false;
let resultsH: ResultsHandlers | null = null;

export function showResults(r: ResultsData, h: ResultsHandlers): void {
  resultsH = h;
  if (!resultsWired) {
    resultsWired = true;
    againBtn.addEventListener('click', () => resultsH?.onAgain());
    menuBtn.addEventListener('click', () => resultsH?.onMenu());
  }
  resultsTitle.textContent = r.newBest ? 'NEW BEST!' : 'FINISH!';
  resultsTitle.className = r.newBest ? 'newbest' : '';
  resTime.textContent = fmtTime(r.time);
  resBest.textContent = isFinite(r.best) && r.best > 0 ? fmtTime(r.best) : '--:--.--';
  resCoins.textContent = String(r.coins);
  resBanked.textContent = String(r.banked);
  resultsEl.classList.remove('hidden');
}

export function hideResults(): void {
  resultsEl.classList.add('hidden');
}

// =============================================================================
// tilt prompt
// =============================================================================
/**
 * One-time "steer by tilting?" modal. ENABLE calls `onEnable` from inside the
 * click handler (that is what iOS requires for the permission request) and the
 * promise resolves with whatever it returns; NO THANKS resolves false.
 */
export function showTiltPrompt(onEnable: () => Promise<boolean>): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      tiltYes.removeEventListener('click', yes);
      tiltNo.removeEventListener('click', no);
      promptEl.classList.add('hidden');
      if (state) { state.tilt = v ? 'on' : 'off'; renderTilt(); }
      resolve(v);
    };
    const yes = () => {
      tiltYes.disabled = true;
      onEnable().then((ok) => { tiltYes.disabled = false; finish(ok); },
        () => { tiltYes.disabled = false; finish(false); });
    };
    const no = () => finish(false);
    tiltYes.addEventListener('click', yes);
    tiltNo.addEventListener('click', no);
    promptEl.classList.remove('hidden');
  });
}
