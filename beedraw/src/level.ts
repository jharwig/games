// =========================================================================
// level generation (seeded by level number) + geometry tests
// =========================================================================
import {
  W, H, FX0, FY0, FX1, FY1, CELL, GW, GH, INF, ANIM_NODRAW, HONEY_DWELL, INK_HALF
} from "./const";
import { clamp, dist2, mulberry32 } from "./util";
import { NB, cellOf, distField } from "./grid";

export interface Gap { side: number; a: number; b: number }
export interface Rock { x: number; y: number; s: number; parts: number[][] }
export interface Pond { x: number; y: number; r: number; radii: number[] }
export interface BeeSpawn { gap: Gap; fast: boolean; phase: number; delay: number; off: number }
export interface Level {
  level: number;
  ok: boolean;
  gaps: Gap[];
  rocks: Rock[];
  ponds: Pond[];
  honey: { x: number; y: number } | null;
  bees: BeeSpawn[];
  ax: number;
  ay: number;
  wallSides: Record<number, 1 | undefined>;
  time: number;
  ink: number;
  seal: number;
}

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

export function pointInRock(L: Level, x: number, y: number, pad: number): boolean {
  for (let i = 0; i < L.rocks.length; i++) {
    const rk = L.rocks[i];
    for (let j = 0; j < rk.parts.length; j++) {
      const sh = rk.parts[j];
      const cx = rk.x + sh[0] * rk.s, cy = rk.y + sh[1] * rk.s;
      const rx = sh[2] * rk.s + (pad || 0), ry = sh[3] * rk.s + (pad || 0);
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) return true;
    }
  }
  return false;
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
  if (n <= 2) return 1;
  if (n <= 4) return 2;
  if (n <= 6) return 3;
  if (n <= 9) return 4;
  if (n <= 13) return 5;
  return 6;
}

// The cheapest possible full enclosure: a ring drawn right on the edge of the
// animal's no-draw circle. From level 3 the ink budget stays below this, so a
// plain circle around the animal can never be closed - the line must be
// anchored to the fence and the rocks instead.
export const ENC_COST = 2 * Math.PI * (ANIM_NODRAW + 34);   // ring at animal + bee + margin
export const TIGHT_RING = 2 * Math.PI * (ANIM_NODRAW + 2);  // the cheapest ring that is legal at all

// ---- solvability check -------------------------------------------------
// The guard does not guess: it builds the same grid the bees walk on, draws a
// candidate line into it and asks whether any gap can still reach the animal.

