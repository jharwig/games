// =========================================================================
// level generation (fresh layout every attempt; the numbers come from the
// level) + geometry tests
// =========================================================================
import {
  W, H, FX0, FY0, FX1, FY1, CELL, GW, GH, INF, ANIM_NODRAW, INK_HALF,
  BEE_SPEED, BEE_SPD_MIN, BEE_SPD_MAX, LIFT_FROM_LEVEL
} from "./const";
import { clamp, dist2, mulberry32 } from "./util";
import { NB, cellOf, distField } from "./grid";

export interface Gap { side: number; a: number; b: number }
export type SolidKind = "rock" | "mountain" | "tree" | "log" | "honey";
// parts are ellipses [cx, cy, rx, ry] in the solid's local frame (scaled by
// s, rotated by rot). Everything solid blocks the bees and the pen alike.
export interface Solid { kind: SolidKind; x: number; y: number; s: number; rot: number; parts: number[][]; seed: number }
export interface Pond { x: number; y: number; r: number; radii: number[] }
export interface BeeSpawn { gap: Gap; spd: number; phase: number; delay: number; off: number }
export interface Level {
  level: number;
  ok: boolean;
  seed: number;
  biome: number;
  gaps: Gap[];
  solids: Solid[];
  ponds: Pond[];
  bees: BeeSpawn[];
  ax: number;
  ay: number;
  wallSides: Record<number, 1 | undefined>;
  mode: string;
  time: number;
  ink: number;
  seal: number;
  lift: boolean;
}

export const BIOME_COUNT = 5;

const SHAPES: Record<SolidKind, number[][]> = {
  rock: [[-26, 6, 22, 16], [6, 4, 26, 20], [-6, -10, 18, 13]],
  mountain: [[-56, 10, 54, 40], [12, -8, 62, 46], [68, 18, 46, 34]],
  tree: [[0, 0, 20, 17]],
  log: [[0, 0, 52, 9]],
  honey: [[0, 4, 22, 17]]
};

// =========================================================================
// geometry tests
// =========================================================================
export function pointInPond(L: Level, x: number, y: number, pad: number): boolean {
  for (let i = 0; i < L.ponds.length; i++) {
    const p = L.ponds[i];
    const dx = x - p.x, dy = y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > p.r * 1.5 + (pad || 0)) continue;
    const ang = Math.atan2(dy, dx);
    const f = (ang + Math.PI) / (Math.PI * 2) * 12;
    const i0 = Math.floor(f) % 12, i1 = (i0 + 1) % 12, tt = f - Math.floor(f);
    const rr2 = p.radii[i0] + (p.radii[i1] - p.radii[i0]) * tt;
    if (d < rr2 + (pad || 0)) return true;
  }
  return false;
}

