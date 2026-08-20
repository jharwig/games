// game state machine, physics, rendering, input, main loop
import { W, H, ctx, canvas, px, makeLayer, type Layer } from './gfx';
import { P } from './palette';
import {
  GROUND_Y, GRAVITY, FLAP, MAX_FALL, SPEED_BASE, SPEED_STEP, SPEED_MAX,
  GAP_H, SPACING, GAP_MIN, GAP_MAX, PLAYER_X, HIT_INSET, DEAD_LOCK,
} from './constants';
import { scrollWorld, resetScroll, drawBackdrop, drawGroundStrip } from './background';
import { drawText, drawTextLeft } from './font';
import {
  audio, initAudio, applyMute, startMusic, stopMusic, pumpMusic, sfxExplosion, sfxMilestone,
} from './audio';
import { COL_W, drawColumn, type Column } from './blocks';
import { S, wallet, runCoins, resetRunCoins, equipAnim } from './cosmetics';
import { drawHero } from './hero';
import { particles, updateParticles, drawParticles, explodeHero, explodeNearbyBlocks } from './particles';
import { resetCoins, spawnCoins, updateCoins, drawCoins, drawCoinAt } from './coins';
import { speedMult, resetPickups, spawnPickup, updatePickups, drawPickups } from './pickups';
import { resetTrail, emitTrail, updateTrail, drawTrail } from './trail';
import {
  drawShop, tickShop, drawButton, inRect, resetShopScroll,
  shopPointerDown, shopPointerMove, shopPointerUp, shopWheel,
  TITLE_SHOP_BTN, DEAD_SHOP_BTN, type Point,
} from './shop';

const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;

// =========================================================================
// game state
// =========================================================================
const TITLE = 0, PLAYING = 1, DEAD = 2, PAUSED = 3, SHOP = 4;

let state = TITLE;
let score = 0;
let best = 0;
let newBest = false;
try {
  best = parseInt(localStorage.getItem('block.highScore') || '', 10) || 0;
} catch {
  best = 0;
}

const player = { y: 0, vy: 0, tilt: 0 };
const columns: Column[] = [];
let speed = SPEED_BASE;
let clock = 0; // total elapsed seconds
let deadTime = 0;
let flash = 0;
let heroAlive = true;

// impact effects
const SHAKE_DUR = 0.55; // s of camera shake
const SHAKE_AMP = 5; // px at peak
const AB_DUR = 0.42; // s of chromatic aberration
const AB_MAX = 3; // px of RGB split at peak
let shakeT = 0, shakeX = 0, shakeY = 0;
let abT = 0;

// clears the columns (and with them the destroyed/damaged block maps) plus
// all coins, debris and impact effects, so a replay always starts clean
function resetScene(): void {
  columns.length = 0;
  resetCoins();
  resetPickups();
  resetTrail();
  particles.length = 0;
  resetScroll();
  speed = SPEED_BASE;
  heroAlive = true;
  shakeT = 0;
  shakeX = 0;
  shakeY = 0;
  abT = 0;
}

function startGame(): void {
  state = PLAYING;
  score = 0;
  resetRunCoins();
  newBest = false;
  deadTime = 0;
  flash = 0;
  resetScene();
  player.y = H * 0.38;
  player.vy = FLAP * 0.6;
  player.tilt = 0;
  spawnColumn(W + 20);
  startMusic();
  setPauseButtonVisible(true);
}

function toTitle(): void {
  state = TITLE;
  resetScene();
  player.y = 148;
  player.vy = 0;
  player.tilt = 0;
  stopMusic();
  setPauseButtonVisible(false);
}

function enterShop(): void {
  state = SHOP;
  resetShopScroll();
  stopMusic();
  setPauseButtonVisible(false);
}

function exitShop(): void {
  toTitle();
}

// =========================================================================
// pause
// =========================================================================
function setPauseButtonVisible(v: boolean): void {
  pauseBtn.classList.toggle('visible', v);
}

function pauseGame(): void {
  if (state !== PLAYING) return;
  state = PAUSED;
  if (audio.ctx && audio.ctx.state === 'running') audio.ctx.suspend();
}

