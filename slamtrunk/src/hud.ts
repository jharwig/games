// =============================================================================
// hud.ts — the in-game overlay. Pure DOM: it only writes into the elements
// declared in index.html and never reads game state. The whole layer is
// pointer-events:none so drags/taps reach the canvas; the mute button is the
// one exception, and while the HUD is `hidden` nothing in it can be hit.
// =============================================================================
import type { HudApi, Score } from './types';

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

/** Retrigger a CSS animation that may already be running. */
function restart(node: HTMLElement, cls: string): void {
  node.classList.remove(cls);
  void node.offsetWidth; // force a style flush so the animation starts over
  node.classList.add(cls);
}

function fmtTime(secondsLeft: number): string {
  const s = Math.max(0, Math.ceil(secondsLeft));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface SlamHudApi extends HudApi {
  /** extra to the contract: the HUD owns the mute button, main.ts owns the audio */
  onMute(cb: (muted: boolean) => void): void;
}

export function createHud(): SlamHudApi {
  const hud = el('hud');
  const tag = el('tag');
  const coins = el('coins');
  const muteBtn = el<HTMLButtonElement>('mute');
  const scoreP = el('score-p');
  const scoreE = el('score-e');
  const timerPill = el('timer-pill');
  const timeVal = el('time-val');
  const countdown = el('countdown');
  const flashEl = el('flash');
  const hint = el('hint');

  let muted = false;
  let muteCb: ((m: boolean) => void) | null = null;

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteCb?.(muted);
  });

  let lastTime = -1;

  return {
    show(): void {
      hud.hidden = false;
    },
    hide(): void {
      hud.hidden = true;
      countdown.classList.remove('pop');
      flashEl.classList.remove('pop');
      hint.textContent = '';
    },
    setScore(s: Score): void {
      scoreP.textContent = String(s.peanut);
      scoreE.textContent = String(s.ellie);
    },
    setTime(secondsLeft: number): void {
      const s = Math.max(0, Math.ceil(secondsLeft));
      if (s === lastTime) return;
      lastTime = s;
      timeVal.textContent = fmtTime(s);
      timerPill.classList.toggle('low', s <= 10);
    },
    setCoins(n: number): void {
      coins.textContent = `🪙 ${n}`;
    },
    setStadium(name: string): void {
      tag.textContent = name;
    },
    showCountdown(n: number | 'GO'): void {
      countdown.textContent = n === 'GO' ? 'GO!' : String(n);
      countdown.classList.toggle('go', n === 'GO');
      restart(countdown, 'pop');
    },
    flash(text: string, kind: 'good' | 'bad' | 'neutral' = 'good'): void {
      flashEl.textContent = text;
      flashEl.classList.remove('good', 'bad', 'neutral');
      flashEl.classList.add(kind);
      restart(flashEl, 'pop');
    },
    setHint(text: string): void {
      hint.textContent = text;
    },
    onMute(cb: (m: boolean) => void): void {
      muteCb = cb;
    },
  };
}
