// obstacle towers built from stacked bricks
import { W, H, px, ctx } from './gfx';
import { P } from './palette';
import { GROUND_Y, GAP_H } from './constants';

export const CELL = 12; // one stacked block is 12x12
export const COL_W = 24; // column is 2 blocks wide

export interface Column {
  x: number;
  gapTop: number;
  seed: number;
  scored: boolean;
  gone?: Record<string, 1>;
  dmg?: Record<string, number>;
}

// [face, light, dark] for each block tone - shared by the blocks and by
// the debris particles they break into
export const TONE_COLORS: [string, string, string][] = [
  [P.blockFace, P.blockLight, P.blockDark],
  [P.blockGrey, P.greyLight, P.greyDark],
  ['#232326', '#35353a', '#111113'],
];

export function drawBlock(x: number, y: number, tone: number): void {
  if (x + CELL < 0 || x > W || y + CELL < 0 || y > H) return;
  const t = TONE_COLORS[tone];
  const face = t[0], light = t[1], dark = t[2];

  px(x, y, CELL, CELL, face);
  px(x, y, CELL, 1, light);
  px(x, y, 1, CELL, light);
  px(x, y + CELL - 2, CELL, 2, dark);
  px(x + CELL - 2, y, 2, CELL, dark);
  px(x, y, CELL, 1, P.blockOutline);
  px(x, y + CELL - 1, CELL, 1, P.blockOutline);
  px(x, y, 1, CELL, P.blockOutline);
  px(x + CELL - 1, y, 1, CELL, P.blockOutline);
  px(x + 1, y + 1, CELL - 3, 1, light);
  px(x + 1, y + 1, 1, CELL - 3, light);
}

// a block caught by the edge of a blast: still standing, but scorched, with
// bites out of its corners and cracks across the face. The bites are painted
// in near-black so they read as holes against the night sky behind.
export const CHIP = '#0a0812';
export function drawBlockDamaged(x: number, y: number, tone: number, v: number): void {
  if (x + CELL < 0 || x > W || y + CELL < 0 || y > H) return;
  drawBlock(x, y, tone);

  // scorch the face
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.fillRect(x, y, CELL, CELL);

  // corner bites, picked by the variant bits
  if (v & 1) { px(x + CELL - 4, y, 4, 3, CHIP); px(x + CELL - 2, y + 3, 2, 2, CHIP); }
  if (v & 2) { px(x, y + CELL - 4, 3, 4, CHIP); px(x + 3, y + CELL - 2, 2, 2, CHIP); }
  if (v & 4) { px(x, y, 3, 2, CHIP); px(x + CELL - 3, y + CELL - 3, 3, 3, CHIP); }

  // crack running down the face
  px(x + 5, y + 2, 1, 2, CHIP);
  px(x + 6, y + 4, 1, 2, CHIP);
  px(x + 5, y + 6, 1, 2, CHIP);
  px(x + 7, y + 8, 1, 3, CHIP);
  if (v & 2) px(x + 3, y + 5, 2, 1, CHIP);
  if (v & 4) px(x + 8, y + 3, 1, 2, CHIP);
}

export function toneFor(col: number, row: number): number {
  const t = ((col * 7 + row * 5) % 6 + 6) % 6;
  if (t < 3) return 0;
  if (t < 5) return 1;
  return 2;
}

export function drawColumn(c: Column): void {
  const cx = Math.round(c.x);
  if (cx > W || cx + COL_W < 0) return;

  const gone = c.gone, dmg = c.dmg;
  let key: string, d: number | undefined;
  let y = c.gapTop - CELL, row = 0;
  while (y > -CELL) {
    for (let b = 0; b < COL_W / CELL; b++) {
      key = 't' + row + '_' + b;
      if (gone && gone[key]) continue;
      d = dmg && dmg[key];
      if (d) drawBlockDamaged(cx + b * CELL, y, toneFor(c.seed * 3 + b, row), d);
      else drawBlock(cx + b * CELL, y, toneFor(c.seed * 3 + b, row));
    }
    y -= CELL;
    row++;
  }
  let by = c.gapTop + GAP_H;
  row = 0;
  while (by < GROUND_Y) {
    for (let b = 0; b < COL_W / CELL; b++) {
      key = 'b' + row + '_' + b;
      if (gone && gone[key]) continue;
      d = dmg && dmg[key];
      if (d) drawBlockDamaged(cx + b * CELL, by, toneFor(c.seed * 3 + b + 1, row + 4), d);
      else drawBlock(cx + b * CELL, by, toneFor(c.seed * 3 + b + 1, row + 4));
    }
    by += CELL;
    row++;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(cx + COL_W, 0, 2, c.gapTop);
  ctx.fillRect(cx + COL_W, c.gapTop + GAP_H, 2, GROUND_Y - (c.gapTop + GAP_H));
}
