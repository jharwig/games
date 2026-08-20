// pixel debris particles
import { W, H, px } from './gfx';
import { P } from './palette';
import { GROUND_Y, GAP_H } from './constants';
import { CELL, COL_W, TONE_COLORS, toneFor, type Column } from './blocks';
import { S, HERO_GRID } from './cosmetics';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  col: string | null;
  tone: number;
  life: number;
  seed: number;
}

export const particles: Particle[] = [];
const PART_GRAVITY = 300; // px/s^2
const PART_LIFE = 1.0; // s
const BLAST_R = 28; // px - blocks this close to the impact break apart
const DAMAGE_R = 44; // px - blocks out to here crack but stay standing
// headroom for the 213 cube pixels plus ~10 blocks x 9 brick chunks
const MAX_PARTS = 700;

// tone >= 0 marks a shaded brick chunk; otherwise it is a flat pixel
export function addPart(
  x: number, y: number, vx: number, vy: number,
  size: number, col: string | null, life: number, tone?: number,
): void {
  if (particles.length >= MAX_PARTS) return;
  particles.push({
    x, y, vx, vy, size, col,
    tone: tone === undefined ? -1 : tone,
    life,
    seed: (particles.length * 7) & 1,
  });
}

// scatter a piece outward from the blast origin
function scatter(
  x: number, y: number, ox: number, oy: number,
  size: number, col: string | null, power: number, tone?: number,
): void {
  let dx = x - ox, dy = y - oy;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.001) {
    dx = Math.random() - 0.5;
    dy = Math.random() - 0.5;
    d = 1;
  }
  const sp = power * (0.55 + Math.random() * 0.75);
  addPart(
    x, y,
    (dx / d) * sp + (Math.random() - 0.5) * 26,
    (dy / d) * sp + (Math.random() - 0.5) * 26 - 24,
    size, col,
    PART_LIFE * (0.6 + Math.random() * 0.55),
    tone,
  );
}

// the cube itself: one particle per sprite pixel, plus the propeller
export function explodeHero(bx: number, by: number): void {
  const ox = bx + S / 2, oy = by + S / 2;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const col = HERO_GRID[j * S + i];
      if (!col) continue;
      scatter(bx + i, by + j, ox, oy, 1, col, 105);
    }
  }
  // propeller blade + mast pixels
  for (let i = -8; i <= S + 8; i += 2) {
    scatter(bx + i, by - 8 - (i & 1), ox, oy, 1, i % 4 === 0 ? P.prop : P.propBlur, 130);
  }
  addPart(bx + 6, by - 8, (Math.random() - 0.5) * 60, -120, 2, P.prop, PART_LIFE);
}

// a 12x12 block breaks into a 3x3 grid of 4x4 brick chunks - real brick
// pieces with their own shading, not a cloud of dust
const PIECE = 4;
function explodeBlock(x: number, y: number, tone: number, ox: number, oy: number): void {
  for (let gy = 0; gy < CELL / PIECE; gy++) {
    for (let gx = 0; gx < CELL / PIECE; gx++) {
      scatter(x + gx * PIECE, y + gy * PIECE, ox, oy, PIECE, null, 72, tone);
    }
  }
}

// one brick chunk, shaded like the block it came from
function drawBrickPiece(x: number, y: number, n: number, tone: number): void {
  const t = TONE_COLORS[tone];
  px(x, y, n, n, t[0]);
  px(x, y, n, 1, t[1]); // top highlight
  px(x, y, 1, n, t[1]); // left highlight
  px(x + n - 1, y, 1, n, t[2]); // right shade
  px(x, y + n - 1, n, 1, t[2]); // bottom shade
}

// break the blocks of the hit column near the impact: an inner radius is
// destroyed outright, an outer ring is left standing but cracked
export function explodeNearbyBlocks(c: Column | null | undefined, ox: number, oy: number): void {
  if (!c) return;
  if (!c.gone) c.gone = {};
  if (!c.dmg) c.dmg = {};
  const cx = Math.round(c.x);
  let y: number, row: number, d: number, key: string, tone: number;

  y = c.gapTop - CELL;
  row = 0;
  while (y > -CELL) {
    d = Math.abs(y + CELL / 2 - oy);
    if (d <= DAMAGE_R) {
      for (let b = 0; b < COL_W / CELL; b++) {
        key = 't' + row + '_' + b;
        tone = toneFor(c.seed * 3 + b, row);
        if (d <= BLAST_R) {
          c.gone[key] = 1;
          explodeBlock(cx + b * CELL, y, tone, ox, oy);
        } else {
          c.dmg[key] = 1 + ((row * 3 + b * 5 + c.seed) % 7);
        }
      }
    }
    y -= CELL;
    row++;
  }

  y = c.gapTop + GAP_H;
  row = 0;
  while (y < GROUND_Y) {
    d = Math.abs(y + CELL / 2 - oy);
    if (d <= DAMAGE_R) {
      for (let b = 0; b < COL_W / CELL; b++) {
        key = 'b' + row + '_' + b;
        tone = toneFor(c.seed * 3 + b + 1, row + 4);
        if (d <= BLAST_R) {
          c.gone[key] = 1;
          explodeBlock(cx + b * CELL, y, tone, ox, oy);
        } else {
          c.dmg[key] = 1 + ((row * 3 + b * 5 + c.seed) % 7);
        }
      }
    }
    y += CELL;
    row++;
  }
}

export function updateParticles(dt: number): void {
  if (!particles.length) return;
  const damp = Math.exp(-1.1 * dt);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += PART_GRAVITY * dt;
    p.vx *= damp;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // debris settles on the pavement
    if (p.y > GROUND_Y - p.size && p.vy > 0) {
      p.y = GROUND_Y - p.size;
      p.vy *= -0.34;
      p.vx *= 0.6;
      if (Math.abs(p.vy) < 12) p.vy = 0;
    }
    p.life -= dt;
    if (p.life <= 0 || p.x < -8 || p.x > W + 8 || p.y > H + 8) particles.splice(i, 1);
  }
}

export function drawParticles(clock: number): void {
  for (const p of particles) {
    // fade out by flickering, which keeps the pixel-art look
    if (p.life < 0.3 && ((Math.floor(clock * 22) + p.seed) & 1)) continue;
    if (p.tone >= 0) drawBrickPiece(p.x | 0, p.y | 0, p.size, p.tone);
    else if (p.col) px(p.x, p.y, p.size, p.size, p.col);
  }
}
