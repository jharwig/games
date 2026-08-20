// ui.ts — all DOM for Pirates of the Swingset, built inside #ui.
// Screens (title / roundWon / gameOver), the in-play HUD, transient messages,
// touch controls and the mute button. Styles are injected from here; no
// external fonts or assets — inline SVG only.

import * as THREE from 'three';
import type { CharacterKind, GameCtx, HeldKind, Screen, UiApi } from './types';
import { HEARTS_MAX, PUMP_PERFECT_PHASE } from './types';

// ---------------------------------------------------------------------------
// Styles

const CSS = `
#ui .pots {
  position: absolute; inset: 0;
  font-family: "Baskerville", "Hoefler Text", "Palatino Linotype", Palatino,
    Georgia, "Times New Roman", serif;
  color: #f6ecd4;
  -webkit-font-smoothing: antialiased;
}
#ui .pots-hud {
  position: absolute;
  inset: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right))
         auto max(8px, env(safe-area-inset-left));
  display: flex; flex-direction: column; gap: 6px;
  transform: translate3d(0,0,0);
}
#ui .pots-hud.hidden { display: none; }
#ui .pots-hud.shake { animation: pots-shake .38s cubic-bezier(.36,.07,.19,.97) both; }
@keyframes pots-shake {
  10%, 90% { transform: translate3d(-2px, 1px, 0); }
  20%, 80% { transform: translate3d(4px, -2px, 0); }
  30%, 50%, 70% { transform: translate3d(-7px, 2px, 0); }
  40%, 60% { transform: translate3d(7px, -1px, 0); }
}
#ui .pots-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

#ui .pots-plank {
  background: linear-gradient(180deg, #f9eecf, #eeddb2);
  border: 2px solid #7a5028;
  border-radius: 10px;
  box-shadow: 0 3px 0 rgba(60,35,10,.4), inset 0 1px 0 rgba(255,255,255,.5);
  padding: 5px 10px;
  font-size: 15px; line-height: 1.1; letter-spacing: .02em;
  white-space: nowrap;
  color: #4a3018;
}
#ui .pots-plank b { color: #4a3018; font-weight: 700; }
#ui .pots-plank .lbl {
  font-size: 10px; letter-spacing: .16em; text-transform: uppercase;
  color: rgba(122,80,40,.85); display: block;
}

#ui .pots-hearts { display: flex; gap: 3px; align-items: center; }
#ui .pots-hearts svg { width: 26px; height: 24px; display: block; filter: drop-shadow(0 1px 1px rgba(0,0,0,.55)); }
#ui .pots-hearts svg.gone { opacity: .45; }

#ui .pots-hpwrap { display: flex; flex-direction: column; gap: 3px; min-width: 150px; }
#ui .pots-hpwrap.hidden { visibility: hidden; }
#ui .pots-hpbar {
  height: 10px; border-radius: 5px; overflow: hidden;
  background: rgba(122,80,40,.3);
  border: 1px solid #7a5028;
}
#ui .pots-hpfill {
  height: 100%; width: 100%;
  background: linear-gradient(90deg, #d1452f, #e8873a);
  transition: width .18s ease-out;
}

#ui .pots-chip {
  display: flex; align-items: center; gap: 7px;
}
#ui .pots-chip svg { width: 22px; height: 22px; display: block; }
#ui .pots-chip.magnetball { border-color: #8fd3ff; box-shadow: 0 0 12px rgba(120,200,255,.5); }
#ui .pots-chip.hidden { display: none; }

#ui .pots-jam {
  color: #ffd873; border-color: rgba(255,216,115,.6);
  animation: pots-pulse 1s ease-in-out infinite;
}
#ui .pots-jam.hidden { display: none; }
@keyframes pots-pulse { 50% { opacity: .55; } }

#ui .pots-msg {
  position: absolute; left: 50%; top: 22%;
  transform: translate(-50%, 0);
  max-width: min(88vw, 560px); text-align: center;
  padding: 10px 20px; border-radius: 10px;
  background: linear-gradient(180deg, rgba(244,229,196,.96), rgba(226,204,162,.96));
  color: #3a2412; font-size: clamp(15px, 3.6vw, 21px); font-weight: 700;
  border: 1px solid rgba(90,58,30,.5);
  box-shadow: 0 6px 18px rgba(0,0,0,.45);
  opacity: 0; transition: opacity .35s ease, transform .35s ease;
  pointer-events: none;
}
#ui .pots-msg.show { opacity: 1; transform: translate(-50%, -6px); }

#ui .pots-incoming {
  position: absolute; left: 50%; top: 9%; transform: translateX(-50%);
  font-size: clamp(18px, 5vw, 34px); font-weight: 900; letter-spacing: .14em;
  color: #ffd23e;
  text-shadow:
    -2px -2px 0 #5c3018, 2px -2px 0 #5c3018,
    -2px 2px 0 #5c3018, 2px 2px 0 #5c3018,
    0 4px 0 rgba(60,30,10,.45), 0 0 18px rgba(255,120,40,.55);
  opacity: 0; transition: opacity .12s linear;
}
#ui .pots-incoming.show { opacity: 1; }

/* Big pops: DODGED! / SUPER! / the pirates' mood */
#ui .pots-callout {
  position: absolute; left: 50%; top: 30%; transform: translate(-50%, 0) scale(.6);
  font-size: clamp(26px, 7vw, 52px); font-weight: 900; letter-spacing: .1em;
  white-space: nowrap; pointer-events: none;
  text-shadow:
    -2px -2px 0 #3a1c0c, 2px -2px 0 #3a1c0c,
    -2px 2px 0 #3a1c0c, 2px 2px 0 #3a1c0c,
    0 5px 0 rgba(40,20,8,.5);
  opacity: 0;
}
#ui .pots-callout.show { animation: pots-pop 1.1s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes pots-pop {
  0% { opacity: 0; transform: translate(-50%, 10px) scale(.5); }
  18% { opacity: 1; transform: translate(-50%, 0) scale(1.12); }
  30% { transform: translate(-50%, 0) scale(1); }
  75% { opacity: 1; transform: translate(-50%, -6px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -26px) scale(.96); }
}
#ui .pots-callout.dodge { color: #8ff0ff; text-shadow: -2px -2px 0 #0f3a4a, 2px -2px 0 #0f3a4a, -2px 2px 0 #0f3a4a, 2px 2px 0 #0f3a4a, 0 5px 0 rgba(10,40,50,.5), 0 0 22px rgba(120,230,255,.7); }
#ui .pots-callout.super { color: #ffe14a; text-shadow: -2px -2px 0 #5c2a08, 2px -2px 0 #5c2a08, -2px 2px 0 #5c2a08, 2px 2px 0 #5c2a08, 0 5px 0 rgba(60,30,10,.5), 0 0 26px rgba(255,180,40,.85); }
#ui .pots-callout.mad { color: #ff6b5a; font-size: clamp(18px, 4.6vw, 34px); top: 36%; }

/* Pump ring: floats over the rider; fills toward the top each half-swing.
   Press when the tip is in the gold zone. */
#ui .pots-ring {
  position: absolute; left: 0; top: 0; width: 64px; height: 64px;
  margin: -32px 0 0 -32px; pointer-events: none;
  opacity: 0; transition: opacity .2s ease;
  filter: drop-shadow(0 2px 2px rgba(0,0,0,.5));
}
#ui .pots-ring.show { opacity: 1; }
#ui .pots-ring svg { width: 100%; height: 100%; display: block; overflow: visible; }
#ui .pots-ring .track { fill: none; stroke: rgba(30,18,10,.55); stroke-width: 7; }
#ui .pots-ring .zone { fill: none; stroke: #ffcf3d; stroke-width: 7; stroke-linecap: butt; }
#ui .pots-ring .fill { fill: none; stroke: #f6ecd4; stroke-width: 4.5; stroke-linecap: round; }
#ui .pots-ring .core { fill: rgba(30,18,10,.35); }
#ui .pots-ring.hit .zone { stroke: #fff3b0; filter: drop-shadow(0 0 6px #ffd23e); }
#ui .pots-ring.hit svg { animation: pots-ring-hit .3s ease-out; }
@keyframes pots-ring-hit { 30% { transform: scale(1.28); } }
#ui .pots-ring.super .track { stroke: rgba(120,50,10,.7); }
#ui .pots-ring.super .core { fill: rgba(255,160,40,.55); animation: pots-pulse .5s ease-in-out infinite; }
#ui .pots-ring.charged .core { fill: rgba(120,220,255,.6); animation: pots-pulse .7s ease-in-out infinite; }
#ui .pots-ring .tag {
  position: absolute; left: 50%; top: 100%; transform: translate(-50%, 2px);
  font-size: 12px; font-weight: 900; letter-spacing: .12em; white-space: nowrap;
  color: #ffe27a; text-shadow: 0 0 6px rgba(0,0,0,.8), 0 1px 0 #3a1c0c;
  opacity: 0; transition: opacity .15s ease;
}
#ui .pots-ring .tag.show { opacity: 1; }
#ui .pots-ring .tag.good { color: #d8f0c8; }
#ui .pots-ring .tag.super { color: #ffb347; }
#ui .pots-ring .tag.charged { color: #9fe8ff; }

/* Taunt speech bubble over the kid's head */
#ui .pots-bubble {
  position: absolute; left: 0; top: 0; transform: translate(-50%, -100%) scale(.7);
  max-width: 220px; padding: 7px 12px; border-radius: 14px;
  background: #fffaf0; color: #2c1a0c; border: 2px solid #3a1c0c;
  font-size: 14px; font-weight: 700; line-height: 1.2; text-align: center;
  box-shadow: 0 3px 0 rgba(0,0,0,.35);
  opacity: 0; transition: opacity .12s ease, transform .18s cubic-bezier(.2,1.4,.4,1);
  pointer-events: none; white-space: normal;
}
#ui .pots-bubble::after {
  content: ''; position: absolute; left: 50%; bottom: -9px; margin-left: -7px;
  border: 7px solid transparent; border-bottom: 0; border-top-color: #3a1c0c;
}
#ui .pots-bubble.show { opacity: 1; transform: translate(-50%, -100%) scale(1); }

#ui .pots-chip.charged { border-color: #9fe8ff; box-shadow: 0 0 14px rgba(120,220,255,.75); }
#ui .pots-chip .super { color: #0b7aa6; font-weight: 900; letter-spacing: .1em; font-size: 11px; }

/* --- screens ------------------------------------------------------------ */
#ui .pots-screen {
  position: absolute; inset: 0;
  display: none; flex-direction: column; align-items: center;
  justify-content: center; gap: clamp(8px, 2vh, 18px);
  padding: max(14px, env(safe-area-inset-top)) 14px max(14px, env(safe-area-inset-bottom));
  overflow: auto;
  background:
    radial-gradient(ellipse at 50% 35%, rgba(10,32,48,.35), rgba(6,20,32,.82));
  text-align: center;
}
#ui .pots-screen.show { display: flex; }

#ui .pots-title {
  font-size: clamp(28px, 8vw, 62px); line-height: 1.02; font-weight: 700;
  letter-spacing: .01em;
  color: #f7e2b0;
  text-shadow: 0 2px 0 #6d3f17, 0 5px 16px rgba(0,0,0,.65);
}
#ui .pots-title .small { display: block; font-size: .45em; letter-spacing: .3em;
  color: #cdb489; text-shadow: none; margin-bottom: .15em; }
#ui .pots-credit { font-size: clamp(12px, 3vw, 16px); color: #dcc79c; letter-spacing: .06em; }
#ui .pots-credit b { color: #ffd98a; }
#ui .pots-best { font-size: clamp(13px, 3.2vw, 18px); color: #ffd98a; }
#ui .pots-hint {
  font-size: clamp(10px, 2.6vw, 13px); color: rgba(232,215,183,.72);
  max-width: 44em; line-height: 1.6; letter-spacing: .03em;
}
#ui .pots-prompt {
  font-size: clamp(12px, 3vw, 16px); letter-spacing: .18em;
  text-transform: uppercase; color: rgba(240,220,180,.7);
}

#ui .pots-banner {
  font-size: clamp(24px, 7vw, 54px); font-weight: 800; letter-spacing: .06em;
  color: #ffe08a;
  text-shadow: 0 2px 0 #7a4415, 0 6px 20px rgba(255,150,40,.35);
}
#ui .pots-sub { font-size: clamp(13px, 3.4vw, 20px); color: #e9d6ae; max-width: 30em; }

#ui .pots-cards { display: flex; gap: clamp(10px, 3vw, 26px); flex-wrap: wrap; justify-content: center; }
#ui .pots-card {
  width: clamp(108px, 30vw, 168px);
  padding: 10px 10px 12px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(246,232,199,.94), rgba(220,199,158,.94));
  border: 2px solid rgba(96,62,30,.55);
  box-shadow: 0 6px 16px rgba(0,0,0,.45);
  color: #3a2412;
  cursor: pointer;
  transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease;
}
#ui .pots-card:hover { transform: translateY(-4px); }
#ui .pots-card:active { transform: translateY(-1px) scale(.98); }
#ui .pots-card.current {
  border-color: #f0a83a;
  box-shadow: 0 0 0 3px rgba(255,196,90,.55), 0 6px 18px rgba(0,0,0,.5);
}
#ui .pots-card svg { width: 100%; height: auto; display: block; }
#ui .pots-card .name {
  margin-top: 6px; font-size: clamp(12px, 3vw, 16px); font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase;
}

#ui .pots-table {
  border-collapse: collapse; font-size: clamp(12px, 3.2vw, 17px);
  background: rgba(30,18,10,.6); border: 1px solid rgba(214,175,110,.4);
  border-radius: 10px; overflow: hidden;
}
#ui .pots-table td { padding: 5px 14px; text-align: left; }
#ui .pots-table td.v { text-align: right; color: #f7d089; font-weight: 700; }
#ui .pots-table tr.total td { border-top: 1px solid rgba(214,175,110,.45); font-size: 1.15em; }
#ui .pots-table tr.best td { color: #9fe0a0; }
#ui .pots-newbest { color: #ffe08a; font-weight: 800; letter-spacing: .14em; animation: pots-pulse 1.1s ease-in-out infinite; }

/* --- touch controls ----------------------------------------------------- */
#ui .pots-touch { position: absolute; inset: 0; display: none; }
#ui .pots-touch.on { display: block; }
#ui .pots-zone {
  position: absolute; left: 0; bottom: 0;
  width: 50%; height: 60%;
  touch-action: none;
}
#ui .pots-stick {
  position: absolute;
  left: max(10px, env(safe-area-inset-left));
  bottom: max(12px, env(safe-area-inset-bottom));
  width: 120px; height: 120px; border-radius: 50%;
  background: radial-gradient(circle at 50% 42%, rgba(48,29,16,.5), rgba(22,13,7,.62));
  border: 2px solid rgba(216,177,112,.45);
  box-shadow: inset 0 2px 8px rgba(0,0,0,.5);
  opacity: .35; transition: opacity .18s ease;
  pointer-events: none;
}
#ui .pots-stick.active { opacity: .92; transition: none; }
#ui .pots-nub {
  position: absolute; left: 50%; top: 50%;
  width: 54px; height: 54px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, rgba(112,74,41,.95), rgba(48,29,16,.95));
  border: 2px solid rgba(216,177,112,.6);
  box-shadow: 0 3px 0 rgba(0,0,0,.45), inset 0 1px 0 rgba(255,231,181,.2);
  transform: translate(-50%, -50%);
}
#ui .pots-act {
  position: absolute;
  right: max(10px, env(safe-area-inset-right));
  bottom: max(12px, env(safe-area-inset-bottom));
  display: flex; align-items: flex-end; gap: 10px;
}
#ui .pots-btn {
  -webkit-user-select: none; user-select: none; touch-action: none;
  display: flex; align-items: center; justify-content: center;
  font-family: inherit; font-weight: 700; letter-spacing: .08em;
  color: #f7e6c4;
  background: radial-gradient(circle at 35% 30%, rgba(112,74,41,.92), rgba(48,29,16,.9));
  border: 2px solid rgba(216,177,112,.6);
  box-shadow: 0 3px 0 rgba(0,0,0,.45), inset 0 1px 0 rgba(255,231,181,.2);
  border-radius: 50%;
  width: 58px; height: 58px; font-size: 22px;
}
#ui .pots-btn.wide { border-radius: 40px; }
#ui .pots-btn.swing { width: 70px; height: 70px; font-size: 13px;
  background: radial-gradient(circle at 35% 30%, rgba(58,120,148,.95), rgba(16,52,72,.92));
  border-color: rgba(150,215,240,.65); }
#ui .pots-btn.throw { width: 96px; height: 96px; font-size: 15px;
  background: radial-gradient(circle at 35% 30%, rgba(150,86,40,.95), rgba(78,38,14,.92));
  border-color: rgba(240,180,110,.6); }
#ui .pots-btn.pressed { filter: brightness(1.45); box-shadow: 0 1px 0 rgba(0,0,0,.45) inset; }

#ui .pots-mute {
  position: absolute;
  top: max(8px, env(safe-area-inset-top));
  right: max(8px, env(safe-area-inset-right));
  width: 40px; height: 40px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(41,25,14,.82);
  border: 1px solid rgba(214,175,110,.5);
  color: #f6e3bd; cursor: pointer;
}
#ui .pots-mute svg { width: 20px; height: 20px; display: block; }
@media (max-height: 430px) {
  #ui .pots-hint { display: none; }
  #ui .pots-card { width: clamp(92px, 20vw, 130px); }
}
`;

