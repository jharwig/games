// player cube rendering (the look itself lives in cosmetics.ts)
import { px, ctx } from './gfx';
import { P } from './palette';
import { S, HERO_GRID, heroGlow } from './cosmetics';

// draws the cube with a pixel-art vertical shear so it "tilts"
export function drawHero(bx: number, by: number, tilt: number, propFrame: number): void {
  bx = Math.round(bx);
  by = Math.round(by);

  // warm glow behind the block, tinted to the equipped colour
  ctx.fillStyle = heroGlow;
  ctx.fillRect(bx - 4, by - 4, S + 8, S + 8);

  // propeller (alternating blur widths)
  const pdy = Math.round(tilt * 2);
  if (propFrame === 0) {
    px(bx - 8, by - 8 + pdy, S + 16, 1, P.propBlur);
    px(bx - 5, by - 9 + pdy, S + 10, 1, P.prop);
    px(bx - 10, by - 8 + pdy, 2, 1, P.propBlur);
    px(bx + S + 8, by - 8 + pdy, 2, 1, P.propBlur);
  } else {
    px(bx - 4, by - 8 + pdy, S + 8, 1, P.propBlur);
    px(bx - 9, by - 9 + pdy, S + 18, 1, P.prop);
    px(bx - 12, by - 9 + pdy, 2, 1, P.propBlur);
    px(bx + S + 10, by - 9 + pdy, 2, 1, P.propBlur);
  }
  // hub + mast
  px(bx + 6, by - 9 + pdy, 2, 2, P.prop);
  px(bx + 6, by - 7 + pdy, 2, 3, '#9aa3b8');

  // body, sheared column by column
  const half = (S - 1) / 2;
  for (let i = 0; i < S; i++) {
    const dy = Math.round((i - half) * tilt);
    let runStart = 0;
    let runCol = HERO_GRID[i];
    for (let j = 1; j <= S; j++) {
      const c = j < S ? HERO_GRID[j * S + i] : null;
      if (c !== runCol) {
        if (runCol) px(bx + i, by + runStart + dy, 1, j - runStart, runCol);
        runStart = j;
        runCol = c === null ? undefined : c;
      }
    }
  }
}
