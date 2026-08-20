// mystery pickups (designed by Arthur Harwig): a rainbow-cycling square in
// the safe middle of a gap. Grabbing one re-rolls the run's speed multiplier
// to a random value - you can't tell fast from slow before you grab it, and
// it sticks until the next one. Nothing else happens: no text, no sound.
import { W, px } from './gfx';
import { GAP_H, PLAYER_X, PICKUP_CHANCE, SPEED_MULT_MIN, SPEED_MULT_MAX } from './constants';
import { COL_W } from './blocks';
import { S } from './cosmetics';
import { COIN_W, type Coin } from './coins';

export const PICKUP_W = 8;

// pixel-art rainbow, stepped rather than smooth
export const RAINBOW = ['#ff3b3b', '#ff8c3b', '#ffe13b', '#3fbf3f', '#35b5f0', '#2b4ff0', '#b04fe0'];
const RAINBOW_LIGHT = ['#ff8a8a', '#ffb469', '#fff09a', '#8ae08a', '#8ad8f8', '#8096f8', '#d89af0'];
const OUTLINE = '#1a1020';

interface Pickup {
  x: number;
  y: number;
  phase: number;
}

export const pickups: Pickup[] = [];
export let speedMult = 1;

export function resetPickups(): void {
  pickups.length = 0;
  speedMult = 1;
}

// rolled once per spawned tower. If a bronze coin already sits in the middle
// of this gap, the two stack (coin above, pickup below) so both stay visible.
export function spawnPickup(x: number, gapTop: number, coin: Coin | null): void {
  if (Math.random() >= PICKUP_CHANCE) return;
  const mid = gapTop + GAP_H / 2;
  let y = mid - PICKUP_W / 2;
  if (coin && coin.tier === 0) {
    coin.y = mid - COIN_W - 2;
    y = mid + 1;
  }
  pickups.push({
    x: x + (COL_W - PICKUP_W) / 2,
    y,
    phase: Math.random() * Math.PI * 2,
  });
}

function bobY(p: Pickup, clock: number): number {
  return p.y + Math.sin(clock * 4 + p.phase) * 1.5;
}

function rollSpeed(): void {
  speedMult = SPEED_MULT_MIN + Math.random() * (SPEED_MULT_MAX - SPEED_MULT_MIN);
}

export function updatePickups(dt: number, speed: number, playerY: number, clock: number): void {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.x -= speed * dt;
    if (p.x < -PICKUP_W - 2) {
      pickups.splice(i, 1);
      continue;
    }
    const py = bobY(p, clock);
    if (PLAYER_X < p.x + PICKUP_W && PLAYER_X + S > p.x && playerY < py + PICKUP_W && playerY + S > py) {
      rollSpeed();
      pickups.splice(i, 1);
    }
  }
}

export function drawPickupAt(x: number, y: number, clock: number): void {
  x |= 0;
  y |= 0;
  const i = Math.floor(clock * 9) % RAINBOW.length;
  px(x, y, PICKUP_W, PICKUP_W, OUTLINE);
  px(x + 1, y + 1, PICKUP_W - 2, PICKUP_W - 2, RAINBOW[i]);
  px(x + 1, y + 1, PICKUP_W - 3, 1, RAINBOW_LIGHT[i]);
  px(x + 1, y + 1, 1, PICKUP_W - 3, RAINBOW_LIGHT[i]);
  px(x + 2, y + 2, 1, 1, '#ffffff');
}

export function drawPickups(clock: number): void {
  for (const p of pickups) {
    if (p.x > W || p.x + PICKUP_W < 0) continue;
    drawPickupAt(p.x, bobY(p, clock), clock);
  }
}
