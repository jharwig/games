// =============================================================================
// hud.ts — the in-race overlay. Pure DOM: every function just writes into the
// elements declared in index.html, nothing here reads game state or time.
// =============================================================================
import { clamp, fmtTime } from './util';

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const hud = el('hud');
const speedVal = el('speed-val');
const gaugeFill = document.getElementById('gauge-fill') as unknown as SVGPathElement;
const gaugeNeedle = document.getElementById('gauge-needle') as unknown as SVGGElement;
const timeVal = el('time-val');
const bestVal = el('best-val');
const ghostDelta = el('ghost-delta');
const abilityBox = el('ability');
const abilityName = el('ability-name');
const abilityPips = el('ability-pips');
const abilityBar = el('ability-bar').firstElementChild as HTMLElement;
const coinsRun = el('coins-run');
const coinsBanked = el('coins-banked');
const cpVal = el('cp-val');
const cpFill = el('cp-fill');
const messageEl = el('message');
const toastEl = el('toast');
const celebrateEl = el('celebrate');

/** Top of the speedo dial, in MPH. */
const GAUGE_MAX = 140;
const MPS_TO_MPH = 2.237;

// ---- visibility -------------------------------------------------------------
export function showHud(on: boolean): void {
  hud.classList.toggle('visible', on);
  if (!on) {
    setMessage('');
    toastEl.classList.remove('show');
    celebrateEl.classList.remove('show');
  }
}

// ---- speedometer ------------------------------------------------------------
let lastMph = -1;
export function setSpeed(mps: number): void {
  const mph = Math.max(0, Math.round(Math.abs(mps) * MPS_TO_MPH));
  if (mph === lastMph) return;
  lastMph = mph;
  speedVal.textContent = String(mph);
  const f = clamp(mph / GAUGE_MAX, 0, 1);
  // the arc is declared with pathLength="100", so the offset is just 100 - %
  gaugeFill.setAttribute('stroke-dashoffset', String(100 - f * 100));
  gaugeNeedle.setAttribute('transform', `rotate(${(f * 180 - 90).toFixed(1)} 50 50)`);
}

// ---- timer ------------------------------------------------------------------
let lastTime = -1;
export function setTime(seconds: number): void {
  const s = Math.max(0, seconds);
  if (Math.abs(s - lastTime) < 0.005) return;
  lastTime = s;
  timeVal.textContent = fmtTime(s);
}

export function setBest(seconds: number | null): void {
  bestVal.textContent = `BEST ${seconds === null ? '--:--.--' : fmtTime(seconds)}`;
}

/** Seconds ahead(-) / behind(+) the ghost; null hides it. */
export function setGhostDelta(seconds: number | null): void {
  if (seconds === null) {
    ghostDelta.textContent = '';
    ghostDelta.className = '';
    return;
  }
  const ahead = seconds < 0;
  ghostDelta.textContent = `${ahead ? '-' : '+'}${Math.abs(seconds).toFixed(2)}`;
  ghostDelta.className = ahead ? 'ahead' : 'behind';
}

// ---- ability ----------------------------------------------------------------
let pipCount = -1;
export function setAbility(name: string, uses: number, active: boolean, timeLeft: number, total: number): void {
  if (abilityName.textContent !== name) abilityName.textContent = name;
  if (uses !== pipCount) {
    pipCount = uses;
    const pips = abilityPips.children;
    for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < uses);
  }
  abilityBox.classList.toggle('out', uses <= 0 && !active);
  abilityBox.classList.toggle('active', active);
  abilityBar.style.width = active && total > 0
    ? `${clamp(timeLeft / total, 0, 1) * 100}%`
    : '0%';
}

/** Wire up the touch ability button (the HUD ability panel is the button). */
export function setAbilityHandler(fn: () => void): void {
  abilityBox.onpointerdown = (e) => {
    if (!document.body.classList.contains('touch')) return;
    if (abilityBox.classList.contains('out')) return;
    e.preventDefault();
    fn();
  };
  abilityBox.ontouchstart = (e) => { if (document.body.classList.contains('touch')) e.preventDefault(); };
}

// ---- coins / checkpoints ----------------------------------------------------
export function setCoins(run: number, banked: number): void {
  coinsRun.textContent = String(run);
  coinsBanked.textContent = String(banked);
}

export function setCheckpoint(i: number, total: number): void {
  cpVal.textContent = `${i}/${total}`;
  cpFill.style.width = `${total > 0 ? clamp(i / total, 0, 1) * 100 : 0}%`;
}

// ---- big centre message -----------------------------------------------------
export type MessageStyle = 'count' | 'go' | 'finish' | '';

export function setMessage(text: string, style: MessageStyle = ''): void {
  if (!text) {
    messageEl.classList.remove('show');
    return;
  }
  messageEl.className = style;
  messageEl.textContent = text;
  // restart the pop transition even when the text is unchanged
  void messageEl.offsetWidth;
  messageEl.classList.add('show');
}

// ---- toast ------------------------------------------------------------------
let toastTimer = 0;
export function toast(text: string, ms = 1100): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms) as unknown as number;
}

// ---- new best celebration ---------------------------------------------------
let celebrateTimer = 0;
export function celebrate(): void {
  celebrateEl.classList.remove('show');
  void celebrateEl.offsetWidth;   // reflow so the CSS animations replay
  celebrateEl.classList.add('show');
  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(() => celebrateEl.classList.remove('show'), 2600) as unknown as number;
}
