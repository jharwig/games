// pre-rendered parallax layers: sky, two skylines, ground strip
import { W, H, ctx, pxc, rng, makeLayer, type Layer } from './gfx';
import { P } from './palette';
import { GROUND_Y, FAR_BASE, NEAR_BASE } from './constants';

// ---- static sky: bands + stars + moon -------------------------------------
const SKY = makeLayer(W, H);
(function buildSky() {
  const c = SKY.ctx;
  pxc(c, 0, 0, W, H, P.skyTop);
  pxc(c, 0, 60, W, 70, P.skyMid);
  pxc(c, 0, 130, W, 70, P.skyLow);
  pxc(c, 0, 200, W, 40, P.skyHaze);
  pxc(c, 0, 56, W, 4, '#080a18');
  pxc(c, 0, 126, W, 4, '#101636');
  pxc(c, 0, 196, W, 4, '#1a2042');

  const r = rng(1337);
  for (let i = 0; i < 90; i++) {
    const sx = Math.floor(r() * W);
    const sy = Math.floor(r() * 205);
    const bright = r();
    if (sy > 150 && bright < 0.6) continue;
    if (bright > 0.85) {
      pxc(c, sx, sy, 1, 1, P.star);
      pxc(c, sx - 1, sy, 1, 1, P.starDim);
      pxc(c, sx + 1, sy, 1, 1, P.starDim);
      pxc(c, sx, sy - 1, 1, 1, P.starDim);
      pxc(c, sx, sy + 1, 1, 1, P.starDim);
    } else if (bright > 0.5) {
      pxc(c, sx, sy, 1, 1, P.star);
    } else {
      pxc(c, sx, sy, 1, 1, P.starDim);
    }
  }

  // moon
  const cx = 30, cy = 46, rad = 15;
  for (let y = -rad; y <= rad; y++) {
    for (let x = -rad; x <= rad; x++) {
      const d = x * x + y * y;
      if (d > rad * rad) continue;
      pxc(c, cx + x, cy + y, 1, 1, x + y > rad * 0.75 ? P.moonShade : P.moon);
    }
  }
  function crater(ox: number, oy: number, cr: number) {
    for (let yy = -cr; yy <= cr; yy++)
      for (let xx = -cr; xx <= cr; xx++)
        if (xx * xx + yy * yy <= cr * cr) pxc(c, cx + ox + xx, cy + oy + yy, 1, 1, P.moonCrater);
  }
  crater(-5, -4, 3);
  crater(4, 2, 4);
  crater(-3, 6, 2);
  crater(7, -6, 2);
  c.fillStyle = 'rgba(246,240,216,0.05)';
  for (let y2 = -rad - 3; y2 <= rad + 3; y2++)
    for (let x2 = -rad - 3; x2 <= rad + 3; x2++) {
      const dd = x2 * x2 + y2 * y2;
      if (dd > rad * rad && dd <= (rad + 3) * (rad + 3)) c.fillRect(cx + x2, cy + y2, 1, 1);
    }
})();

// ---- far skyline tile (transparent above the roofs) -----------------------
const TILE_W = 320;
const FAR = makeLayer(TILE_W, FAR_BASE + 1);
(function buildFar() {
  const c = FAR.ctx;
  const rf = rng(77);
  let x = 0;
  while (x < TILE_W) {
    const w = 10 + Math.floor(rf() * 14);
    if (x + w > TILE_W) break;
    const h = 16 + Math.floor(rf() * 34);
    const top = FAR_BASE - h;
    pxc(c, x, top, w, h, P.farBldg);
    if (rf() > 0.75) pxc(c, x + (w >> 1), top - 5, 1, 5, P.farBldg);
    for (let wy = top + 3; wy < FAR_BASE - 3; wy += 5) {
      for (let wx = x + 2; wx < x + w - 2; wx += 4) {
        if (rf() > 0.72) pxc(c, wx, wy, 1, 2, P.farWin);
      }
    }
    x += w + 1 + Math.floor(rf() * 3);
  }
})();

// ---- near skyline tile ----------------------------------------------------
const NEAR = makeLayer(TILE_W, NEAR_BASE + 1);
(function buildNear() {
  const c = NEAR.ctx;
  const rn = rng(2024);
  let x = 0;
  while (x < TILE_W) {
    const w = 14 + Math.floor(rn() * 18);
    if (x + w > TILE_W) break;
    const h = 22 + Math.floor(rn() * 30);
    const top = NEAR_BASE - h;
    pxc(c, x, top, w, h, P.nearBldg);
    pxc(c, x, top, w, 1, P.nearBldgTop);
    pxc(c, x, top, 1, h, P.nearBldgTop);
    if (rn() > 0.7) {
      pxc(c, x + 3, top - 4, 4, 4, P.nearBldg);
      pxc(c, x + 3, top - 4, 4, 1, P.nearBldgTop);
    }
    for (let wy = top + 4; wy < NEAR_BASE - 4; wy += 6) {
      for (let wx = x + 3; wx < x + w - 3; wx += 5) {
        const k = rn();
        if (k > 0.55) pxc(c, wx, wy, 2, 3, k > 0.8 ? P.win : P.winDim);
      }
    }
    x += w + 2 + Math.floor(rn() * 4);
  }
})();

// ---- ground tile ----------------------------------------------------------
const GH = H - GROUND_Y;
const GROUND = makeLayer(TILE_W, GH);
(function buildGround() {
  const c = GROUND.ctx;
  pxc(c, 0, 0, TILE_W, GH, P.ground);
  pxc(c, 0, 0, TILE_W, 2, P.groundTop);
  pxc(c, 0, 3, TILE_W, 1, '#15151f');
  for (let dx = 2; dx < TILE_W; dx += 12) pxc(c, dx, 10, 6, 1, P.groundLine);
  const rg = rng(909);
  for (let s = 0; s < 140; s++) {
    pxc(c, Math.floor(rg() * TILE_W), 5 + Math.floor(rg() * (GH - 6)), 1, 1, '#1a1a26');
  }
})();

// ---- scrolling ------------------------------------------------------------
let offFar = 0;
let offNear = 0;
let offGround = 0;

export function scrollWorld(dt: number, sp: number): void {
  offFar = (offFar + sp * 0.25 * dt) % TILE_W;
  offNear = (offNear + sp * 0.55 * dt) % TILE_W;
  offGround = (offGround + sp * dt) % TILE_W;
}

export function resetScroll(): void {
  offFar = 0;
  offNear = 0;
  offGround = 0;
}

function drawTiled(layer: Layer, off: number, y: number): void {
  let x = -Math.floor(off);
  while (x < W) {
    ctx.drawImage(layer.canvas, x, y);
    x += layer.w;
  }
}

export function drawBackdrop(): void {
  ctx.drawImage(SKY.canvas, 0, 0);
  drawTiled(FAR, offFar, 0);
  drawTiled(NEAR, offNear, 0);
}

export function drawGroundStrip(): void {
  drawTiled(GROUND, offGround, GROUND_Y);
}
