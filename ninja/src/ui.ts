// =============================================================================
// DOM: HUD chips, medals, tips, the level banner, the title card and the
// course mode buttons. The markup lives in index.html; this module only
// finds and updates it.
// =============================================================================
import { MEDAL_COL, MEDAL_ICON, type Medal } from "./constants";
import type { Mode } from "./path";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error("missing #" + id);
  return e as T;
}

export const hudEl = el("hud");
export const lvlChip = el("lvlChip");
export const timeChip = el("timeChip");
export const bestChip = el("bestChip");
export const medalsEl = el("medals");
export const muteBtn = el<HTMLButtonElement>("muteBtn");
export const titleEl = el("title");
export const titleBest = el("titleBest");
export const bannerEl = el("banner");
export const bannerMedal = el("bannerMedal");
export const bannerTitle = el("bannerTitle");
export const bannerSub = el("bannerSub");
export const fallMsg = el("fallMsg");
export const touchHints = el("touchHints");
export const tipEl = el("tip");
export const outfitPickEl = el("outfitPick");
export const titleOutfits = el("titleOutfits");
export const podiumOutfits = el("podiumOutfits");

let lastTimeStr = "";
export function updateHud(level: number, best: number, levelTime: number): void {
  lvlChip.textContent = "LEVEL " + level;
  bestChip.textContent = "BEST " + best;
  const s = levelTime.toFixed(1);
  if (s !== lastTimeStr) { timeChip.textContent = s; lastTimeStr = s; }
}

export function renderMedals(medals: Medal[]): void {
  const show = medals.slice(-14);
  const extra = medals.length - show.length;
  let html = extra > 0 ? '<span id="medalMore">+' + extra + "</span>" : "";
  for (let i = 0; i < show.length; i++) html += '<span class="medal ' + show[i] + '"></span>';
  medalsEl.innerHTML = html;
}

let tipT = 0;
export function showTip(text: string, secs?: number): void {
  tipEl.textContent = text;
  tipEl.classList.add("visible");
  tipT = secs || 2.2;
}
export function tickTip(dt: number): void {
  if (tipT > 0) {
    tipT -= dt;
    if (tipT <= 0) tipEl.classList.remove("visible");
  }
}

export function setMuteLabel(muted: boolean): void {
  muteBtn.innerHTML = muted ? "&#128263;" : "&#128266;";
  muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
}

export function showBanner(kind: Medal, podiums: number, t: number, par: number): void {
  bannerMedal.style.background = MEDAL_COL[kind];
  bannerMedal.innerHTML = MEDAL_ICON[kind];
  bannerTitle.textContent = "PODIUM " + podiums + "!";
  bannerSub.textContent = kind.toUpperCase() + " · " + t.toFixed(1) + "s · PAR " + par.toFixed(1) + "s";
  bannerEl.classList.remove("visible");
  void bannerEl.offsetWidth;    // restart the pop animation
  bannerEl.classList.add("visible");
  outfitPickEl.classList.add("visible");
}
export function hideBanner(): void {
  bannerEl.classList.remove("visible");
  outfitPickEl.classList.remove("visible");
}

// title card -> playing
export function showPlayScreen(): void {
  titleEl.classList.remove("visible");
  hudEl.classList.add("visible");
  muteBtn.classList.add("visible");
  touchHints.classList.add("visible");
}

export function refreshTitleBest(best: number): void {
  titleBest.textContent = "BEST RUN: " + best + (best === 1 ? " PODIUM" : " PODIUMS");
}

export function selectModeButton(mode: Mode): void {
  const btns = document.querySelectorAll<HTMLElement>(".modeBtn");
  for (let i = 0; i < btns.length; i++) btns[i].classList.toggle("selected", btns[i].dataset.mode === mode);
}

export function wireModeButtons(onPick: (mode: string) => void): void {
  const btns = document.querySelectorAll<HTMLElement>(".modeBtn");
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    // pointerdown, so a tap never doubles as a game start
    b.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      e.preventDefault();
      onPick(b.dataset.mode || "");
    }, { passive: false });
    b.addEventListener("click", function (e) { e.stopPropagation(); });
  }
}