function resumeGame(): void {
  if (state !== PAUSED) return;
  state = PLAYING;
  last = 0; // drop the accumulated real-time gap so no physics leap occurs
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
}

function togglePause(): void {
  if (state === PLAYING) pauseGame();
  else if (state === PAUSED) resumeGame();
}

function spawnColumn(x: number): void {
  const gapTop = Math.round(GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN));
  columns.push({
    x,
    gapTop,
    seed: Math.floor(Math.random() * 6),
    scored: false,
  });
  const coin = spawnCoins(x, gapTop);
  spawnPickup(x, gapTop, coin);
}

function currentSpeed(): number {
  return Math.min(SPEED_MAX, SPEED_BASE + Math.floor(score / 5) * SPEED_STEP);
}

function flap(): void {
  player.vy = FLAP;
}

// =========================================================================
// death + collision
// =========================================================================
function die(hit: { col: Column | null }): void {
  state = DEAD;
  deadTime = 0;
  flash = 0.16;
  heroAlive = false;
  shakeT = SHAKE_DUR;
  abT = AB_DUR;
  stopMusic();
  setPauseButtonVisible(false);
  sfxExplosion();
  if (navigator.vibrate) {
    navigator.vibrate([90, 40, 60]);
  } else {
    // iOS Safari has no vibrate API; toggling a switch checkbox gives a haptic tap on iOS 17.4+
    const haptic = document.getElementById('haptic');
    if (haptic) haptic.click();
  }

  const ox = PLAYER_X + S / 2, oy = player.y + S / 2;
  explodeHero(PLAYER_X, player.y);
  explodeNearbyBlocks(hit.col, ox, oy);

  if (score > best) {
    best = score;
    newBest = true;
    try {
      localStorage.setItem('block.highScore', String(best));
    } catch {
      /* private mode */
    }
  }
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// returns null, or { col: <column hit, or null for the ground> }
function checkCollision(): { col: Column | null } | null {
  const hx = PLAYER_X + HIT_INSET;
  const hy = player.y + HIT_INSET;
  const hw = S - HIT_INSET * 2;
  const hh = S - HIT_INSET * 2;

  if (hy + hh >= GROUND_Y) return { col: null };

  for (const c of columns) {
    if (c.x > hx + hw || c.x + COL_W < hx) continue;
    if (rectsOverlap(hx, hy, hw, hh, c.x, -H, COL_W, H + c.gapTop)) return { col: c };
    const bottomY = c.gapTop + GAP_H;
    if (rectsOverlap(hx, hy, hw, hh, c.x, bottomY, COL_W, GROUND_Y - bottomY)) return { col: c };
  }
  return null;
}

// =========================================================================
// update (fixed timestep)
// =========================================================================
const DT = 1 / 120;

function step(dt: number): void {
  clock += dt;
  // all inside the fixed timestep, so 60Hz == 120Hz
  updateParticles(dt);
  updateTrail(dt);
  updateImpactFx(dt);

  if (state === TITLE) {
    speed = SPEED_BASE;
    scrollWorld(dt, speed);
    player.y = 148 + Math.sin(clock * 2.4) * 3;
    player.tilt = Math.sin(clock * 2.4 + 1.6) * 0.05;
    if (equipAnim === 'sparkle') emitTrail(dt, PLAYER_X, player.y, speed, clock);
    return;
  }

  if (state === SHOP) {
    scrollWorld(dt, SPEED_BASE);
    tickShop(dt);
    return;
  }

  if (state === PLAYING) {
    // mystery pickups re-roll speedMult; it sticks until the next one
    speed = currentSpeed() * speedMult;
    scrollWorld(dt, speed);

    player.vy += GRAVITY * dt;
    if (player.vy > MAX_FALL) player.vy = MAX_FALL;
    player.y += player.vy * dt;

    // ceiling clamp - no death at the top
    if (player.y < 0) {
      player.y = 0;
      if (player.vy < 0) player.vy = 0;
    }

    const target = Math.max(-1, Math.min(1, player.vy / MAX_FALL)) * 0.24;
    player.tilt += (target - player.tilt) * Math.min(1, dt * 12);

    // move / spawn / score columns
    for (const c of columns) {
      c.x -= speed * dt;
      if (!c.scored && c.x + COL_W < PLAYER_X) {
        c.scored = true;
        score++;
        if (score % 10 === 0) sfxMilestone();
      }
    }
    while (columns.length && columns[0].x + COL_W < -4) columns.shift();

    const lastCol = columns[columns.length - 1];
    if (!lastCol || lastCol.x <= W - SPACING) {
      spawnColumn(lastCol ? lastCol.x + SPACING : W + 20);
    }

    // coins drift with the towers and bank the moment they are touched
    updateCoins(dt, speed, player.y, clock);
    updatePickups(dt, speed, player.y, clock);
    if (equipAnim === 'sparkle') emitTrail(dt, PLAYER_X, player.y, speed, clock);

    const hit = checkCollision();
    if (hit) die(hit);
    return;
  }

  // DEAD - the cube is gone, the debris carries the animation
  deadTime += dt;
  if (flash > 0) flash -= dt;
}

// decaying camera shake + RGB split, advanced on the fixed timestep
function updateImpactFx(dt: number): void {
  if (shakeT > 0) {
    shakeT -= dt;
    if (shakeT <= 0) {
      shakeT = 0;
      shakeX = 0;
      shakeY = 0;
    } else {
      const amp = SHAKE_AMP * (shakeT / SHAKE_DUR);
      shakeX = Math.round((Math.random() * 2 - 1) * amp);
      shakeY = Math.round((Math.random() * 2 - 1) * amp);
    }
  }
  if (abT > 0) {
    abT -= dt;
    if (abT < 0) abT = 0;
  }
}

// =========================================================================
// render
// =========================================================================
function drawSpeaker(): void {
  const x = W - 12, y = H - 12;
  px(x, y + 2, 2, 3, '#8f95ad');
  px(x + 2, y, 2, 7, '#8f95ad');
  if (audio.muted) {
    px(x + 5, y + 1, 1, 1, '#c86060');
    px(x + 6, y + 2, 1, 1, '#c86060');
    px(x + 7, y + 3, 1, 1, '#c86060');
    px(x + 7, y + 1, 1, 1, '#c86060');
    px(x + 6, y + 2, 1, 1, '#c86060');
    px(x + 5, y + 3, 1, 1, '#c86060');
    px(x + 5, y + 4, 1, 1, '#c86060');
    px(x + 6, y + 5, 1, 1, '#c86060');
    px(x + 7, y + 5, 1, 1, '#c86060');
  } else {
    px(x + 5, y + 1, 1, 5, '#8f95ad');
    px(x + 7, y, 1, 7, '#5f6479');
  }
}

// RGB split: rebuild the frame from a red copy and a cyan copy pushed
// apart by a few whole pixels. Red + cyan sums back to the original where
// they line up, so only the edges fringe and nothing washes out.
let SNAP: Layer | null = null;
let TINT: Layer | null = null;

function applyAberration(): void {
  if (abT <= 0) return;
  const dx = Math.round((abT / AB_DUR) * AB_MAX);
  if (dx <= 0) return;
  if (!SNAP) {
    SNAP = makeLayer(W, H);
    TINT = makeLayer(W, H);
  }
  const sc = SNAP.ctx, tc = TINT!.ctx;

  sc.clearRect(0, 0, W, H);
  sc.drawImage(canvas, 0, 0);

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';

  const channels = ['#ff0000', '#00ffff'];
  for (let i = 0; i < 2; i++) {
    tc.globalCompositeOperation = 'source-over';
    tc.clearRect(0, 0, W, H);
    tc.drawImage(SNAP.canvas, 0, 0);
    tc.globalCompositeOperation = 'multiply';
    tc.fillStyle = channels[i];
    tc.fillRect(0, 0, W, H);
    tc.globalCompositeOperation = 'source-over';
    ctx.drawImage(TINT!.canvas, i === 0 ? dx : -dx, 0);
  }

  ctx.globalCompositeOperation = 'source-over';
}

const vignette = (() => {
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  return vg;
})();

function render(): void {
  const shaking = shakeX !== 0 || shakeY !== 0;
  if (shaking) {
    // the jolt exposes the canvas edge, so lay down the sky colour first
    px(0, 0, W, H, P.skyTop);
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }

  // background
  drawBackdrop();

  // obstacles
  for (const c of columns) drawColumn(c);

  // ground on top of column feet
  drawGroundStrip();

  // coins and mystery pickups float in the play space
  drawCoins(clock);
  drawPickups(clock);

  // sparkle trail behind the player
  drawTrail(clock);

  // player
  if (heroAlive) {
    const propFrame = Math.floor(clock / 0.055) % 2;
    drawHero(PLAYER_X, player.y, player.tilt, propFrame);
  }

  // debris on top of the scene
  drawParticles(clock);

  // vignette
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  if (shaking) ctx.restore();

  // RGB fringing on the scene, before the HUD goes on top
  applyAberration();

  // HUD / screens
  const blink = Math.floor(clock * 1.6) % 2 === 0;

  // wallet, always visible (the shop draws its own)
  if (state !== SHOP) {
    drawCoinAt(5, 6, 2);
    drawTextLeft(String(wallet), 16, 7, 1, '#ffd166', P.hudShadow);
  }

  if (state === TITLE) {
    drawText('BLOCK', W / 2, 52, 5, P.hud, P.hudShadow);
    drawText('BEST ' + best, W / 2, 88, 1, '#9aa3c8', P.hudShadow);
    if (blink) drawText('TAP / CLICK / SPACE', W / 2, 104, 1, P.hud, P.hudShadow);
    if (blink) drawText('TO START', W / 2, 114, 1, P.hud, P.hudShadow);
    drawButton(TITLE_SHOP_BTN, 'SHOP');
  } else if (state === PLAYING) {
    drawText(String(score), W / 2, 14, 5, P.hud, P.hudShadow);
  } else if (state === PAUSED) {
    drawText(String(score), W / 2, 14, 5, P.hud, P.hudShadow);
    ctx.fillStyle = 'rgba(5,6,15,0.78)';
    ctx.fillRect(14, 108, W - 28, 72);
    px(14, 108, W - 28, 1, '#2a2f4c');
    px(14, 179, W - 28, 1, '#2a2f4c');
    px(14, 108, 1, 72, '#2a2f4c');
    px(W - 15, 108, 1, 72, '#2a2f4c');
    drawText('PAUSED', W / 2, 122, 3, P.hud, P.hudShadow);
    // clock is frozen while paused, so blink off real time instead
    if (Math.floor(performance.now() / 500) % 2 === 0) {
      drawText('TAP TO RESUME', W / 2, 156, 1, '#9aa3c8', P.hudShadow);
    }
  } else if (state === SHOP) {
    drawShop(clock);
  } else {
    drawText(String(score), W / 2, 14, 5, P.hud, P.hudShadow);
    if (deadTime >= DEAD_LOCK) {
      ctx.fillStyle = 'rgba(5,6,15,0.78)';
      ctx.fillRect(14, 68, W - 28, 132);
      px(14, 68, W - 28, 1, '#2a2f4c');
      px(14, 199, W - 28, 1, '#2a2f4c');
      px(14, 68, 1, 132, '#2a2f4c');
      px(W - 15, 68, 1, 132, '#2a2f4c');

      drawText('GAME OVER', W / 2, 76, 3, '#ff8c3b', P.hudShadow);
      drawText('SCORE', W / 2, 98, 1, '#9aa3c8', null);
      drawText(String(score), W / 2, 106, 3, P.hud, P.hudShadow);
      drawText('BEST', W / 2, 126, 1, '#9aa3c8', null);
      drawText(String(best), W / 2, 134, 3, P.hud, P.hudShadow);

      // coins banked this run
      const rtxt = '+' + runCoins;
      const rw = 10 + rtxt.length * 4 - 1;
      const rx = Math.round(W / 2 - rw / 2);
      drawCoinAt(rx, 152, 2);
      drawTextLeft(rtxt, rx + 10, 153, 1, '#ffd166', P.hudShadow);

      if (newBest && blink) drawText('NEW BEST!', W / 2, 163, 1, '#ffd166', P.hudShadow);
      drawButton(DEAD_SHOP_BTN, 'SHOP');
      if (blink) drawText('TAP TO PLAY AGAIN', W / 2, 190, 1, P.hud, P.hudShadow);
    }
  }

  drawSpeaker();

  if (flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + Math.max(0, Math.min(0.75, flash * 4)).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

// =========================================================================
// input
// =========================================================================
function pointFromEvent(e: MouseEvent | TouchEvent): Point | null {
  let t: { clientX?: number; clientY?: number };
  if ('touches' in e) {
    if (e.touches.length) t = e.touches[0];
    else if (e.changedTouches && e.changedTouches.length) t = e.changedTouches[0];
    else return null;
  } else {
    t = e;
  }
  if (t.clientX === undefined || t.clientY === undefined) return null;
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: ((t.clientX - r.left) * W) / r.width, y: ((t.clientY - r.top) * H) / r.height };
}

function onPress(p: Point | null): void {
  if (state === PAUSED) return;
  initAudio();
  if (state === SHOP) {
    // the shop scrolls, so a press only starts a drag; the tap is decided on release
    shopPointerDown(p);
    return;
  }
  if (state === TITLE) {
    if (inRect(p, TITLE_SHOP_BTN)) {
      enterShop();
      return;
    }
    startGame();
    flap();
  } else if (state === PLAYING) {
    flap();
  } else if (state === DEAD && deadTime >= DEAD_LOCK) {
    if (inRect(p, DEAD_SHOP_BTN)) {
      enterShop();
      return;
    }
    startGame();
    flap();
  }
}

function onMove(p: Point | null): void {
  if (state === SHOP) shopPointerMove(p);
}

function onRelease(p: Point | null): void {
  if (state === SHOP && shopPointerUp(p)) exitShop();
}

document.addEventListener('mousedown', (e) => {
  e.preventDefault();
  onPress(pointFromEvent(e));
});
document.addEventListener('mousemove', (e) => onMove(pointFromEvent(e)));
document.addEventListener('mouseup', (e) => onRelease(pointFromEvent(e)));
window.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    onPress(pointFromEvent(e));
  },
  { passive: false },
);
window.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    onMove(pointFromEvent(e));
  },
  { passive: false },
);
window.addEventListener('touchend', (e) => onRelease(pointFromEvent(e)));
window.addEventListener('touchcancel', (e) => onRelease(pointFromEvent(e)));
window.addEventListener(
  'wheel',
  (e) => {
    if (state !== SHOP) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const scale = r.height ? H / r.height : 1;
    shopWheel(e.deltaY * scale * 0.5);
  },
  { passive: false },
);

