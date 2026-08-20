// the Sparkle Trail animation (designed by Arthur Harwig): rainbow sparkles
// left behind the block wherever it shows - in a run, on the title and in
// the shop. Purely cosmetic.
import { W, H, px } from './gfx';
import { S } from './cosmetics';
import { RAINBOW } from './pickups';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  twinkle: boolean;
  col: string;
  seed: number;
}

const sparks: Spark[] = [];
const RATE = 55; // sparks per second
const MAX_SPARKS = 160;
let emitAcc = 0;

export function resetTrail(): void {
  sparks.length = 0;
  emitAcc = 0;
}

// sparks drift with the world so they hang in the air where the block was;
// the colour walks along the rainbow over time, so the trail shows bands
export function emitTrail(dt: number, bx: number, by: number, speed: number, clock: number): void {
  emitAcc += dt * RATE;
  const col = RAINBOW[Math.floor(clock * 7) % RAINBOW.length];
  while (emitAcc >= 1) {
    emitAcc -= 1;
    if (sparks.length >= MAX_SPARKS) break;
    sparks.push({
      x: bx - 2 + Math.random() * 3,
      y: by + 1 + Math.random() * (S - 2),
      vx: -speed * (0.85 + Math.random() * 0.3) - Math.random() * 10,
      vy: (Math.random() - 0.5) * 14,
      life: 0.35 + Math.random() * 0.35,
      twinkle: Math.random() < 0.3,
      col,
      seed: sparks.length & 1,
    });
  }
}

export function updateTrail(dt: number): void {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.life <= 0 || s.x < -4 || s.x > W + 4 || s.y < -4 || s.y > H + 4) sparks.splice(i, 1);
  }
}

export function drawTrail(clock: number): void {
  for (const s of sparks) {
    // fade by flickering to keep the pixel look
    if (s.life < 0.18 && ((Math.floor(clock * 24) + s.seed) & 1)) continue;
    const x = s.x | 0, y = s.y | 0;
    px(x, y, 1, 1, s.col);
    if (s.twinkle && s.life > 0.25) {
      // little plus-shaped twinkle
      px(x - 1, y, 1, 1, s.col);
      px(x + 1, y, 1, 1, s.col);
      px(x, y - 1, 1, 1, s.col);
      px(x, y + 1, 1, 1, s.col);
    }
  }
}

// a self-contained looping trail for the shop preview, trailing left from
// the block's left edge at (x, y)
export function drawTrailPreview(x: number, y: number, clock: number): void {
  const t = Math.floor(clock * 10);
  for (let i = 0; i < 14; i++) {
    // cheap hash for a jittery-but-stable pattern per spark slot + frame
    const h = ((i * 73 + t * 31) * 2654435761) >>> 0;
    const jx = (h & 3) - 1;
    const jy = ((h >> 2) % (S - 2)) + 1;
    if (((h >> 7) & 7) === 0) continue; // some slots dark - twinkle
    const sx = x - 2 - i * 2 + jx;
    const sy = y + jy;
    const col = RAINBOW[(i + t) % RAINBOW.length];
    px(sx, sy, 1, 1, col);
    if (((h >> 10) & 3) === 0 && i < 6) {
      px(sx - 1, sy, 1, 1, col);
      px(sx + 1, sy, 1, 1, col);
      px(sx, sy - 1, 1, 1, col);
      px(sx, sy + 1, 1, 1, col);
    }
  }
}
