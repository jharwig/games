// DOM lookups and HUD/title/over/credits updates for the markup in index.html.
import { HEARTS, REVOLVER_ROUNDS, STREAK_STEPS } from './constants';
import { CREDITS } from './credits';
import type { GunKind, GunState } from './guns';

const $ = (id: string) => document.getElementById(id)!;
export const el = {
  hud: $('hud'), hearts: $('hearts'), score: $('score'), streak: $('streak'), raidTag: $('raidTag'),
  weaponName: $('weaponName'), rounds: $('rounds'), weaponHint: $('weaponHint'), crosshair: $('crosshair'),
  banner: $('banner'), flash: $('flash'),
  title: $('title'), best: $('best'), loading: $('loading'), loadBar: $('loadBar').firstElementChild as HTMLElement,
  startRow: $('startRow'), btnStart: $('btnStart'), btnCredits: $('btnCredits'), btnMute: $('btnMute'), btnGyro: $('btnGyro'), toggles: $('toggles'),
  gyroAsk: $('gyroAsk'), btnGyroYes: $('btnGyroYes'), btnGyroNo: $('btnGyroNo'),
  over: $('over'), overScore: $('overScore'), overBest: $('overBest'), btnAgain: $('btnAgain'), btnMenu: $('btnMenu'),
  credits: $('credits'), creditList: $('creditList'), btnCreditsClose: $('btnCreditsClose'),
};

export function setLoading(p: number) { el.loadBar.style.width = `${Math.round(p * 100)}%`; }
export function loadingDone() { el.loading.classList.add('hidden'); el.startRow.classList.remove('hidden'); }

export function showTitle(best: number) {
  el.title.classList.remove('hidden'); el.over.classList.add('hidden'); el.hud.classList.add('hidden'); el.toggles.classList.remove('hidden');
  el.best.textContent = best > 0 ? `Best: ${best}` : '';
}
export function showHud() { el.title.classList.add('hidden'); el.over.classList.add('hidden'); el.hud.classList.remove('hidden'); el.toggles.classList.add('hidden'); }
export function showOver(score: number, best: number, isNew: boolean) {
  el.over.classList.remove('hidden'); el.toggles.classList.remove('hidden');
  el.overScore.textContent = `Riders downed: ${score}`;
  el.overBest.textContent = isNew ? `New best! ${best}` : `Best: ${best}`;
}
export function setHearts(n: number) {
  let s = '';
  for (let i = 0; i < HEARTS; i++) s += i < n ? '♥' : '<span class="lost">♥</span>';
  el.hearts.innerHTML = s;
}
export function streakMult(streak: number) {
  let m = 1; for (let i = 1; i < STREAK_STEPS.length; i++) if (streak >= STREAK_STEPS[i]) m = i + 1; return m;
}
export function setScore(score: number, streak: number) {
  el.score.firstElementChild!.textContent = String(score);
  const m = streakMult(streak);
  el.streak.textContent = streak >= 2 ? `streak ${streak}${m > 1 ? ` · ×${m}` : ''}` : '';
}
export function setRaid(n: number) { el.raidTag.textContent = `Raid ${n}`; }
export function setWeapon(kind: GunKind, rounds: number, state: GunState) {
  el.weaponName.textContent = kind === 'rifle' ? 'Rifle' : 'Six-shooter';
  if (kind === 'rifle') el.rounds.innerHTML = rounds > 0 ? '●' : '<span class="spent">●</span>';
  else {
    let s = ''; for (let i = 0; i < REVOLVER_ROUNDS; i++) s += i < rounds ? '●' : '<span class="spent">●</span>';
    el.rounds.innerHTML = s;
  }
  el.weaponHint.textContent = state === 'reloading' ? 'reloading…' : state === 'cycling' && kind === 'rifle' ? 'lever…' : (document.body.classList.contains('touch') ? '' : 'Q swap · R reload');
  el.crosshair.classList.toggle('busy', state !== 'ready');
}

let bannerTimer = 0;
export function banner(text: string, sub = '', seconds = 2.2) {
  el.banner.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
  el.banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => el.banner.classList.remove('show'), seconds * 1000);
}
export function hideBanner() { el.banner.classList.remove('show'); }
let flashTimer = 0;
export function hitFlash() {
  el.flash.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el.flash.classList.remove('show'), 90);
}

export function fillCredits() {
  el.creditList.innerHTML = CREDITS.map(c => `<li><a href="${c.url}" target="_blank" rel="noopener">${c.title}</a> by ${c.author} — ${c.license}</li>`).join('');
}
export function setMuteLabel(muted: boolean) { el.btnMute.textContent = muted ? 'Sound: off' : 'Sound: on'; }
export function setGyroLabel(on: boolean, blocked = false) { el.btnGyro.textContent = on ? 'Gyro: on' : blocked ? 'Gyro: blocked' : 'Gyro: off'; }
export function showGyroButton() { el.btnGyro.classList.remove('hidden'); }
export function showControls(touch: boolean) {
  document.querySelector('#controls .desk')!.classList.toggle('hidden', touch);
  document.querySelector('#controls .mob')!.classList.toggle('hidden', !touch);
}