// ---------------------------------------------------------------------------
// Small SVG helpers

function heartSvg(filled: boolean): string {
  const fill = filled ? '#d8453a' : '#4a4a48';
  const edge = filled ? '#7d1f1a' : '#2a2a29';
  return `<svg viewBox="0 0 26 24" class="${filled ? '' : 'gone'}" aria-hidden="true">
    <path d="M13 22C7 17.6 2 13.9 2 9.2 2 5.8 4.6 3.4 7.7 3.4c1.9 0 3.8 1 5.3 2.9
      1.5-1.9 3.4-2.9 5.3-2.9C21.4 3.4 24 5.8 24 9.2 24 13.9 19 17.6 13 22z"
      fill="${fill}" stroke="${edge}" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
}

function toolIcon(kind: HeldKind): string {
  switch (kind) {
    case 'hammer':
      return `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="14" height="6" rx="1.5" fill="#9aa3ab" stroke="#4b555e" stroke-width="1.2"/><rect x="9.5" y="9" width="3.2" height="12" rx="1.2" fill="#a9703c" stroke="#5c3a1a" stroke-width="1.1"/></svg>`;
    case 'chainsaw':
      return `<svg viewBox="0 0 24 24"><rect x="2" y="9" width="9" height="7" rx="2" fill="#d8562f" stroke="#6c2410" stroke-width="1.2"/><path d="M11 10.5h11l-1.4 4H11z" fill="#b9c2c9" stroke="#4b555e" stroke-width="1"/><path d="M12 10.5l1 1.6 1.4-1.6 1 1.6 1.4-1.6 1 1.6 1.4-1.6" fill="none" stroke="#4b555e" stroke-width="1"/></svg>`;
    case 'magnet':
      return `<svg viewBox="0 0 24 24"><path d="M6 20V11a6 6 0 0 1 12 0v9h-4v-9a2 2 0 0 0-4 0v9z" fill="#c8393a" stroke="#5e1618" stroke-width="1.2"/><rect x="6" y="17" width="4" height="3.4" fill="#d8dde1" stroke="#4b555e" stroke-width="1"/><rect x="14" y="17" width="4" height="3.4" fill="#d8dde1" stroke="#4b555e" stroke-width="1"/></svg>`;
    case 'wrench':
      return `<svg viewBox="0 0 24 24"><path d="M15.5 3a6 6 0 0 0-5.3 8.8L3 19l2.4 2.4 7.2-7.2A6 6 0 0 0 21 8.4l-3.3 3.3-2.4-2.4L18.6 6A6 6 0 0 0 15.5 3z" fill="#aab3ba" stroke="#4b555e" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
    case 'log':
      return `<svg viewBox="0 0 24 24"><rect x="2" y="8" width="20" height="8" rx="4" fill="#8a5a2c" stroke="#4d2f12" stroke-width="1.2"/><ellipse cx="20" cy="12" rx="2.6" ry="4" fill="#c99a5e" stroke="#4d2f12" stroke-width="1.1"/></svg>`;
    case 'cannonball':
      return `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" fill="#2f3338" stroke="#0f1214" stroke-width="1.3"/><circle cx="9" cy="10" r="2.2" fill="rgba(255,255,255,.28)"/></svg>`;
  }
}

