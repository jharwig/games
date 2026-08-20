// coins: bronze 1 / silver 5 / gold 10 - the riskier the spot, the higher
// the value (economy designed by Arthur Harwig)
import { W, px } from './gfx';
import { GROUND_Y, GAP_H, SPACING, PLAYER_X } from './constants';
import { COL_W } from './blocks';
import { S, earnCoins } from './cosmetics';
import { addPart } from './particles';
import { sfxCoin } from './audio';

export const COIN_W = 7;

export const COIN_TIERS = [
  { name: 'bronze', value: 1, cols: ['#e0a06a', '#b0703a', '#6e421e'] },
  { name: 'silver', value: 5, cols: ['#f0f4ff', '#cfd6e6', '#7d8699'] },
  { name: 'gold', value: 10, cols: ['#ffe9a0', '#ffd166', '#8c6a1e'] },
] as const;

interface Coin {
  x: number;
  y: number;
  tier: number;
  phase: number;
}

export const coins: Coin[] = [];

export function resetCoins(): void {
  coins.length = 0;
}

// rolled once per spawned tower
export function spawnCoins(x: number, gapTop: number): void {
  const r = Math.random();
  const phase = Math.random() * Math.PI * 2;
  if (r < 0.08) {
    // gold: far off the safe line, between this tower and the next -
    // a ceiling graze or a dive toward the pavement
    coins.push({
      x: x + COL_W + SPACING / 2 - COIN_W / 2,
      y: Math.random() < 0.5 ? 14 : GROUND_Y - 16 - COIN_W,
      tier: 2,
      phase,
    });
  } else if (r < 0.33) {
    // silver: hugging the lip of the gap
    coins.push({
      x: x + (COL_W - COIN_W) / 2,
      y: Math.random() < 0.5 ? gapTop + 3 : gapTop + GAP_H - 3 - COIN_W,
      tier: 1,
      phase,
    });
  } else if (r < 0.88) {
    // bronze: the safe middle of the gap
    coins.push({
      x: x + (COL_W - COIN_W) / 2,
      y: gapTop + (GAP_H - COIN_W) / 2,
      tier: 0,
      phase,
    });
  }
}

function bobY(c: Coin, clock: number): number {
  return c.y + Math.sin(clock * 4 + c.phase) * 1.5;
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function collect(c: Coin): void {
  const t = COIN_TIERS[c.tier];
  earnCoins(t.value);
  sfxCoin(c.tier);
  // sparkle burst in the coin's colours
  for (let i = 0; i < 8; i++) {
    addPart(
      c.x + 3, c.y + 3,
      (Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90 - 30,
      1, t.cols[i % 2], 0.4 + Math.random() * 0.25,
    );
  }
}

export function updateCoins(dt: number, speed: number, playerY: number, clock: number): void {
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.x -= speed * dt;
    if (c.x < -COIN_W - 2) {
      coins.splice(i, 1);
      continue;
    }
    if (rectsOverlap(PLAYER_X, playerY, S, S, c.x, bobY(c, clock), COIN_W, COIN_W)) {
      collect(c);
      coins.splice(i, 1);
    }
  }
}

export function drawCoinAt(x: number, y: number, tier: number): void {
  x |= 0;
  y |= 0;
  const t = COIN_TIERS[tier].cols;
  px(x + 1, y, 5, 1, t[2]);
  px(x + 1, y + 6, 5, 1, t[2]);
  px(x, y + 1, 1, 5, t[2]);
  px(x + 6, y + 1, 1, 5, t[2]);
  px(x + 1, y + 1, 5, 5, t[1]);
  px(x + 2, y + 1, 2, 1, t[0]);
  px(x + 1, y + 2, 1, 2, t[0]);
  px(x + 3, y + 2, 1, 3, t[2]); // stamped slot
}

export function drawCoins(clock: number): void {
  for (const c of coins) {
    if (c.x > W || c.x + COIN_W < 0) continue;
    drawCoinAt(c.x, bobY(c, clock), c.tier);
  }
}
