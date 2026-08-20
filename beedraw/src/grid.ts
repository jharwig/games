// =========================================================================
// pathfinding grid primitives (shared by the game and the level guard)
// =========================================================================
import { CELL, GW, GH, INF } from "./const";
import { clamp } from "./util";

export const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function cellOf(x: number, y: number): number {
  const gx = clamp((x / CELL) | 0, 0, GW - 1), gy = clamp((y / CELL) | 0, 0, GH - 1);
  return gy * GW + gx;
}

// BFS distance field outward from a target cell
export function distField(grid: Uint8Array, tx: number, ty: number): Int32Array {
  const d = new Int32Array(GW * GH);
  let i;
  for (i = 0; i < d.length; i++) d[i] = INF;
  const q = new Int32Array(GW * GH);
  let qh = 0, qt = 0;
  const sx = clamp((tx / CELL) | 0, 0, GW - 1), sy = clamp((ty / CELL) | 0, 0, GH - 1);
  // seed the target cell and its free neighbours (the target itself may be
  // covered by ink if the player drew right up to it)
  d[sy * GW + sx] = 0; q[qt++] = sy * GW + sx;
  for (i = 0; i < NB.length; i++) {
    const nx = sx + NB[i][0], ny = sy + NB[i][1];
    if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
    const ni = ny * GW + nx;
    if (grid[ni] || d[ni] === 0) continue;
    d[ni] = 0; q[qt++] = ni;
  }
  while (qh < qt) {
    const ci = q[qh++];
    const cx = ci % GW, cy = (ci / GW) | 0, cd = d[ci];
    for (i = 0; i < NB.length; i++) {
      const ax = cx + NB[i][0], ay = cy + NB[i][1];
      if (ax < 0 || ay < 0 || ax >= GW || ay >= GH) continue;
      const ai = ay * GW + ax;
      if (grid[ai] || d[ai] !== INF) continue;
      if (NB[i][0] && NB[i][1]) {                 // no corner cutting
        if (grid[cy * GW + ax] && grid[ay * GW + cx]) continue;
      }
      d[ai] = cd + 1;
      q[qt++] = ai;
    }
  }
  return d;
}