export function pointInOneSolid(sd: Solid, x: number, y: number, pad: number): boolean {
  const dx0 = x - sd.x, dy0 = y - sd.y;
  const ca = Math.cos(-sd.rot), sa = Math.sin(-sd.rot);
  const lx = dx0 * ca - dy0 * sa, ly = dx0 * sa + dy0 * ca;
  for (let j = 0; j < sd.parts.length; j++) {
    const sh = sd.parts[j];
    const cx = sh[0] * sd.s, cy = sh[1] * sd.s;
    const rx = sh[2] * sd.s + (pad || 0), ry = sh[3] * sd.s + (pad || 0);
    const dx = (lx - cx) / rx, dy = (ly - cy) / ry;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

export function pointInSolid(L: Level, x: number, y: number, pad: number): boolean {
  for (let i = 0; i < L.solids.length; i++) {
    if (pointInOneSolid(L.solids[i], x, y, pad)) return true;
  }
  return false;
}

// radius of the circle that contains the whole solid
export function solidExtent(sd: Solid): number {
  let e = 0;
  for (let j = 0; j < sd.parts.length; j++) {
    const sh = sd.parts[j];
    const d = Math.sqrt(sh[0] * sh[0] + sh[1] * sh[1]) + Math.max(sh[2], sh[3]);
    if (d > e) e = d;
  }
  return e * sd.s;
}

export function inField(x: number, y: number, pad?: number): boolean {
  pad = pad || 0;
  return x > FX0 + pad && x < FX1 - pad && y > FY0 + pad && y < FY1 - pad;
}

// =========================================================================
// gap helpers
// =========================================================================
export function gapInner(gap: Gap): { x: number; y: number } {
  const c = (gap.a + gap.b) / 2;
  if (gap.side === 0) return { x: c, y: FY0 + 30 };
  if (gap.side === 1) return { x: c, y: FY1 - 30 };
  if (gap.side === 2) return { x: FX0 + 30, y: c };
  return { x: FX1 - 30, y: c };
}
export function gapOuter(gap: Gap, off?: number): { x: number; y: number } {
  const c = (gap.a + gap.b) / 2 + (off || 0) * (gap.b - gap.a) * 0.5;
  const d = 22 + Math.abs(off || 0) * 18;
  let p;
  if (gap.side === 0) p = { x: c, y: FY0 - d };
  else if (gap.side === 1) p = { x: c, y: FY1 + d };
  else if (gap.side === 2) p = { x: FX0 - d, y: c };
  else p = { x: FX1 + d, y: c };
  // keep the waiting bees on screen
  p.x = clamp(p.x, 18, W - 18);
  p.y = clamp(p.y, 46, H - 18);
  return p;
}

// =========================================================================
// generation
// =========================================================================

// how many fence gaps at level n (up to 6, opposite sides enforced below)
function gapCount(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 6) return 3;
  if (n <= 9) return 4;
  if (n <= 13) return 5;
  return 6;
}

// The cheapest possible full enclosure: a ring drawn right on the edge of the
// animal's no-draw circle. Level 1 hands out enough ink for it; from level 2
// the budget follows the verified seal instead. A free-floating ring is no
// longer forbidden - it is loose everywhere, so the bees just lift it.
export const ENC_COST = 2 * Math.PI * (ANIM_NODRAW + 34);   // ring at animal + bee + margin

// ---- solvability check -------------------------------------------------
// The guard does not guess: it builds the same grid the bees walk on, draws a
// candidate line into it and asks whether any gap can still reach the animal.

function gridFor(Lv: Level): Uint8Array {
  const arr = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
      arr[gy * GW + gx] = (!inField(x, y, 8) || pointInSolid(Lv, x, y, 6)) ? 1 : 0;
    }
  }
  return arr;
}

function stampInto(arr: Uint8Array, x: number, y: number, rad: number): void {
  const g0 = clamp(((x - rad) / CELL) | 0, 0, GW - 1), g1 = clamp(((x + rad) / CELL) | 0, 0, GW - 1);
  const h0 = clamp(((y - rad) / CELL) | 0, 0, GH - 1), h1 = clamp(((y + rad) / CELL) | 0, 0, GH - 1);
  for (let gy = h0; gy <= h1; gy++) {
    for (let gx = g0; gx <= g1; gx++) {
      const cx = gx * CELL + CELL / 2, cy = gy * CELL + CELL / 2;
      if (dist2(cx, cy, x, y) <= rad * rad) arr[gy * GW + gx] = 1;
    }
  }
}