function gridFor(Lv: Level): Uint8Array {
  const arr = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
      arr[gy * GW + gx] = (!inField(x, y, 8) || pointInRock(Lv, x, y, 6)) ? 1 : 0;
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
// the player is allowed to draw (not on the fence, not on a rock, not on the
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
      if (!inField(x, y, 12) || pointInRock(Lv, x, y, 4) || pointInPond(Lv, x, y, 0)) {
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

function tryGen(level: number, seed: number): Level {
  const r = mulberry32((seed * 2654435761) | 0);
  const n = level;
  const L: Level = {
    level: level, ok: true, gaps: [], rocks: [], ponds: [], honey: null, bees: [],
    ax: 0, ay: 0, wallSides: {}, time: 0, ink: 0, seal: 0
  };
  let i, k, x, y, t2;

  // survival timer: 7s early, 12s at the plateau
  L.time = Math.round(clamp(7 + (n - 1) * 0.28, 7, 12));

  // ---- where the animal stands ----
  // from level 3 it hugs a wall or a corner, so the fence can carry part of
  // the seal - a free-standing animal would need a full (unaffordable) ring
  // where the animal stands: a corner or a wall gives the line something to
  // hold on to, a rock nook makes the player work for it
  const mode = n <= 2 ? "open" : (r() < 0.55 ? "corner" : (r() < 0.78 ? "wall" : "rocks"));
  L.wallSides = {};
  if (mode === "corner") {
    const cx = r() < 0.5 ? FX0 : FX1, cy = r() < 0.5 ? FY0 : FY1;
    L.ax = cx === FX0 ? cx + 54 + r() * 10 : cx - 54 - r() * 10;
    L.ay = cy === FY0 ? cy + 54 + r() * 10 : cy - 54 - r() * 10;
    L.wallSides[cx === FX0 ? 2 : 3] = 1;
    L.wallSides[cy === FY0 ? 0 : 1] = 1;
  } else if (mode === "wall") {
    const side = (r() * 4) | 0;
    const d = 54 + r() * 10;
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

  function addRock(rx: number, ry: number, s: number): void {
    L.rocks.push({ x: rx, y: ry, s: s, parts: [[-26, 6, 22, 16], [6, 4, 26, 20], [-6, -10, 18, 13]] });
  }
  function rockClear(rx: number, ry: number, minFromAnimal: number): boolean {
    if (dist2(rx, ry, L.ax, L.ay) < minFromAnimal * minFromAnimal) return false;
    if (rx < FX0 + 56 || rx > FX1 - 56 || ry < FY0 + 46 || ry > FY1 - 46) return false;
    for (let m = 0; m < L.rocks.length; m++) {
      if (dist2(rx, ry, L.rocks[m].x, L.rocks[m].y) < 92 * 92) return false;
    }
    return true;
  }

  // ---- anchor rocks: the posts the player ties the line to ----
  if (n >= 3) {
    const anchors = mode === "rocks" ? 4 : (mode === "corner" ? 2 : 3);
    const base = r() * 6.28;
    for (k = 0; k < anchors; k++) {
      for (t2 = 0; t2 < 18; t2++) {
        const ang = base + k * (6.28 / anchors) + (r() - 0.5) * 0.8;
        const rad = 78 + r() * 20;
        x = L.ax + Math.cos(ang) * rad;
        y = L.ay + Math.sin(ang) * rad;
        if (!rockClear(x, y, 74)) continue;
        addRock(x, y, 0.8 + r() * 0.25);
        break;
      }
    }
  }

  // ---- a couple of scenery rocks further out ----
  const nRocks = (r() * Math.min(3, 1 + n / 7)) | 0;
  for (k = 0; k < nRocks; k++) {
    for (t2 = 0; t2 < 16; t2++) {
      x = FX0 + 60 + r() * (FX1 - FX0 - 120);
      y = FY0 + 50 + r() * (FY1 - FY0 - 100);
      if (!rockClear(x, y, 150)) continue;
      addRock(x, y, 0.75 + r() * 0.55);
      break;
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
  if (n >= 3) {
    const nPonds = n >= 10 ? (r() < 0.6 ? 2 : 1) : 1;
    for (let pI = 0; pI < nPonds; pI++) {
      for (let t3 = 0; t3 < 26; t3++) {
        const px2 = FX0 + 90 + r() * (FX1 - FX0 - 180);
        const py2 = FY0 + 80 + r() * (FY1 - FY0 - 160);
        const prad = 50 + Math.min(32, n * 1.2) + r() * 18;
        if (dist2(px2, py2, L.ax, L.ay) < (prad + 96) * (prad + 96)) continue;
        let bad2 = false;
        for (let m2 = 0; m2 < L.rocks.length; m2++) if (dist2(px2, py2, L.rocks[m2].x, L.rocks[m2].y) < (prad + 64) * (prad + 64)) bad2 = true;
        for (let m3 = 0; m3 < L.ponds.length; m3++) if (dist2(px2, py2, L.ponds[m3].x, L.ponds[m3].y) < (prad + L.ponds[m3].r + 40) * (prad + L.ponds[m3].r + 40)) bad2 = true;
        if (bad2) continue;
        const radii = [];
        for (let q2 = 0; q2 < 12; q2++) radii.push(prad * (0.76 + r() * 0.42));
        L.ponds.push({ x: px2, y: py2, r: prad, radii: radii });
        break;
      }
    }
  }

  // ---- honey pot: the bees drink there first, so it is placed away from the
  //      gaps - it pulls the swarm around to the quiet side of the animal ----
  if (n >= 6) {
    let mx = 0, my = 0;
    for (i = 0; i < L.gaps.length; i++) {
      const gi2 = gapInner(L.gaps[i]);
      const ddx = gi2.x - L.ax, ddy = gi2.y - L.ay;
      const dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      mx += ddx / dl; my += ddy / dl;
    }
    const ml = Math.sqrt(mx * mx + my * my);
    const trap = ml > 0.3 && r() < 0.75;      // most levels put the lure opposite the gaps
    for (let t4 = 0; t4 < 34; t4++) {
      let hx, hy;
      if (trap) {
        const hang = Math.atan2(-my / ml, -mx / ml) + (r() - 0.5) * 1.1;
        const hrad = 150 + r() * 90;
        hx = L.ax + Math.cos(hang) * hrad;
        hy = L.ay + Math.sin(hang) * hrad;
      } else {
        hx = FX0 + 70 + r() * (FX1 - FX0 - 140);
        hy = FY0 + 60 + r() * (FY1 - FY0 - 120);
      }
      if (hx < FX0 + 46 || hx > FX1 - 46 || hy < FY0 + 44 || hy > FY1 - 44) continue;
      if (dist2(hx, hy, L.ax, L.ay) < 130 * 130) continue;
      if (pointInPond(L, hx, hy, 24) || pointInRock(L, hx, hy, 24)) continue;
      L.honey = { x: hx, y: hy };
      break;
    }
  }

  // ---- bees ----
  const beeCount = n <= 2 ? (3 + (r() < 0.5 ? 0 : 1)) : clamp(3 + Math.round(n * 0.62), 4, 15);
  const fastChance = n >= 6 ? clamp((n - 5) * 0.07, 0, 0.5) : 0;
  for (let b = 0; b < beeCount; b++) {
    const gp = L.gaps[b % L.gaps.length];
    L.bees.push({ gap: gp, fast: r() < fastChance, phase: r() * 6.28, delay: r() * 0.7, off: (r() - 0.5) });
  }

  // ---- the animal must stand on clear ground ----
  if (pointInPond(L, L.ax, L.ay, 50) || pointInRock(L, L.ax, L.ay, 44)) return fail(L);

  // ---- the bees must be a real threat: an empty field has to be a loss ----
  const arr0 = gridFor(L);
  const dA = distField(arr0, L.ax, L.ay);
  const dH = L.honey ? distField(arr0, L.honey.x, L.honey.y) : null;
  const honeyCell = L.honey ? cellOf(L.honey.x, L.honey.y) : 0;
  let soonest = INF;
  for (i = 0; i < L.gaps.length; i++) {
    const gin = gapInner(L.gaps[i]);
    const gc = cellOf(gin.x, gin.y);
    if (dA[gc] >= INF) continue;
    let travel;
    if (dH && dH[gc] < INF && dA[honeyCell] < INF) {
      travel = (dH[gc] + dA[honeyCell]) * CELL * 1.2 / 78 + HONEY_DWELL;
    } else {
      travel = dA[gc] * CELL * 1.2 / 78;
    }
    if (travel < soonest) soonest = travel;
  }
  if (soonest + 0.8 > L.time) return fail(L);   // the bees could never make it

  // ---- ink budget ----
  const ringCost = ringSealCost(L);
  if (ringCost === 0 || ringCost === INF) { L.seal = INF; return fail(L); }
  const seal = ringCost;
  L.seal = seal;
  if (n <= 2) {
    // tutorial levels: enough ink to simply loop around the animal
    L.ink = Math.round(ENC_COST * 1.15);
  } else {
    // 58% of an enclosure down to 50% at the plateau, and always below the
    // tightest legal ring - a circle around the animal can never be closed,
    // so the line must lean on the fence and the rocks
    const frac = clamp(0.58 - (n - 3) * 0.0045, 0.50, 0.58);
    const lo2 = seal * 1.12, hi2 = TIGHT_RING * 0.95;
    if (lo2 > hi2) return fail(L);             // not sealable on this budget
    L.ink = Math.round(clamp(ENC_COST * frac, lo2, hi2));
  }
  return L;
}

export function genLevel(level: number): Level {
  let attempt = 0, L: Level | null = null, fallback: Level | null = null;
  while (attempt < 24) {
    L = tryGen(level, attempt === 0 ? level : (level * 31 + attempt) | 0);
    if (L.ok) return L;
    // keep the closest miss in case no seed passes the guard
    if (L.gaps.length && L.seal > 0 && L.seal < INF &&
        (!fallback || L.seal < fallback.seal)) fallback = L;
    attempt++;
  }
  // last resort: play the cheapest layout we saw, with just enough ink to seal
  if (fallback) {
    L = fallback;
    L.ink = Math.round(Math.min(TIGHT_RING * 0.96, Math.max(ENC_COST * 0.58, fallback.seal * 1.12)));
    L.ok = true;
  }
  return L!;
}