// pause button - stop the tap/click from also reaching the document
// handlers above and acting as game input
function onPauseBtn(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
  initAudio();
  togglePause();
}
pauseBtn.addEventListener('mousedown', onPauseBtn);
pauseBtn.addEventListener('touchstart', onPauseBtn, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (e.repeat) return;
    onPress(null);
    return;
  }
  if (e.key === 'm' || e.key === 'M') {
    audio.muted = !audio.muted;
    initAudio();
    applyMute();
    return;
  }
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    if (e.repeat) return;
    if (state === SHOP) {
      exitShop();
      return;
    }
    togglePause();
  }
});

// avoid a stuck loop / silent audio after a tab switch
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state !== PAUSED && audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  last = 0;
});

// =========================================================================
// main loop (fixed timestep, frame-rate independent)
// =========================================================================
let last = 0, acc = 0;

function frame(ts: number): void {
  if (state === PAUSED) {
    // keep resyncing so the eventual resume sees a normal, small dt
    // instead of one huge stall covering the whole paused span
    last = ts;
    acc = 0;
    render();
    requestAnimationFrame(frame);
    return;
  }
  if (!last) last = ts;
  let dt = (ts - last) / 1000;
  last = ts;
  if (dt > 0.25) dt = 0.25; // clamp after a stall
  acc += dt;
  let guard = 0;
  while (acc >= DT && guard++ < 240) {
    step(DT);
    acc -= DT;
  }
  pumpMusic();
  render();
  requestAnimationFrame(frame);
}

toTitle();
clock = 0;
requestAnimationFrame(frame);