// can any bee still walk from a gap to the animal?
function sealedFor(arr: Uint8Array, Lv: Level): boolean {
  const seen = new Uint8Array(GW * GH);
  const q = new Int32Array(GW * GH);
  let qh = 0, qt = 0, i;
  const sx = clamp((Lv.ax / CELL) | 0, 0, GW - 1), sy = clamp((Lv.ay / CELL) | 0, 0, GH - 1);
  seen[sy * GW + sx] = 1; q[qt++] = sy * GW + sx;
  for (i = 0; i < NB.length; i++) {
    const nx = sx + NB[i][0], ny = sy + NB[i][1];
    if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
    const ni = ny * GW + nx;
    if (arr[ni] || seen[ni]) continue;
    seen[ni] = 1; q[qt++] = ni;
  }
  while (qh < qt) {
    const ci = q[qh++], cx = ci % GW, cy = (ci / GW) | 0;
    for (i = 0; i < NB.length; i++) {
      const ax = cx + NB[i][0], ay = cy + NB[i][1];
      if (ax < 0 || ay < 0 || ax >= GW || ay >= GH) continue;
      const ai = ay * GW + ax;
      if (arr[ai] || seen[ai]) continue;
      if (NB[i][0] && NB[i][1] && arr[cy * GW + ax] && arr[ay * GW + cx]) continue;
      seen[ai] = 1; q[qt++] = ai;
    }
  }
  // every free cell in the mouth of a gap is a place a bee can appear
  for (i = 0; i < Lv.gaps.length; i++) {
    const gq = Lv.gaps[i];
    let v, u, mx, my;
    for (v = gq.a - 6; v <= gq.b + 6; v += CELL / 2) {
      for (u = 10; u <= 40; u += CELL / 2) {
        if (gq.side === 0) { mx = v; my = FY0 + u; }
        else if (gq.side === 1) { mx = v; my = FY1 - u; }
        else if (gq.side === 2) { mx = FX0 + u; my = v; }
        else { mx = FX1 - u; my = v; }
        const mi = clamp((my / CELL) | 0, 0, GH - 1) * GW + clamp((mx / CELL) | 0, 0, GW - 1);
        if (seen[mi]) return false;
      }
    }
  }
  return true;
}

// The cheapest verified seal: try rings of growing radius, draw only the parts
// the player is allowed to draw (not on the fence, not on a solid, not on the
// water) and keep the cheapest one that really shuts the bees out.
function ringSealCost(Lv: Level): number {
  let best = INF;
  if (sealedFor(gridFor(Lv), Lv)) return 0;       // walled in already: no game
  for (let r = ANIM_NODRAW + 4; r <= ANIM_NODRAW + 96; r += 8) {
    const arr = gridFor(Lv);
    const N = 200, stepLen = 2 * Math.PI * r / N;
    let cost = 0, pieces = 0, prevFree = false;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      const x = Lv.ax + Math.cos(a) * r, y = Lv.ay + Math.sin(a) * r;
      if (!inField(x, y, 12) || pointInSolid(Lv, x, y, 4) || pointInPond(Lv, x, y, 0)) {
        prevFree = false; continue;               // cannot draw here
      }
      stampInto(arr, x, y, INK_HALF + CELL);
      cost += stepLen;
      if (!prevFree) pieces++;
      prevFree = true;
    }
    if (!sealedFor(arr, Lv)) continue;            // this ring still leaks
    cost += 26 * Math.max(0, pieces - 1);         // detours between the anchors
    if (cost < best) best = cost;
  }
  return best;
}

function fail(L: Level): Level { L.ok = false; return L; }

const PEN_ROOM = 12;      // the narrowest corridor the pen can still be drawn through