const TOOL_NAME: Record<HeldKind, string> = {
  hammer: 'Boomerang Hammer',
  chainsaw: 'Chainsaw',
  magnet: 'Giant Magnet',
  wrench: 'Wrench',
  log: 'Felled Tree',
  cannonball: 'Caught Cannonball',
};

function characterSvg(kind: CharacterKind): string {
  const hair = kind === 'boy' ? '#5b3a1d' : '#7a4a1f';
  const shirt = kind === 'boy' ? '#3f7ea8' : '#c15a86';
  const skin = '#f0c9a4';
  const shade = '#d9a97f';
  const ponytail =
    kind === 'girl'
      ? `<path d="M74 34c9 2 13 12 11 22-1 7-5 12-9 13 4-9 4-19-2-27z" fill="${hair}" stroke="#4a2c10" stroke-width="1.6" stroke-linejoin="round"/>`
      : '';
  const hairTop =
    kind === 'boy'
      ? `<path d="M28 38c0-13 10-22 22-22s22 9 22 22c0 2-1 4-2 5-2-6-8-9-14-9-8 0-13 3-17 8-4 2-8 0-11-4z" fill="${hair}" stroke="#3f2510" stroke-width="1.8" stroke-linejoin="round"/>`
      : `<path d="M27 42c0-15 10-26 23-26s23 11 23 26c0 3-1 5-2 6-1-9-4-14-9-16-6 3-16 4-24 1-5 2-8 5-9 12-1-1-2-2-2-3z" fill="${hair}" stroke="#3f2510" stroke-width="1.8" stroke-linejoin="round"/>`;
  return `<svg viewBox="0 0 100 108" aria-hidden="true">
    <ellipse cx="50" cy="100" rx="34" ry="7" fill="rgba(70,45,20,.16)"/>
    ${ponytail}
    <path d="M26 78c3-12 11-18 24-18s21 6 24 18l2 16H24z" fill="${shirt}" stroke="#2b2118" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M40 60h20l-2 8h-16z" fill="${shade}"/>
    <ellipse cx="50" cy="44" rx="22" ry="23" fill="${skin}" stroke="#8d5c34" stroke-width="1.8"/>
    ${hairTop}
    <circle cx="42" cy="46" r="2.7" fill="#2c1d10"/>
    <circle cx="58" cy="46" r="2.7" fill="#2c1d10"/>
    <circle cx="35" cy="53" r="3.6" fill="#e8927f" opacity=".55"/>
    <circle cx="65" cy="53" r="3.6" fill="#e8927f" opacity=".55"/>
    <path d="M43 55c2 3.4 5 5 7 5s5-1.6 7-5" fill="none" stroke="#8d4a2c" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;
}

function speakerSvg(muted: boolean): string {
  const wave = muted
    ? `<path d="M14.5 8.5l5 5M19.5 8.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`
    : `<path d="M14.2 8.4a5 5 0 0 1 0 5.2M16.6 6.5a8.4 8.4 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 22 22" aria-hidden="true">
    <path d="M3 8.5h3.2L11 4.6v12.8L6.2 13.5H3z" fill="currentColor"/>
    ${wave}
  </svg>`;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------

export function createUi(ctx: GameCtx): UiApi {
  const root = document.getElementById('ui')!;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'pots';
  root.appendChild(wrap);

  let pending: CharacterKind | null = null;

  // --- character cards -----------------------------------------------------

  interface CardRow {
    el: HTMLDivElement;
    highlight(current: CharacterKind): void;
  }

  function makeCards(): CardRow {
    const el = document.createElement('div');
    el.className = 'pots-cards';
    const cards: Partial<Record<CharacterKind, HTMLDivElement>> = {};
    for (const kind of ['boy', 'girl'] as CharacterKind[]) {
      const card = document.createElement('div');
      card.className = 'pots-card clickable';
      card.setAttribute('role', 'button');
      card.innerHTML = `${characterSvg(kind)}<div class="name">${kind}</div>`;
      card.addEventListener('click', () => {
        pending = kind;
      });
      cards[kind] = card;
      el.appendChild(card);
    }
    return {
      el,
      highlight(current: CharacterKind) {
        for (const kind of ['boy', 'girl'] as CharacterKind[]) {
          cards[kind]!.classList.toggle('current', kind === current);
        }
      },
    };
  }

  function screenEl(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'pots-screen';
    wrap.appendChild(el);
    return el;
  }

  // --- title screen --------------------------------------------------------

  const titleScreen = screenEl();
  const titleCards = makeCards();
  const bestLine = document.createElement('div');
  bestLine.className = 'pots-best';
  {
    const h = document.createElement('div');
    h.className = 'pots-title';
    h.innerHTML = `<span class="small">PIRATES OF THE</span>SWINGSET`;
    const credit = document.createElement('div');
    credit.className = 'pots-credit';
    credit.innerHTML = `Designed by <b>Genevieve</b>`;
    const prompt = document.createElement('div');
    prompt.className = 'pots-prompt';
    prompt.textContent = 'Choose yer buccaneer';
    const hint = document.createElement('div');
    hint.className = 'pots-hint';
    hint.textContent =
      'Space / SWING = pump (press at each end of the swing for a PERFECT!) · Enter / THROW = throw from the swing — SUPER at the top · on the ground THROW taunts the pirates · arrows or stick = run & climb · ◀ ▶ at a treetop = zip line · M = mute';
    titleScreen.append(h, credit, bestLine, prompt, titleCards.el, hint);
  }

  // --- round won -----------------------------------------------------------

  const wonScreen = screenEl();
  const wonCards = makeCards();
  const wonSub = document.createElement('div');
  wonSub.className = 'pots-sub';
  {
    const banner = document.createElement('div');
    banner.className = 'pots-banner';
    banner.textContent = 'SHIP SUNK!';
    const prompt = document.createElement('div');
    prompt.className = 'pots-prompt';
    prompt.textContent = 'keep going as…';
    wonScreen.append(banner, wonSub, prompt, wonCards.el);
  }

  // --- game over -----------------------------------------------------------

  const overScreen = screenEl();
  const overCards = makeCards();
  const overTable = document.createElement('table');
  overTable.className = 'pots-table';
  const overNewBest = document.createElement('div');
  overNewBest.className = 'pots-newbest';
  overNewBest.textContent = 'NEW BEST!';
  overNewBest.style.display = 'none';
  {
    const banner = document.createElement('div');
    banner.className = 'pots-banner';
    banner.textContent = 'The pirates got ye…';
    banner.style.fontSize = 'clamp(20px, 6vw, 44px)';
    const prompt = document.createElement('div');
    prompt.className = 'pots-prompt';
    prompt.textContent = 'sail again as…';
    overScreen.append(banner, overNewBest, overTable, prompt, overCards.el);
  }

  /** Best score as it stood when this Run began — main.ts raises ctx.bestScore
   *  before the game-over screen is shown, so equality alone can't spot it. */
  let bestAtRunStart = 0;

  function fillScoreTable(): void {
    const s = ctx.score;
    const isBest = s.total > 0 && s.total > bestAtRunStart;
    overNewBest.style.display = isBest ? '' : 'none';
    const rows: Array<[string, string, string]> = [
      ['Cannon-fodder hits', String(s.hits), ''],
      ['Ships sunk', String(s.shipsSunk), ''],
      ['Time a-swinging', mmss(s.swingSeconds), ''],
      ['Perfect pumps', String(s.perfectPumps), ''],
      ['Cannonballs dodged', String(s.dodges), ''],
      ['Swingsets found', String(s.swingsetsFound), ''],
      ['Trees climbed', String(s.treesClimbed), ''],
      ['TOTAL', String(s.total), 'total'],
      ['Best', String(ctx.bestScore), 'best'],
    ];
    overTable.innerHTML = rows
      .map(
        ([k, v, cls]) =>
          `<tr class="${cls}"><td>${k}</td><td class="v">${v}</td></tr>`,
      )
      .join('');
  }

  // --- HUD -----------------------------------------------------------------

  const hud = document.createElement('div');
  hud.className = 'pots-hud hidden';
  wrap.appendChild(hud);

  const rowTop = document.createElement('div');
  rowTop.className = 'pots-row';
  const hearts = document.createElement('div');
  hearts.className = 'pots-hearts pots-plank';
  const heartEls: HTMLElement[] = [];
  for (let i = 0; i < HEARTS_MAX; i++) {
    const span = document.createElement('span');
    span.innerHTML = heartSvg(true);
    hearts.appendChild(span);
    heartEls.push(span);
  }
  const roundPlank = document.createElement('div');
  roundPlank.className = 'pots-plank';
  roundPlank.innerHTML = `<span class="lbl">Round</span><b>1</b>`;
  const roundVal = roundPlank.querySelector('b')!;

  const scorePlank = document.createElement('div');
  scorePlank.className = 'pots-plank';
  scorePlank.innerHTML = `<span class="lbl">Booty</span><b>0</b>`;
  const scoreVal = scorePlank.querySelector('b')!;

  rowTop.append(hearts, roundPlank, scorePlank);

  const rowShip = document.createElement('div');
  rowShip.className = 'pots-row';
  const hpWrap = document.createElement('div');
  hpWrap.className = 'pots-hpwrap pots-plank';
  hpWrap.innerHTML = `<span class="lbl">Pirate ship</span><div class="pots-hpbar"><div class="pots-hpfill"></div></div>`;
  const hpFill = hpWrap.querySelector('.pots-hpfill') as HTMLElement;
  const jam = document.createElement('div');
  jam.className = 'pots-plank pots-jam hidden';
  jam.textContent = 'CANNON JAMMED';
  rowShip.append(hpWrap, jam);

  const rowTool = document.createElement('div');
  rowTool.className = 'pots-row';
  const chip = document.createElement('div');
  chip.className = 'pots-plank pots-chip hidden';
  rowTool.append(chip);

  hud.append(rowTop, rowShip, rowTool);

  const msg = document.createElement('div');
  msg.className = 'pots-msg';
  wrap.appendChild(msg);

  const incoming = document.createElement('div');
  incoming.className = 'pots-incoming';
  incoming.textContent = 'INCOMING!';
  wrap.appendChild(incoming);

  const callout = document.createElement('div');
  callout.className = 'pots-callout';
  wrap.appendChild(callout);

  // Pump ring: track, the gold PERFECT zone straddling the top, and the fill
  // that sweeps clockwise from the top and reaches it at each end of the arc.
  const RING_R = 26;
  const RING_C = 2 * Math.PI * RING_R;
  const zoneFrac = PUMP_PERFECT_PHASE / Math.PI; // each side of the top
  const ring = document.createElement('div');
  ring.className = 'pots-ring';
  ring.innerHTML = `<svg viewBox="0 0 64 64">
    <circle class="core" cx="32" cy="32" r="21"/>
    <circle class="track" cx="32" cy="32" r="${RING_R}"/>
    <circle class="zone" cx="32" cy="32" r="${RING_R}"
      stroke-dasharray="${(2 * zoneFrac * RING_C).toFixed(2)} ${RING_C.toFixed(2)}"
      transform="rotate(${(-90 - zoneFrac * 360).toFixed(2)} 32 32)"/>
    <circle class="fill" cx="32" cy="32" r="${RING_R}"
      stroke-dasharray="0 ${RING_C.toFixed(2)}" transform="rotate(-90 32 32)"/>
  </svg><div class="tag"></div>`;
  wrap.appendChild(ring);
  const ringFill = ring.querySelector('.fill') as SVGCircleElement;
  const ringTag = ring.querySelector('.tag') as HTMLElement;

  const bubble = document.createElement('div');
  bubble.className = 'pots-bubble';
  wrap.appendChild(bubble);

  // --- mute button ---------------------------------------------------------

  const mute = document.createElement('div');
  mute.className = 'pots-mute clickable';
  mute.setAttribute('role', 'button');
  mute.setAttribute('aria-label', 'mute');
  mute.innerHTML = speakerSvg(false);
  mute.addEventListener('click', () => {
    ctx.audio.toggleMute();
    syncMute();
  });
  wrap.appendChild(mute);

  let mutedShown = false;
  function syncMute(): void {
    const m = ctx.audio ? ctx.audio.muted : false;
    if (m !== mutedShown) {
      mutedShown = m;
      mute.innerHTML = speakerSvg(m);
      mute.style.opacity = m ? '.6' : '1';
    }
  }

  // --- touch controls ------------------------------------------------------

  const touch = document.createElement('div');
  touch.className = 'pots-touch';
  wrap.appendChild(touch);

  /** Release every held touch button (screen changes, lost pointers). */
  const releaseHolds: Array<() => void> = [];

  function holdButton(
    label: string,
    extraClass: string,
    onDown: () => void,
    onUp: () => void,
  ): HTMLDivElement {
    const b = document.createElement('div');
    b.className = `pots-btn clickable ${extraClass}`;
    b.innerHTML = label;
    // Track the pointers actually pressing this button: a second finger
    // touching (or a stray pointerleave) must not release the first one.
    const active = new Set<number>();
    const release = (): void => {
      if (active.size === 0) return;
      active.clear();
      b.classList.remove('pressed');
      onUp();
    };
    const down = (e: PointerEvent): void => {
      e.preventDefault();
      active.add(e.pointerId);
      b.classList.add('pressed');
      onDown();
    };
    const up = (e: PointerEvent): void => {
      if (!active.has(e.pointerId)) return;
      e.preventDefault();
      active.delete(e.pointerId);
      if (active.size > 0) return;
      b.classList.remove('pressed');
      onUp();
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    releaseHolds.push(release);
    return b;
  }

  const input = ctx.input;

  // Floating virtual joystick in the lower-left zone. Digital 8-way for
  // direction: the stick vector maps onto the same left/right/up/down
  // booleans the keyboard sets. A direction is active when its normalized
  // component is >= COMP_ON, which gives cardinals 60° sectors and diagonals
  // 30°. Bail (swinging) and zip (Lookout) fire on a *fresh* left/right press
  // downstream, so entering a horizontal sector in those states takes a
  // deliberate tilt (ENTER_COMMIT). The tilt magnitude also sets
  // input.moveScale so a light touch walks and a full tilt runs.
  const STICK_BASE = 120; // ring diameter, matches .pots-stick CSS
  const STICK_R = 44; // px of nub travel
  const ENTER = 0.35; // magnitude (fraction of STICK_R) to press a direction
  const ENTER_COMMIT = 0.65; // ...for left/right while swinging / at Lookout
  const RELEASE = 0.25; // magnitude below which a held direction lets go
  const COMP_ON = 0.5; // normalized component to enter a sector
  const COMP_OFF = 0.4; // ...and to stay in it (hysteresis)
  const WALK_SCALE = 0.45; // slowest the stick goes (at ENTER magnitude)
  const RUN_AT = 0.85; // magnitude for full run speed

  const zone = document.createElement('div');
  zone.className = 'pots-zone clickable';
  const stick = document.createElement('div');
  stick.className = 'pots-stick';
  const nub = document.createElement('div');
  nub.className = 'pots-nub';
  stick.appendChild(nub);

  let stickPointer: number | null = null;
  let originX = 0;
  let originY = 0;

  function releaseStick(): void {
    if (stickPointer !== null && zone.hasPointerCapture(stickPointer)) {
      zone.releasePointerCapture(stickPointer);
    }
    stickPointer = null;
    stick.classList.remove('active');
    stick.style.left = '';
    stick.style.top = '';
    nub.style.transform = '';
    input.left = input.right = input.up = input.down = false;
    input.moveScale = 1;
  }

  function moveStick(e: PointerEvent): void {
    const dx = e.clientX - originX;
    const dy = e.clientY - originY;
    const len = Math.hypot(dx, dy);
    const nx = len > 0 ? dx / len : 0;
    const ny = len > 0 ? dy / len : 0;
    const reach = Math.min(len, STICK_R);
    nub.style.transform =
      `translate(calc(-50% + ${nx * reach}px), calc(-50% + ${ny * reach}px))`;

    const m = reach / STICK_R;
    input.moveScale = Math.min(1, Math.max(WALK_SCALE, (m - ENTER) / (RUN_AT - ENTER)));
    const p = ctx.player;
    const commit = p && (p.mode === 'swinging' || p.atLookout);
    const comps = { left: -nx, right: nx, up: -ny, down: ny };
    for (const dir of ['left', 'right', 'up', 'down'] as const) {
      const c = comps[dir];
      if (input[dir]) {
        if (m < RELEASE || c < COMP_OFF) input[dir] = false;
      } else {
        const horizontal = dir === 'left' || dir === 'right';
        const enter = commit && horizontal ? ENTER_COMMIT : ENTER;
        if (m >= enter && c >= COMP_ON) input[dir] = true;
      }
    }
  }

  zone.addEventListener('pointerdown', (e) => {
    if (stickPointer !== null) return;
    e.preventDefault();
    stickPointer = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    // Keep the ring fully on-screen; the clamped centre is the input origin
    // too, so the visual and the vector always agree.
    const half = STICK_BASE / 2;
    originX = Math.min(Math.max(e.clientX, half), window.innerWidth - half);
    originY = Math.min(Math.max(e.clientY, half), window.innerHeight - half);
    stick.classList.add('active');
    stick.style.left = `${originX - half}px`;
    stick.style.top = `${originY - half}px`;
    moveStick(e);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer) return;
    e.preventDefault();
    moveStick(e);
  });
  const endStick = (e: PointerEvent): void => {
    if (e.pointerId !== stickPointer) return;
    e.preventDefault();
    releaseStick();
  };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);
  releaseHolds.push(releaseStick);
  // Directions are also force-cleared on blur (input.ts): drop the stick too.
  window.addEventListener('blur', releaseStick);

  const act = document.createElement('div');
  act.className = 'pots-act';
  act.append(
    holdButton('SWING', 'swing', () => (input.pumpPressed = true), () => {}),
    holdButton('THROW', 'throw', () => (input.throwPressed = true), () => {}),
  );
  touch.append(zone, stick, act);

  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    touch.classList.add('on');
  }

  // Any pointer press counts as the gesture that unlocks audio.
  window.addEventListener(
    'pointerdown',
    () => {
      if (ctx.audio) ctx.audio.userGesture();
    },
    { capture: true, passive: true },
  );

  // --- events --------------------------------------------------------------

  let msgTimer = 0;
  ctx.events.on('message', (e) => {
    msg.textContent = e.text;
    msg.classList.add('show');
    msgTimer = 2.5;
  });

  let incomingTimer = 0;
  ctx.events.on('cannonFire', () => {
    if (ctx.screen !== 'playing') return;
    incoming.classList.add('show');
    incomingTimer = 0.6;
  });

  let calloutTimer = 0;
  ctx.events.on('callout', (e) => {
    if (ctx.screen !== 'playing') return;
    callout.className = 'pots-callout';
    void callout.offsetWidth; // restart the pop
    callout.textContent = e.text;
    callout.classList.add(e.kind, 'show');
    calloutTimer = 1.15;
  });

  let ringHitTimer = 0;
  let ringTagTimer = 0;
  ctx.events.on('pumped', (e) => {
    if (e.quality === 'weak') return;
    ringHitTimer = 0.3;
    ring.classList.remove('hit');
    void ring.offsetWidth;
    ring.classList.add('hit');
    ringTag.className = 'tag show ' + (e.quality === 'good' ? 'good' : '');
    ringTag.textContent = e.quality === 'good' ? 'good' : e.quality === 'kickoff' ? 'GO!' : 'PERFECT!';
    ringTagTimer = 0.7;
  });

  let bubbleTimer = 0;
  ctx.events.on('taunted', (e) => {
    bubble.textContent = e.line;
    bubble.classList.add('show');
    bubbleTimer = 1.8;
  });

  /** World point → CSS pixels; false when behind the camera. */
  const projScratch = new THREE.Vector3();
  function placeAt(el: HTMLElement, x: number, y: number, z: number): boolean {
    projScratch.set(x, y, z).project(ctx.camera);
    if (projScratch.z > 1) return false;
    const px = (projScratch.x * 0.5 + 0.5) * window.innerWidth;
    const py = (0.5 - projScratch.y * 0.5) * window.innerHeight;
    el.style.left = `${px.toFixed(1)}px`;
    el.style.top = `${py.toFixed(1)}px`;
    return true;
  }

  let shakeTimer = 0;
  ctx.events.on('screenShake', () => {
    hud.classList.remove('shake');
    // Force reflow so the animation restarts.
    void hud.offsetWidth;
    hud.classList.add('shake');
    shakeTimer = 0.4;
  });

  // --- screen switching ----------------------------------------------------

  function setScreen(s: Screen): void {
    titleScreen.classList.toggle('show', s === 'title');
    wonScreen.classList.toggle('show', s === 'roundWon');
    overScreen.classList.toggle('show', s === 'gameOver');
    hud.classList.toggle('hidden', s !== 'playing');
    if (s === 'title') {
      bestLine.textContent = ctx.bestScore > 0 ? `Best plunder: ${ctx.bestScore}` : '';
      titleCards.highlight(ctx.character);
    } else if (s === 'roundWon') {
      const next = ctx.round + 1;
      wonSub.textContent = `Round ${next} ahoy — a bigger ship approaches…`;
      wonCards.highlight(ctx.character);
    } else if (s === 'gameOver') {
      fillScoreTable();
      overCards.highlight(ctx.character);
    }
    // Touch controls only get in the way on menus.
    touch.style.visibility = s === 'playing' ? 'visible' : 'hidden';
    // A finger on a hidden button never gets its pointerup: let go of them all.
    for (const release of releaseHolds) release();
    if (s === 'playing') {
      // Drop any card click queued after the run/round already started.
      pending = null;
      // ctx.bestScore only moves in endRun(), so this is the pre-Run best.
      bestAtRunStart = ctx.bestScore;
    } else {
      input.left = input.right = input.up = input.down = false;
      msg.classList.remove('show');
      msgTimer = 0;
      incoming.classList.remove('show');
      incomingTimer = 0;
      callout.classList.remove('show');
      ring.classList.remove('show');
      bubble.classList.remove('show');
      bubbleTimer = 0;
    }
  }

  // --- per-frame -----------------------------------------------------------

  let lastHearts = -1;
  let lastRound = -1;
  let lastScore = -1;
  let lastHeld: HeldKind | null | undefined;
  let lastCharged: boolean | undefined;
  let lastHpSunk: boolean | undefined;
  let lastHpWidth = '';
  let lastJamText = '';

  function update(dt: number): void {
    syncMute();

    if (msgTimer > 0) {
      msgTimer -= dt;
      if (msgTimer <= 0) msg.classList.remove('show');
    }
    if (incomingTimer > 0) {
      incomingTimer -= dt;
      if (incomingTimer <= 0) incoming.classList.remove('show');
    }
    if (shakeTimer > 0) {
      shakeTimer -= dt;
      if (shakeTimer <= 0) hud.classList.remove('shake');
    }
    if (calloutTimer > 0) {
      calloutTimer -= dt;
      if (calloutTimer <= 0) callout.classList.remove('show');
    }
    if (ringHitTimer > 0) {
      ringHitTimer -= dt;
      if (ringHitTimer <= 0) ring.classList.remove('hit');
    }
    if (ringTagTimer > 0) {
      ringTagTimer -= dt;
      if (ringTagTimer <= 0) ringTag.classList.remove('show');
    }
    if (bubbleTimer > 0) {
      bubbleTimer -= dt;
      if (bubbleTimer <= 0) bubble.classList.remove('show');
    }

    if (ctx.screen !== 'playing') return;

    updateRing();
    if (bubbleTimer > 0) {
      const p = ctx.player.position;
      if (!placeAt(bubble, p.x, p.y + 1.55, p.z)) bubble.classList.remove('show');
    }

    if (ctx.hearts !== lastHearts) {
      lastHearts = ctx.hearts;
      for (let i = 0; i < heartEls.length; i++) {
        heartEls[i].innerHTML = heartSvg(i < ctx.hearts);
      }
    }
    if (ctx.round !== lastRound) {
      lastRound = ctx.round;
      roundVal.textContent = String(ctx.round);
    }
    if (ctx.score.total !== lastScore) {
      lastScore = ctx.score.total;
      scoreVal.textContent = String(ctx.score.total);
    }

    const ship = ctx.ship;
    if (ship) {
      const sunk = ship.sunk || ship.maxHp <= 0;
      if (sunk !== lastHpSunk) {
        lastHpSunk = sunk;
        hpWrap.classList.toggle('hidden', sunk);
      }
      if (!sunk) {
        const pct = Math.max(0, Math.min(1, ship.hp / ship.maxHp));
        const w = `${(pct * 100).toFixed(1)}%`;
        if (w !== lastHpWidth) {
          lastHpWidth = w;
          hpFill.style.width = w;
        }
      }
      const jamText = ship.jammedFor > 0
        ? `CANNON JAMMED ${ship.jammedFor.toFixed(1)}s`
        : '';
      if (jamText !== lastJamText) {
        if ((jamText === '') !== (lastJamText === '')) {
          jam.classList.toggle('hidden', jamText === '');
        }
        lastJamText = jamText;
        if (jamText) jam.textContent = jamText;
      }
    }

    const held = ctx.tools ? ctx.tools.held : null;
    const charged = ctx.superCharged && held !== null && held !== 'chainsaw' && held !== 'magnet';
    if (held !== lastHeld || charged !== lastCharged) {
      lastHeld = held;
      lastCharged = charged;
      chip.classList.toggle('hidden', held === null);
      chip.classList.toggle('magnetball', held === 'cannonball');
      chip.classList.toggle('charged', charged);
      if (held) {
        chip.innerHTML = `${toolIcon(held)}<span><span class="lbl">${
          held === 'cannonball' ? 'Magnet caught' : 'Carrying'
        }</span><b>${TOOL_NAME[held]}</b>${
          charged ? '<span class="super"> ⚡ SUPER READY</span>' : ''
        }</span>`;
      }
    }
  }

  /** The pump ring rides above the kid while swinging; its fill shows the
   *  beat, its core glows when a throw right now would be SUPER. */
  let lastRingShown = false;
  function updateRing(): void {
    const p = ctx.player;
    const swing = p.ridingSwing;
    const show = p.mode === 'swinging' && !!swing && !swing.broken;
    if (show !== lastRingShown) {
      lastRingShown = show;
      ring.classList.toggle('show', show);
    }
    if (!show || !swing) return;
    const pos = p.position;
    if (!placeAt(ring, pos.x, pos.y + 1.9, pos.z)) {
      ring.classList.remove('show');
      lastRingShown = false;
      return;
    }
    const r = swing.pumpReadiness();
    ringFill.setAttribute('stroke-dasharray', `${(r * RING_C).toFixed(2)} ${RING_C.toFixed(2)}`);
    const held = ctx.tools.held;
    const throwable = held !== null && held !== 'chainsaw' && held !== 'magnet';
    // A banked Dodge shows even empty-handed (go grab a Tool!); the
    // top-of-the-swing window only matters with something to throw.
    const charged = ctx.superCharged;
    const superNow = charged || (throwable && ctx.throwPower === 'super');
    ring.classList.toggle('super', superNow && !charged);
    ring.classList.toggle('charged', charged);
    if (superNow && ringTagTimer <= 0) {
      // The SUPER window is open: say so under the ring (PERFECT! wins).
      ringTag.className = 'tag show ' + (charged ? 'charged' : 'super');
      ringTag.textContent = charged ? 'SUPER READY' : 'SUPER!';
    } else if (!superNow && ringTagTimer <= 0 && ringTag.classList.contains('show')) {
      ringTag.classList.remove('show');
    }
  }

  return {
    setScreen,
    consumeStartRequest() {
      const p = pending;
      pending = null;
      return p;
    },
    update,
  };
}
