// DOM lookups and updates for the markup in index.html: HUD, title screen
// (with the remembered two-dog picker), and the game-over card.

import { DOG_ROSTER, drawDogPortrait } from './agents';
import { audio, toggleMute } from './audio';

const $ = (id: string) => document.getElementById(id)!;

const hud = $('hud');
const scoreEl = $('score');
const meterFill = $('meterFill');
const meterFace = $('meterFace');
const hourEl = $('hour');
const muteBtn = $('muteBtn');
const title = $('title');
const gameover = $('gameover');

export function initUI(): void {
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
  muteBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    muteBtn.textContent = toggleMute() ? '🔇' : '🔊';
  });
}

export function setHUD(score: number, meter01: number, hour: number): void {
  scoreEl.textContent = String(score);
  meterFill.style.width = `${Math.round(meter01 * 100)}%`;
  meterFace.textContent = meter01 < 0.25 ? '😴' : meter01 < 0.5 ? '😒' : meter01 < 0.75 ? '😠' : '🤬';
  hourEl.textContent = String(hour);
}

export function showHUD(on: boolean): void {
  hud.classList.toggle('on', on);
}

// ---- title + dog picker --------------------------------------------------

export function showTitle(
  picked: string[],
  best: { hours: number; score: number } | null,
  onPickChange: (picked: string[]) => void,
  onStart: (picked: string[]) => void,
): void {
  title.classList.add('on');
  const row = $('dogRow');
  const startBtn = $('startBtn') as HTMLButtonElement;
  row.innerHTML = '';
  const sel = new Set(picked);

  const sync = (): void => {
    for (const b of row.querySelectorAll<HTMLElement>('.dogBtn')) {
      b.classList.toggle('picked', sel.has(b.dataset.name!));
    }
    startBtn.disabled = sel.size !== 2;
    onPickChange([...sel]);
  };

  for (const look of DOG_ROSTER) {
    const b = document.createElement('button');
    b.className = 'dogBtn';
    b.dataset.name = look.name;
    const cv = document.createElement('canvas');
    drawDogPortrait(cv, look);
    b.appendChild(cv);
    const label = document.createElement('span');
    label.textContent = look.name;
    b.appendChild(label);
    b.addEventListener('click', () => {
      if (sel.has(look.name)) sel.delete(look.name);
      else {
        if (sel.size >= 2) sel.delete([...sel][0]);   // swap out the older pick
        sel.add(look.name);
      }
      sync();
    });
    row.appendChild(b);
  }
  sync();

  $('titleBest').textContent = best ? `Best: lasted ${best.hours}h · ${best.score} pts` : '';
  startBtn.onclick = () => {
    if (sel.size === 2) onStart([...sel]);
  };
}

export function hideTitle(): void { title.classList.remove('on'); }

// ---- game over -----------------------------------------------------------

export function showGameOver(
  hours: number, score: number,
  best: { hours: number; score: number }, isNewBest: boolean,
  onRetry: () => void,
): void {
  gameover.classList.add('on');
  $('overHours').textContent = `You lasted ${hours} hour${hours === 1 ? '' : 's'}`;
  $('overScore').textContent = `${score} pts${isNewBest ? ' — NEW BEST!' : ''}`;
  $('overBest').textContent = `Best: ${best.hours}h · ${best.score} pts`;
  ($('retryBtn') as HTMLButtonElement).onclick = () => {
    gameover.classList.remove('on');
    onRetry();
  };
}