function tryGen(level: number, seed: number): Level {
  const r = mulberry32((seed * 2654435761) | 0);
  const n = level;
  const L: Level = {
    level: level, ok: true, seed: seed, biome: 0, gaps: [], solids: [], ponds: [], bees: [],
    ax: 0, ay: 0, wallSides: {}, mode: "", time: 0, ink: 0, seal: 0,
    lift: n >= LIFT_FROM_LEVEL
  };
  let i, k, x, y, t2;

  L.biome = (r() * BIOME_COUNT) | 0;

  // survival timer: 7s early, 12s at the plateau
  L.time = Math.round(clamp(7 + (n - 1) * 0.28, 7, 12));

  // ---- where the animal stands ----
  // a corner or a wall gives the line something to hold on to, a rock nook
  // makes the player work for it - but a fence-hugging animal is cheap to
  // seal, so it stands well off the rails and rock nooks are the common case
  const mode = n <= 1 ? "open" : (r() < 0.3 ? "corner" : (r() < 0.55 ? "wall" : "rocks"));
  L.mode = mode;
  L.wallSides = {};
  if (mode === "corner") {
    const cx = r() < 0.5 ? FX0 : FX1, cy = r() < 0.5 ? FY0 : FY1;
    L.ax = cx === FX0 ? cx + 58 + r() * 14 : cx - 58 - r() * 14;
    L.ay = cy === FY0 ? cy + 58 + r() * 14 : cy - 58 - r() * 14;
    L.wallSides[cx === FX0 ? 2 : 3] = 1;
    L.wallSides[cy === FY0 ? 0 : 1] = 1;
  } else if (mode === "wall") {
    const side = (r() * 4) | 0;
    const d = 54 + r() * 12;
    L.wallSides[side] = 1;
    if (side === 0) { L.ay = FY0 + d; L.ax = FX0 + 120 + r() * (FX1 - FX0 - 240); }
    else if (side === 1) { L.ay = FY1 - d; L.ax = FX0 + 120 + r() * (FX1 - FX0 - 240); }
    else if (side === 2) { L.ax = FX0 + d; L.ay = FY0 + 110 + r() * (FY1 - FY0 - 220); }
    else { L.ax = FX1 - d; L.ay = FY0 + 110 + r() * (FY1 - FY0 - 220); }
  } else {
    L.ax = W * 0.5 + (r() - 0.5) * 260;
    L.ay = H * 0.5 + (r() - 0.5) * 170;
    L.ax = clamp(L.ax, FX0 + 100, FX1 - 100);
    L.ay = clamp(L.ay, FY0 + 90, FY1 - 90);
  }

  function addSolid(kind: SolidKind, sx: number, sy: number, s: number, rot: number): Solid {
    const sd: Solid = { kind: kind, x: sx, y: sy, s: s, rot: rot, parts: SHAPES[kind], seed: r() };
    L.solids.push(sd);
    return sd;
  }
  function rockClear(rx: number, ry: number, minFromAnimal: number): boolean {
    if (dist2(rx, ry, L.ax, L.ay) < minFromAnimal * minFromAnimal) return false;
    if (rx < FX0 + 56 || rx > FX1 - 56 || ry < FY0 + 46 || ry > FY1 - 46) return false;
    for (let m = 0; m < L.solids.length; m++) {
      if (dist2(rx, ry, L.solids[m].x, L.solids[m].y) < 92 * 92) return false;
    }
    return true;
  }
  // the last placed rock must either seal against the animal's no-draw
  // circle (the line simply ties to it - dead-end pockets at its shoulders
  // are fine) or leave a corridor wide enough to draw through: never a
  // passage the stroke cannot fit. A polar flood fill across the rock's
  // sector detects real through-passages narrower than the pen.
  function slotOK(): boolean {
    const rk = L.solids[L.solids.length - 1];
    const dir = Math.atan2(rk.y - L.ay, rk.x - L.ax);
    const NA = 40, NR = 6;                    // annulus 47..57px, +-1.1 rad
    const free: boolean[] = [];
    let tight = false;
    for (let ai = 0; ai <= NA; ai++) {
      const a = dir - 1.1 + (2.2 * ai) / NA;
      const ca = Math.cos(a), sa = Math.sin(a);
      let blkAt = -1;
      for (let ri = 0; ri < NR; ri++) {
        const w = ANIM_NODRAW + 1 + ri * 2;
        const blk = pointInSolid(L, L.ax + ca * w, L.ay + sa * w, 4);
        free[ai * NR + ri] = !blk;
        if (blk && blkAt < 0) blkAt = ri;
      }
      if (blkAt > 0) tight = true;            // free space, then rock: narrow
    }
    if (!tight) return true;                  // hugging or wide everywhere
    // narrow somewhere - reject only if the annulus can be crossed
    const seen: boolean[] = [];
    const stack: number[] = [];
    for (let ri = 0; ri < NR; ri++) if (free[ri]) { seen[ri] = true; stack.push(ri); }
    while (stack.length) {
      const c = stack.pop()!;
      const ri = c % NR;
      const nbs = [c - NR, c + NR, ri > 0 ? c - 1 : -1, ri < NR - 1 ? c + 1 : -1];
      for (let j = 0; j < 4; j++) {
        const nb = nbs[j];
        if (nb < 0 || nb >= (NA + 1) * NR || seen[nb] || !free[nb]) continue;
        seen[nb] = true; stack.push(nb);
      }
    }
    for (let ri = 0; ri < NR; ri++) if (seen[NA * NR + ri]) return false;
    return true;
  }
  // the same rule between the last solid and its neighbours (and the ponds,
  // which the pen cannot cross either): things either merge into a ridge or
  // leave real drawing room between them - never a slit the pen cannot fit
  function corridorOK(): boolean {
    const rk = L.solids[L.solids.length - 1];
    const ext = solidExtent(rk);
    function runTest(ox: number, oy: number, reach: number, other: Solid | null): boolean {
      const dx = ox - rk.x, dy = oy - rk.y;
      const dl = Math.sqrt(dx * dx + dy * dy);
      if (dl > reach) return true;
      let run = 0, maxRun = 0;
      for (let s2 = 0; s2 <= dl; s2 += 2) {
        const px = rk.x + dx * s2 / dl, py = rk.y + dy * s2 / dl;
        const hit = pointInOneSolid(rk, px, py, 4) || (other ? pointInOneSolid(other, px, py, 4) : false) ||
          pointInPond(L, px, py, 2);
        if (hit) { run = 0; continue; }
        run += 2; if (run > maxRun) maxRun = run;
      }
      return !(maxRun > 0 && maxRun < PEN_ROOM);
    }
    for (let m = 0; m < L.solids.length - 1; m++) {
      const o = L.solids[m];
      if (!runTest(o.x, o.y, ext + solidExtent(o) + 150, o)) return false;
    }
    for (let m = 0; m < L.ponds.length; m++) {
      const o = L.ponds[m];
      if (!runTest(o.x, o.y, ext + o.r * 1.2 + 150, null)) return false;
    }
    return true;
  }

  // try radii from the inside out and keep the first legal spot - anchors
  // want to hug the no-draw circle so the line can tie to them cheaply
  function placeAnchor(ang: number, s: number, ridge: boolean): boolean {
    for (let rad = 62; rad <= 98; rad += 4) {
      const rx = L.ax + Math.cos(ang) * rad;
      const ry = L.ay + Math.sin(ang) * rad;
      if (ridge) {
        if (rx < FX0 + 56 || rx > FX1 - 56 || ry < FY0 + 46 || ry > FY1 - 46) continue;
        let near = false;
        for (let m = 0; m < L.solids.length; m++) {
          if (dist2(rx, ry, L.solids[m].x, L.solids[m].y) < 56 * 56) near = true;
        }
        if (near) continue;
      } else if (!rockClear(rx, ry, 62)) continue;
      addSolid("rock", rx, ry, s, 0);
      if (!slotOK() || !corridorOK() || pointInSolid(L, L.ax, L.ay, 44)) { L.solids.pop(); continue; }
      return true;
    }
    return false;
  }

  // ---- anchor rocks: the posts the player ties the line to ----
  if (n >= 2 && mode === "rocks") {
    // a rock ridge hugging the animal: it closes most of the circle by
    // itself and leaves one opening for the player to shut with a single
    // short arc - the only affordable seal away from the fence
    const ridgeBase = r() * 6.28;
    const stepA = 1.0 + r() * 0.25;
    for (k = 0; k < 4; k++) {
      for (t2 = 0; t2 < 8; t2++) {
        const ang = ridgeBase + k * stepA + (r() - 0.5) * 0.3;
        const s = 0.8 + r() * 0.25;
        // closest legal radius first, so the rock hugs the no-draw circle
        // whenever the geometry allows it
        if (placeAnchor(ang, s, true)) break;
      }
    }
  } else if (n >= 2) {
    const anchors = mode === "corner" ? 2 : 3;
    const base = r() * 6.28;
    for (k = 0; k < anchors; k++) {
      for (t2 = 0; t2 < 8; t2++) {
        const ang = base + k * (6.28 / anchors) + (r() - 0.5) * 0.8;
        const s = 0.8 + r() * 0.25;
        if (placeAnchor(ang, s, false)) break;
      }
    }
  }

  // ---- fence gaps: at least one opposing pair, so one short line cannot
  //      cover them all ----
  const want = gapCount(n), sidesUsed: Record<number, number> = {};
  let tries = 0;
  const order: number[] = [];
  const free: number[] = [];
  for (i = 0; i < 4; i++) if (!L.wallSides[i]) free.push(i);
  const sides = free.length === 0 ? [0, 1, 2, 3] : free;
  const s0 = sides[(r() * sides.length) | 0];
  order.push(s0);
  if (want >= 2) order.push(s0 ^ 1);
  if (want >= 3) order.push((s0 + 2) % 4);
  if (want >= 4) order.push(((s0 + 2) % 4) ^ 1);
  const gw0 = clamp(112 - n * 2.2, 58, 112);
  while (L.gaps.length < want && tries++ < 160) {
    const gside = L.gaps.length < order.length ? order[L.gaps.length] : ((r() * 4) | 0);
    if ((sidesUsed[gside] || 0) >= 2) { if (L.gaps.length < order.length) return fail(L); continue; }
    const gw = gw0 + r() * 20;
    let lo, hi;
    if (gside < 2) { lo = FX0 + 46; hi = FX1 - 46 - gw; }
    else { lo = FY0 + 46; hi = FY1 - 46 - gw; }
    if (hi <= lo) continue;
    const ga = lo + r() * (hi - lo);
    let clash = false;
    for (i = 0; i < L.gaps.length; i++) {
      const q = L.gaps[i];
      if (q.side === gside && ga < q.b + 40 && ga + gw > q.a - 40) { clash = true; break; }
    }
    if (clash) continue;
    sidesUsed[gside] = (sidesUsed[gside] || 0) + 1;
    L.gaps.push({ side: gside, a: ga, b: ga + gw });
  }
  if (L.gaps.length < want) return fail(L);

  // ---- ponds: no drawing, but the bees fly straight over them ----
  if (n >= 2) {
    const nPonds = 1 + (n >= 6 ? 1 : 0) + (n >= 14 ? 1 : 0);
    for (let pI = 0; pI < nPonds; pI++) {
      for (let t3 = 0; t3 < 26; t3++) {
        const px2 = FX0 + 90 + r() * (FX1 - FX0 - 180);
        const py2 = FY0 + 80 + r() * (FY1 - FY0 - 160);
        const prad = 50 + Math.min(32, n * 1.2) + r() * 18;
        if (dist2(px2, py2, L.ax, L.ay) < (prad + 96) * (prad + 96)) continue;
        let bad2 = false;
        for (let m2 = 0; m2 < L.solids.length; m2++) {
          const e2 = solidExtent(L.solids[m2]) + prad + 40;
          if (dist2(px2, py2, L.solids[m2].x, L.solids[m2].y) < e2 * e2) bad2 = true;
        }
        for (let m3 = 0; m3 < L.ponds.length; m3++) if (dist2(px2, py2, L.ponds[m3].x, L.ponds[m3].y) < (prad + L.ponds[m3].r + 40) * (prad + L.ponds[m3].r + 40)) bad2 = true;
        if (bad2) continue;
        const radii = [];
        for (let q2 = 0; q2 < 12; q2++) radii.push(prad * (0.76 + r() * 0.42));
        L.ponds.push({ x: px2, y: py2, r: prad, radii: radii });
        break;
      }
    }
  }

  // ---- clutter: the hard part of a level is where you can still draw ----
  // Everything solid blocks the bees and the pen; what grows with the level
  // is the count, never the size. Things keep a sensible distance from the
  // animal (the guard's rings need room), the fence and the gap mouths, and
  // never leave a slit between them that the pen cannot fit through.
  // distance from a point to the nearest fence gap (the bees' doors stay open)
  function gapDist(px: number, py: number): number {
    let best = INF;
    for (let gI = 0; gI < L.gaps.length; gI++) {
      const gq = L.gaps[gI];
      let d;
      if (gq.side < 2) {
        const fy = gq.side === 0 ? FY0 : FY1;
        const cx = clamp(px, gq.a, gq.b);
        d = Math.sqrt(dist2(px, py, cx, fy));
      } else {
        const fx = gq.side === 2 ? FX0 : FX1;
        const cy = clamp(py, gq.a, gq.b);
        d = Math.sqrt(dist2(px, py, fx, cy));
      }
      if (d < best) best = d;
    }
    return best;
  }
  function solidFits(sd: Solid, minFromAnimal: number): boolean {
    if (!inField(sd.x, sd.y, 30)) return false;
    // boundary samples of every part: clear of the animal's ring zone, the
    // ponds and the gaps; and either well clear of the fence or merged into
    // it - never a slit along the rails that the bees fit through and the
    // pen does not
    const ca = Math.cos(sd.rot), sa = Math.sin(sd.rot);
    let nearFence = false, mergedFence = false;
    for (let j = 0; j < sd.parts.length; j++) {
      const sh = sd.parts[j];
      for (let q = 0; q < 16; q++) {
        const a = q / 16 * Math.PI * 2;
        const lx = (sh[0] + Math.cos(a) * sh[2]) * sd.s, ly = (sh[1] + Math.sin(a) * sh[3]) * sd.s;
        const px = sd.x + lx * ca - ly * sa, py = sd.y + lx * sa + ly * ca;
        if (dist2(px, py, L.ax, L.ay) < minFromAnimal * minFromAnimal) return false;
        if (pointInPond(L, px, py, 30)) return false;
        if (gapDist(px, py) < 48) return false;
        if (!inField(px, py, 26)) {
          nearFence = true;
          if (!inField(px, py, 12)) mergedFence = true;
        }
      }
    }
    if (nearFence && !mergedFence) return false;
    // no solid swallows another's centre (ridges may touch, not nest)
    for (let m = 0; m < L.solids.length; m++) {
      const o = L.solids[m];
      if (o === sd) continue;
      if (pointInOneSolid(sd, o.x, o.y, 10) || pointInOneSolid(o, sd.x, sd.y, 10)) return false;
    }
    return true;
  }
  function scatter(kind: SolidKind, count: number, sMin: number, sMax: number, spin: number,
                   minFromAnimal: number, triesEach: number): void {
    for (k = 0; k < count; k++) {
      for (t2 = 0; t2 < triesEach; t2++) {
        x = FX0 + 40 + r() * (FX1 - FX0 - 80);
        y = FY0 + 36 + r() * (FY1 - FY0 - 72);
        const s = sMin + r() * (sMax - sMin);
        const rot = spin ? (r() - 0.5) * 2 * spin : 0;
        const sd = addSolid(kind, x, y, s, rot);
        if (!solidFits(sd, minFromAnimal) || !corridorOK()) { L.solids.pop(); continue; }
        break;
      }
    }
  }
  if (n <= 1) {
    scatter("rock", 1 + (r() < 0.5 ? 1 : 0), 0.75, 1.2, 0, 150, 16);
    scatter("tree", 1, 0.9, 1.1, 0, 150, 10);
  } else {
    const nMount = 1 + (n >= 8 ? 1 : 0) + (n >= 16 ? 1 : 0);
    const nLogs = Math.min(5, Math.floor((n - 1) / 3));
    const nRocks = Math.min(10, 1 + Math.floor(n * 0.5));
    const nTrees = Math.min(14, 2 + Math.floor(n * 0.7));
    const nHoney = (n >= 4 ? 1 : 0) + (n >= 12 ? 1 : 0);
    scatter("mountain", nMount, 0.8, 0.95, 0.4, 118, 40);
    scatter("log", nLogs, 0.9, 1.2, Math.PI, 112, 24);
    scatter("rock", nRocks, 0.75, 1.15, 0, 112, 18);
    scatter("honey", nHoney, 1, 1, 0, 120, 18);
    scatter("tree", nTrees, 0.85, 1.2, 0, 108, 14);
  }

  // ---- bees: every one of them fast, each with its own speed ----
  const beeCount = n <= 1 ? 3 : clamp(3 + Math.round(n * 0.62), 4, 15);
  for (let b = 0; b < beeCount; b++) {
    const gp = L.gaps[b % L.gaps.length];
    L.bees.push({
      gap: gp, spd: BEE_SPD_MIN + r() * (BEE_SPD_MAX - BEE_SPD_MIN),
      phase: r() * 6.28, delay: r() * 0.7, off: (r() - 0.5)
    });
  }

  // ---- the animal must stand on clear ground ----
  if (pointInPond(L, L.ax, L.ay, 50) || pointInSolid(L, L.ax, L.ay, 44)) return fail(L);

  // ---- the bees must be a real threat: an empty field has to be a loss ----
  const arr0 = gridFor(L);
  const dA = distField(arr0, L.ax, L.ay);
  let soonest = INF;
  for (i = 0; i < L.gaps.length; i++) {
    const gin = gapInner(L.gaps[i]);
    const gc = cellOf(gin.x, gin.y);
    if (dA[gc] >= INF) continue;
    const travel = dA[gc] * CELL * 1.2 / (BEE_SPEED * BEE_SPD_MAX);
    if (travel < soonest) soonest = travel;
  }
  if (soonest + 0.8 > L.time) return fail(L);   // the bees could never make it

  // ---- ink budget ----
  const ringCost = ringSealCost(L);
  if (ringCost === 0 || ringCost === INF) { L.seal = INF; return fail(L); }
  const seal = ringCost;
  L.seal = seal;
  if (n <= 1) {
    // the easy level: enough ink to simply loop around the animal
    L.ink = Math.round(ENC_COST * 1.15);
  } else {
    // the budget follows the layout's verified seal cost - a comfortable
    // margin early that tightens with the levels (plus a quarter on top:
    // the rope needs slack to hug the obstacles that brace it)
    const m = clamp(1.5 - (n - 3) * 0.02, 1.24, 1.5) * 1.25;
    L.ink = Math.round(Math.max(seal * m, seal * 1.12));
  }
  return L;
}

// a fresh layout every call: the level number sets the numbers, the seed
// sets the shape
export function genLevel(level: number): Level {
  const base = (Math.random() * 2147483647) | 0;
  let attempt = 0, L: Level | null = null, fallback: Level | null = null;
  while (attempt < 48) {
    L = tryGen(level, (base + attempt * 7919) | 0);
    if (L.ok) return L;
    // keep the closest miss in case no seed passes the guard
    if (L.gaps.length && L.seal > 0 && L.seal < INF &&
        (!fallback || L.seal < fallback.seal)) fallback = L;
    attempt++;
  }
  // last resort: play the cheapest layout we saw, with just enough ink to seal
  if (fallback) {
    L = fallback;
    L.ink = Math.round(Math.max(ENC_COST * 0.58, fallback.seal * 1.12) * 1.25);
    L.ok = true;
  }
  return L!;
}
