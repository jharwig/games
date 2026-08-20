// =========================================================================
// smooth drawing helpers (gameplay art)
// =========================================================================
import { W, H, FX0, FY0, FX1, FY1, OUT, P, INK_HALF } from "./const";
import { mulberry32 } from "./util";
import type { Level, Gap, Solid } from "./level";

type Ctx = CanvasRenderingContext2D;

export function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function panel(c: Ctx, x: number, y: number, w: number, h: number): void {
  c.fillStyle = "rgba(10,10,16,0.75)";
  rr(c, x, y, w, h, Math.min(h / 2, 16)); c.fill();
}

// =========================================================================
// biomes - the look re-rolls with every layout; only the palette changes,
// every obstacle keeps its shape and its rules
// =========================================================================
export interface Biome {
  name: string;
  grassA: string; grassB: string;   // ground gradient, top -> bottom
  glow: string;                     // "r,g,b" of the soft light patches
  tuft: string;                     // grass tuft stroke
  flowers: string[];                // petal colours (empty: no flowers)
  flowerN: number;
  rockA: string; rockB: string;
  mountA: string; mountB: string; cap: string;
  canopyA: string; canopyB: string; trunk: string; snowy: boolean;
  logA: string; logB: string;
  waterA: string; waterB: string;
}

export const BIOMES: Biome[] = [
  { name: "meadow", grassA: "#8ed94b", grassB: "#57a82e", glow: "255,255,180", tuft: "rgba(30,90,20,0.5)",
    flowers: ["#ff6b9d", "#ffffff", "#c78bff", "#ff9d5c"], flowerN: 12,
    rockA: "#d8d8e2", rockB: "#8a8a9c", mountA: "#a2a2b4", mountB: "#555568", cap: "#f4f6ff",
    canopyA: "#5cc244", canopyB: "#2c7a22", trunk: "#6e4a2c", snowy: false,
    logA: "#a97843", logB: "#5e3e1e", waterA: "#7cc4ec", waterB: "#3577c2" },
  { name: "autumn", grassA: "#dcb54e", grassB: "#a5742a", glow: "255,220,140", tuft: "rgba(110,70,20,0.5)",
    flowers: ["#ff8c42", "#ffd166", "#e63946"], flowerN: 9,
    rockA: "#cfbca6", rockB: "#7c6852", mountA: "#8f7360", mountB: "#4a372a", cap: "#ead9bb",
    canopyA: "#f08a36", canopyB: "#a83e18", trunk: "#57391c", snowy: false,
    logA: "#8a5a2b", logB: "#46321a", waterA: "#6aa8c8", waterB: "#2c5f8a" },
  { name: "snow", grassA: "#f1f6ff", grassB: "#c4d5ea", glow: "255,255,255", tuft: "rgba(110,140,185,0.45)",
    flowers: [], flowerN: 0,
    rockA: "#ccd4e0", rockB: "#737c8c", mountA: "#8f9aaa", mountB: "#48525f", cap: "#ffffff",
    canopyA: "#3a7a55", canopyB: "#1b4630", trunk: "#4a3626", snowy: true,
    logA: "#7d5c3e", logB: "#43301f", waterA: "#a8dcf0", waterB: "#4a8fc8" },
  { name: "dusk", grassA: "#8377bf", grassB: "#3d3a7a", glow: "255,200,230", tuft: "rgba(40,20,80,0.55)",
    flowers: ["#ffd166", "#ff6b9d", "#ffffff"], flowerN: 12,
    rockA: "#a39cc2", rockB: "#514c74", mountA: "#655d8c", mountB: "#2a2549", cap: "#dcd3f7",
    canopyA: "#468a68", canopyB: "#21483a", trunk: "#3a2a3a", snowy: false,
    logA: "#74506a", logB: "#3d2a3c", waterA: "#5466c8", waterB: "#1e2a70" },
  { name: "desert", grassA: "#ebcc8e", grassB: "#c09550", glow: "255,240,200", tuft: "rgba(140,100,40,0.5)",
    flowers: ["#e63946", "#ffd166"], flowerN: 6,
    rockA: "#dd9c62", rockB: "#8a552a", mountA: "#bf7448", mountB: "#67381c", cap: "#f2cba2",
    canopyA: "#7b9a42", canopyB: "#3f5f22", trunk: "#7a5a2c", snowy: false,
    logA: "#a97843", logB: "#5e3e1e", waterA: "#5fc9c0", waterB: "#2a8a92" }
];

export function drawMeadow(c: Ctx, b: Biome, seed: number): void {
  const r = mulberry32((seed * 747796405) | 0);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, b.grassA); sky.addColorStop(1, b.grassB);
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  let i, x, y;
  for (i = 0; i < 9; i++) {
    x = r() * W; y = 60 + r() * (H - 120);
    const rg = c.createRadialGradient(x, y, 0, x, y, 90);
    rg.addColorStop(0, "rgba(" + b.glow + ",0.10)"); rg.addColorStop(1, "rgba(" + b.glow + ",0)");
    c.fillStyle = rg; c.beginPath(); c.arc(x, y, 90, 0, 7); c.fill();
  }
  c.strokeStyle = b.tuft; c.lineWidth = 2; c.lineCap = "round";
  for (i = 0; i < 80; i++) {
    x = 20 + r() * (W - 40); y = 60 + r() * (H - 110);
    c.beginPath();
    c.moveTo(x, y); c.quadraticCurveTo(x - 3, y - 7, x - 5, y - 10);
    c.moveTo(x, y); c.quadraticCurveTo(x + 1, y - 8, x + 3, y - 12);
    c.moveTo(x, y); c.quadraticCurveTo(x + 5, y - 6, x + 8, y - 9);
    c.stroke();
  }
  for (i = 0; i < b.flowerN; i++) {
    flower(c, 40 + r() * (W - 80), 70 + r() * (H - 130), b.flowers[i % b.flowers.length]);
  }
}

function flower(c: Ctx, x: number, y: number, col: string): void {
  c.fillStyle = col;
  for (let a = 0; a < 5; a++) {
    c.beginPath();
    c.arc(x + Math.cos(a * 1.257) * 5, y + Math.sin(a * 1.257) * 5, 3.4, 0, 7); c.fill();
  }
  c.fillStyle = "#ffd23e"; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill();
}

function fencePost(c: Ctx, x: number, y: number): void {
  c.fillStyle = "#a97843"; c.strokeStyle = OUT; c.lineWidth = 2.5;
  rr(c, x - 5, y - 16, 10, 32, 4); c.fill(); c.stroke();
  c.fillStyle = "#c8955c"; rr(c, x - 3, y - 14, 3, 28, 2); c.fill();
}
function fenceRail(c: Ctx, x1: number, y1: number, x2: number, y2: number): void {
  if (Math.abs(x2 - x1) + Math.abs(y2 - y1) < 6) return;
  c.strokeStyle = OUT; c.lineWidth = 9; c.lineCap = "round";
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.strokeStyle = "#a97843"; c.lineWidth = 5;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
}

function inGap(gaps: Gap[], side: number, v: number): boolean {
  for (let i = 0; i < gaps.length; i++) {
    const q = gaps[i];
    if (q.side === side && v >= q.a && v <= q.b) return true;
  }
  return false;
}

export function drawFence(c: Ctx, L: Level): void {
  let spans, i, s;
  const sides = [
    { side: 0, lo: FX0 - 2, hi: FX1 + 2, fix: FY0 },
    { side: 1, lo: FX0 - 2, hi: FX1 + 2, fix: FY1 },
    { side: 2, lo: FY0, hi: FY1, fix: FX0 },
    { side: 3, lo: FY0, hi: FY1, fix: FX1 }
  ];
  for (let k = 0; k < sides.length; k++) {
    const sd = sides[k];
    spans = [];
    let cur = sd.lo;
    const gs = [];
    for (i = 0; i < L.gaps.length; i++) if (L.gaps[i].side === sd.side) gs.push(L.gaps[i]);
    gs.sort(function (a, b) { return a.a - b.a; });
    for (i = 0; i < gs.length; i++) {
      if (gs[i].a > cur) spans.push([cur, gs[i].a]);
      cur = Math.max(cur, gs[i].b);
    }
    if (cur < sd.hi) spans.push([cur, sd.hi]);
    for (i = 0; i < spans.length; i++) {
      s = spans[i];
      if (sd.side < 2) fenceRail(c, s[0], sd.fix, s[1], sd.fix);
      else fenceRail(c, sd.fix, s[0], sd.fix, s[1]);
    }
  }
  let x, y;
  for (x = FX0 + 4; x < FX1; x += 52) {
    if (!inGap(L.gaps, 0, x)) fencePost(c, x, FY0);
    if (!inGap(L.gaps, 1, x)) fencePost(c, x, FY1);
  }
  for (y = FY0 + 38; y < FY1 - 10; y += 52) {
    if (!inGap(L.gaps, 2, y)) fencePost(c, FX0, y);
    if (!inGap(L.gaps, 3, y)) fencePost(c, FX1, y);
  }
}

export function drawPonds(c: Ctx, L: Level, t: number, b: Biome): void {
  for (let i = 0; i < L.ponds.length; i++) {
    const p = L.ponds[i];
    c.save(); c.translate(p.x, p.y);
    c.beginPath();
    const pts: number[][] = [];
    let j;
    for (j = 0; j < 12; j++) {
      const a = j / 12 * Math.PI * 2 - Math.PI;
      const rad = p.radii[j] * (1 + Math.sin(t * 1.4 + j) * 0.012);
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad * 0.82]);
    }
    c.moveTo((pts[0][0] + pts[11][0]) / 2, (pts[0][1] + pts[11][1]) / 2);
    for (j = 0; j < 12; j++) {
      const cur = pts[j], nx = pts[(j + 1) % 12];
      c.quadraticCurveTo(cur[0], cur[1], (cur[0] + nx[0]) / 2, (cur[1] + nx[1]) / 2);
    }
    c.closePath();
    const pgr = c.createRadialGradient(0, -10, 10, 0, 0, p.r * 1.4);
    pgr.addColorStop(0, b.waterA); pgr.addColorStop(1, b.waterB);
    c.fillStyle = pgr; c.fill();
    c.strokeStyle = OUT; c.lineWidth = 3.5; c.stroke();
    c.save(); c.clip();
    c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 2.5; c.lineCap = "round";
    for (j = 0; j < 3; j++) {
      const yy = -p.r * 0.3 + j * p.r * 0.34 + Math.sin(t * 1.6 + j * 1.7) * 4;
      const xx = Math.sin(t * 0.9 + j) * p.r * 0.22 - p.r * 0.15;
      c.beginPath();
      c.moveTo(xx - 22, yy); c.quadraticCurveTo(xx - 6, yy - 7, xx + 12, yy);
      c.stroke();
    }
    c.restore();
    c.restore();
  }
}

// =========================================================================
// solids: rock, mountain, tree, log, honey pot. Each is drawn in its local
// frame (scaled, rotated) so the art matches the collision ellipses exactly.
// =========================================================================
function drawRock(c: Ctx, sd: Solid, b: Biome): void {
  c.strokeStyle = OUT; c.lineWidth = 3.5 / sd.s;
  for (let j = 0; j < sd.parts.length; j++) {
    const sh = sd.parts[j];
    const rg = c.createRadialGradient(sh[0] - 6, sh[1] - 8, 2, sh[0], sh[1], sh[2] + 6);
    rg.addColorStop(0, b.rockA); rg.addColorStop(1, b.rockB);
    c.fillStyle = rg;
    c.beginPath(); c.ellipse(sh[0], sh[1], sh[2], sh[3], 0, 0, 7); c.fill(); c.stroke();
  }
}

function drawMountain(c: Ctx, sd: Solid, b: Biome): void {
  // ground shadow
  c.fillStyle = "rgba(0,0,0,0.16)";
  for (let j = 0; j < sd.parts.length; j++) {
    const sh = sd.parts[j];
    c.beginPath(); c.ellipse(sh[0] + 6, sh[1] + 9, sh[2] + 2, sh[3] + 2, 0, 0, 7); c.fill();
  }
  c.strokeStyle = OUT; c.lineWidth = 4 / sd.s;
  for (let j = 0; j < sd.parts.length; j++) {
    const sh = sd.parts[j];
    const cx = sh[0], cy = sh[1], rx = sh[2], ry = sh[3];
    const rg = c.createRadialGradient(cx - rx * 0.3, cy - ry * 0.5, 4, cx, cy, rx * 1.1);
    rg.addColorStop(0, b.mountA); rg.addColorStop(1, b.mountB);
    c.fillStyle = rg;
    c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, 7); c.fill(); c.stroke();
    // a jagged ridge climbing to the peak, lit from the upper left
    c.save();
    c.beginPath(); c.ellipse(cx, cy, rx - 1, ry - 1, 0, 0, 7); c.clip();
    const px = cx - rx * 0.15, py = cy - ry * 0.95;
    c.fillStyle = "rgba(255,255,255,0.16)";
    c.beginPath();
    c.moveTo(cx - rx, cy + ry);
    c.lineTo(cx - rx * 0.55, cy - ry * 0.1);
    c.lineTo(cx - rx * 0.35, cy - ry * 0.45);
    c.lineTo(px, py);
    c.lineTo(cx + rx * 0.05, cy + ry);
    c.closePath(); c.fill();
    c.fillStyle = "rgba(0,0,0,0.22)";
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(cx + rx * 0.3, cy - ry * 0.35);
    c.lineTo(cx + rx * 0.55, cy);
    c.lineTo(cx + rx, cy + ry);
    c.lineTo(cx + rx * 0.05, cy + ry);
    c.closePath(); c.fill();
    // the cap
    c.fillStyle = b.cap;
    c.beginPath();
    c.moveTo(px - rx * 0.22, py + ry * 0.34);
    c.lineTo(px - rx * 0.12, py + ry * 0.22);
    c.lineTo(px - rx * 0.04, py + ry * 0.3);
    c.lineTo(px + rx * 0.06, py + ry * 0.16);
    c.lineTo(px + rx * 0.16, py + ry * 0.3);
    c.lineTo(px + rx * 0.26, py + ry * 0.36);
    c.lineTo(px + rx * 0.1, py - ry * 0.3);
    c.closePath(); c.fill();
    c.restore();
  }
}

function drawTree(c: Ctx, sd: Solid, b: Biome): void {
  c.fillStyle = "rgba(0,0,0,0.18)";
  c.beginPath(); c.ellipse(4, 8, 20, 13, 0, 0, 7); c.fill();
  c.strokeStyle = OUT; c.lineWidth = 3 / sd.s;
  c.fillStyle = b.trunk;
  c.beginPath(); c.arc(0, 6, 5, 0, 7); c.fill(); c.stroke();
  const cg = c.createRadialGradient(-6, -7, 2, 0, 0, 24);
  cg.addColorStop(0, b.canopyA); cg.addColorStop(1, b.canopyB);
  c.fillStyle = cg;
  c.beginPath(); c.ellipse(0, 0, 20, 17, 0, 0, 7); c.fill(); c.stroke();
  // leafy bumps
  c.fillStyle = "rgba(255,255,255,0.14)";
  const k = sd.seed * 6.28;
  for (let j = 0; j < 3; j++) {
    c.beginPath(); c.arc(Math.cos(k + j * 2.1) * 8 - 3, Math.sin(k + j * 2.1) * 6 - 4, 5, 0, 7); c.fill();
  }
  if (b.snowy) {
    c.fillStyle = "#ffffff";
    c.beginPath(); c.ellipse(-2, -8, 12, 5, -0.2, 0, 7); c.fill();
  }
}

function drawLog(c: Ctx, sd: Solid, b: Biome): void {
  c.fillStyle = "rgba(0,0,0,0.18)";
  rr(c, -50, -4, 104, 20, 9); c.fill();
  c.strokeStyle = OUT; c.lineWidth = 3 / sd.s;
  const lg = c.createLinearGradient(0, -9, 0, 9);
  lg.addColorStop(0, b.logA); lg.addColorStop(1, b.logB);
  c.fillStyle = lg;
  rr(c, -52, -9, 104, 18, 8); c.fill(); c.stroke();
  c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 1.6;
  for (let j = 0; j < 4; j++) {
    const yy = -5 + j * 3.4;
    c.beginPath(); c.moveTo(-40 + j * 6, yy); c.lineTo(30 - j * 4, yy + 0.8); c.stroke();
  }
  // cut end with rings
  c.strokeStyle = OUT; c.lineWidth = 3 / sd.s;
  c.fillStyle = "#e2c28c";
  c.beginPath(); c.ellipse(50, 0, 6, 9, 0, 0, 7); c.fill(); c.stroke();
  c.strokeStyle = "rgba(90,60,20,0.6)"; c.lineWidth = 1.4;
  c.beginPath(); c.ellipse(50, 0, 3.5, 5.5, 0, 0, 7); c.stroke();
  c.beginPath(); c.ellipse(50, 0, 1.5, 2.5, 0, 0, 7); c.stroke();
}

function drawHoney(c: Ctx): void {
  c.strokeStyle = OUT; c.lineWidth = 3;
  c.fillStyle = "rgba(0,0,0,0.15)";
  c.beginPath(); c.ellipse(0, 26, 20, 6, 0, 0, 7); c.fill();
  const hg = c.createLinearGradient(0, -16, 0, 22);
  hg.addColorStop(0, "#ffc84e"); hg.addColorStop(1, "#d88a12");
  c.fillStyle = hg;
  c.beginPath();
  c.moveTo(-16, -8); c.bezierCurveTo(-24, 4, -20, 20, 0, 22);
  c.bezierCurveTo(20, 20, 24, 4, 16, -8); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = "#8a5a2b"; rr(c, -14, -16, 28, 9, 4); c.fill(); c.stroke();
  c.fillStyle = "#ffdf8a";
  c.beginPath(); c.moveTo(-8, -7); c.bezierCurveTo(-8, 2, -2, 0, -2, -7); c.closePath(); c.fill();
  c.fillStyle = "rgba(255,255,255,0.5)";
  c.beginPath(); c.ellipse(-8, 2, 4, 7, -0.4, 0, 7); c.fill();
}

export function drawSolids(c: Ctx, L: Level, b: Biome): void {
  // back to front so the big things overlap naturally
  const order = L.solids.slice().sort(function (p, q) { return p.y - q.y; });
  for (let i = 0; i < order.length; i++) {
    const sd = order[i];
    c.save(); c.translate(sd.x, sd.y); c.rotate(sd.rot); c.scale(sd.s, sd.s);
    if (sd.kind === "rock") drawRock(c, sd, b);
    else if (sd.kind === "mountain") drawMountain(c, sd, b);
    else if (sd.kind === "tree") drawTree(c, sd, b);
    else if (sd.kind === "log") drawLog(c, sd, b);
    else drawHoney(c);
    c.restore();
  }
}

// =========================================================================
// the ink line / the rope
// =========================================================================
// While the finger is down the line is just ink. Once it has fallen it is a
// rope: every segment is either braced (pressed against something solid or
// the fence - it never moves) or loose, and a loose segment may be lifted.
export interface RopeView {
  seg: Uint8Array;        // per segment: 0 braced, 1 loose
  lift: Float32Array;     // per segment: 0 on the ground .. 1 held up
  fall: number;           // 0 just released (in the air) .. 1 landed
}

export function drawInk(c: Ctx, stroke: { x: number; y: number }[], drawing: boolean,
                        rope: RopeView | null): void {
  if (stroke.length < 2) {
    if (stroke.length === 1 && drawing) {
      c.fillStyle = P.ink;
      c.beginPath(); c.arc(stroke[0].x, stroke[0].y, INK_HALF, 0, 7); c.fill();
    }
    return;
  }
  c.lineCap = "round"; c.lineJoin = "round";
  if (!rope) {
    const path = function (): void {
      c.beginPath();
      c.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) c.lineTo(stroke[i].x, stroke[i].y);
    };
    c.strokeStyle = "rgba(0,0,0,0.18)"; c.lineWidth = 14; path(); c.stroke();
    c.strokeStyle = P.ink; c.lineWidth = 10; path(); c.stroke();
    c.strokeStyle = P.inkHi; c.lineWidth = 3.5; path(); c.stroke();
    if (drawing) {
      const e = stroke[stroke.length - 1];
      c.fillStyle = "#ffffff"; c.beginPath(); c.arc(e.x, e.y, 9, 0, 7); c.fill();
      c.strokeStyle = P.ink; c.lineWidth = 3.5; c.beginPath(); c.arc(e.x, e.y, 9, 0, 7); c.stroke();
      c.fillStyle = P.ink; c.beginPath(); c.arc(e.x, e.y, 3.5, 0, 7); c.fill();
    }
    return;
  }

  // the rope: height above the ground per point (the average of its segments)
  const n = stroke.length;
  const air = (1 - rope.fall) * 10;
  const hAt = function (i: number): number {
    const a = i > 0 ? rope.lift[i - 1] : rope.lift[0];
    const b = i < n - 1 ? rope.lift[i] : rope.lift[n - 2];
    return air + Math.max(a, b) * 9;
  };
  const kindAt = function (i: number): number {      // per point: 1 if any touching segment is loose
    const a = i > 0 ? rope.seg[i - 1] : rope.seg[0];
    const b = i < n - 1 ? rope.seg[i] : rope.seg[n - 2];
    return Math.max(a, b);
  };
  // ground shadow of everything that is off the ground
  c.strokeStyle = "rgba(0,0,0,0.2)"; c.lineWidth = 12;
  c.beginPath();
  let open = false;
  for (let i = 0; i < n; i++) {
    const h = hAt(i);
    const sx = stroke[i].x + 2 + h * 0.5, sy = stroke[i].y + 3 + h * 0.4;
    if (h < 0.3 && kindAt(i) === 0) { open = false; continue; }
    if (!open) { c.moveTo(sx, sy); open = true; } else c.lineTo(sx, sy);
  }
  c.stroke();
  // the rope body, in runs of the same kind
  const drawRun = function (i0: number, i1: number, loose: boolean): void {
    const body = loose ? "#3f3f92" : "#232360";
    const hi = loose ? "#8585dc" : P.inkHi;
    const path = function (): void {
      c.beginPath();
      for (let i = i0; i <= i1; i++) {
        const h = hAt(i);
        if (i === i0) c.moveTo(stroke[i].x, stroke[i].y - h); else c.lineTo(stroke[i].x, stroke[i].y - h);
      }
    };
    c.strokeStyle = OUT; c.lineWidth = 12.5; path(); c.stroke();
    c.strokeStyle = body; c.lineWidth = 10; path(); c.stroke();
    c.strokeStyle = hi; c.lineWidth = 3.5; path(); c.stroke();
    if (!loose) {
      // anchored stretches get little stitch marks so the reveal reads
      c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 2;
      let acc = 0;
      for (let i = i0 + 1; i <= i1; i++) {
        const a = stroke[i - 1], b = stroke[i];
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
        acc += len;
        if (acc < 14) continue;
        acc = 0;
        const nx = -dy / len * 4, ny = dx / len * 4;
        c.beginPath(); c.moveTo(b.x - nx, b.y - ny - hAt(i)); c.lineTo(b.x + nx, b.y + ny - hAt(i)); c.stroke();
      }
    }
  };
  let runStart = 0;
  for (let i = 1; i < n - 1; i++) {
    if (rope.seg[i] !== rope.seg[i - 1]) { drawRun(runStart, i, rope.seg[i - 1] === 1); runStart = i; }
  }
  drawRun(runStart, n - 1, rope.seg[n - 2] === 1);
}

// =========================================================================
// cartoon bee - heat 0..1 is how fast it is (yellow .. hot orange)
// =========================================================================
function mix(a: number[], b: number[], t: number): string {
  return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," + Math.round(a[1] + (b[1] - a[1]) * t) + "," +
    Math.round(a[2] + (b[2] - a[2]) * t) + ")";
}
export function drawBee(c: Ctx, x: number, y: number, s: number, flip: boolean,
                        heat: number, wob: number): void {
  const flap = Math.sin(wob * 3.4) * 0.5 + 0.6;
  c.save();
  c.translate(x, y + Math.sin(wob) * 2);
  c.scale(flip ? -s : s, s);
  c.strokeStyle = OUT; c.lineWidth = 2.5 / s;
  // wings
  c.fillStyle = heat > 0.6 ? "rgba(255,220,220,0.55)" : "rgba(230,245,255,0.8)";
  c.save(); c.translate(-2, -13); c.scale(1, flap);
  c.beginPath(); c.ellipse(0, 0, 7, 10, -0.5, 0, 7); c.fill(); c.stroke(); c.restore();
  c.save(); c.translate(7, -12); c.scale(1, flap * 0.9);
  c.beginPath(); c.ellipse(0, 0, 6, 8, 0.4, 0, 7); c.fill(); c.stroke(); c.restore();
  // body
  const bg = c.createLinearGradient(0, -10, 0, 10);
  bg.addColorStop(0, mix([255, 224, 106], [255, 170, 90], heat));
  bg.addColorStop(1, mix([240, 168, 0], [220, 80, 16], heat));
  c.fillStyle = bg;
  c.beginPath(); c.ellipse(0, 0, 15, 11, 0, 0, 7); c.fill(); c.stroke();
  c.save(); c.beginPath(); c.ellipse(0, 0, 15, 11, 0, 0, 7); c.clip();
  c.fillStyle = "#2a2a2a";
  c.fillRect(-4, -12, 6, 24); c.fillRect(6, -12, 6, 24);
  c.restore();
  c.beginPath(); c.ellipse(0, 0, 15, 11, 0, 0, 7); c.stroke();
  // stinger
  c.fillStyle = "#2a2a2a";
  c.beginPath(); c.moveTo(14, -2); c.lineTo(21, 0); c.lineTo(14, 3); c.closePath(); c.fill();
  // face
  c.fillStyle = "#ffffff"; c.beginPath(); c.arc(-8, -3, 3.4, 0, 7); c.fill();
  c.fillStyle = "#2a1a08"; c.beginPath(); c.arc(-8.7, -3, 1.8, 0, 7); c.fill();
  c.strokeStyle = "#2a1a08"; c.lineWidth = 1.6 / s;
  c.beginPath(); c.arc(-9, 2, 3, 0.4, 2.2); c.stroke();
  c.restore();
}

// =========================================================================
// cartoon animals - kind 0 dog, 1 cat, 2 cow, 3 hen, 4 horse
// mood 0 calm, 1 happy, 2 dizzy
// =========================================================================
function eyes(c: Ctx, mood: number, lx: number, rx: number, ey: number, t: number): void {
  if (mood === 2) {                      // dizzy spirals
    c.strokeStyle = "#2a1a08"; c.lineWidth = 2;
    for (let s = 0; s < 2; s++) {
      const cx = s === 0 ? lx : rx;
      c.beginPath();
      for (let a = 0; a < 14; a++) {
        const ang = a * 0.62 + t * 3, rad = a * 0.42;
        const px2 = cx + Math.cos(ang) * rad, py2 = ey + Math.sin(ang) * rad;
        if (a === 0) c.moveTo(px2, py2); else c.lineTo(px2, py2);
      }
      c.stroke();
    }
    return;
  }
  if (mood === 1) {                      // happy ^ ^
    c.strokeStyle = "#2a1a08"; c.lineWidth = 3; c.lineCap = "round";
    c.beginPath(); c.arc(lx, ey + 2, 5, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    c.beginPath(); c.arc(rx, ey + 2, 5, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    return;
  }
  c.fillStyle = "#ffffff";
  c.beginPath(); c.arc(lx, ey, 5.5, 0, 7); c.fill();
  c.beginPath(); c.arc(rx, ey, 5.5, 0, 7); c.fill();
  c.fillStyle = "#2a1a08";
  c.beginPath(); c.arc(lx + 1, ey + 1, 3, 0, 7); c.fill();
  c.beginPath(); c.arc(rx + 1, ey + 1, 3, 0, 7); c.fill();
  c.fillStyle = "#fff";
  c.beginPath(); c.arc(lx - 0.5, ey - 1.5, 1.3, 0, 7); c.fill();
  c.beginPath(); c.arc(rx - 0.5, ey - 1.5, 1.3, 0, 7); c.fill();
}

export function drawAnimal(c: Ctx, kind: number, x: number, y: number, s: number,
                           t: number, mood: number): void {
  let breathe = 1 + Math.sin(t * 2.2) * 0.03;
  let bob = Math.sin(t * 2.2) * 2;
  if (mood === 1) { breathe = 1 + Math.abs(Math.sin(t * 7)) * 0.09; bob = -Math.abs(Math.sin(t * 7)) * 9; }
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.strokeStyle = OUT; c.lineWidth = 3.5;
  c.fillStyle = "rgba(0,0,0,0.15)";
  c.beginPath(); c.ellipse(0, 44, 34, 8, 0, 0, 7); c.fill();
  c.translate(0, bob);
  c.save();
  c.scale(1 / breathe, breathe);

  let body1, body2, dark, muzzle;
  if (kind === 0) { body1 = "#c08a55"; body2 = "#96662f"; dark = "#7c522f"; muzzle = "#e8cfa8"; }
  else if (kind === 1) { body1 = "#a8a8b8"; body2 = "#7e7e90"; dark = "#6a6a7c"; muzzle = "#e6e6ee"; }
  else if (kind === 2) { body1 = "#fbfbf6"; body2 = "#dcdcd4"; dark = "#33333a"; muzzle = "#f0b6c6"; }
  else if (kind === 3) { body1 = "#fbf7ea"; body2 = "#e6dcc0"; dark = "#e04b3a"; muzzle = "#f0a028"; }
  else { body1 = "#96683e"; body2 = "#6e4a2c"; dark = "#3f2a17"; muzzle = "#b98a5e"; }

  const bg = c.createLinearGradient(0, -40, 0, 44);
  bg.addColorStop(0, body1); bg.addColorStop(1, body2);

  // ---- body ----
  c.fillStyle = bg;
  c.beginPath(); c.ellipse(0, 20, 26, 24, 0, 0, 7); c.fill(); c.stroke();

  // ---- tail ----
  if (kind === 0) {
    c.beginPath(); c.moveTo(22, 18); c.quadraticCurveTo(42, 10, 40, -4);
    c.quadraticCurveTo(48, 10, 26, 26); c.closePath(); c.fill(); c.stroke();
  } else if (kind === 1) {
    c.beginPath(); c.moveTo(22, 24);
    c.quadraticCurveTo(46, 22 + Math.sin(t * 3) * 6, 40, -2);
    c.quadraticCurveTo(52, 18 + Math.sin(t * 3) * 6, 26, 32);
    c.closePath(); c.fill(); c.stroke();
  } else if (kind === 2 || kind === 4) {
    c.strokeStyle = OUT; c.lineWidth = 5;
    c.beginPath(); c.moveTo(24, 8); c.quadraticCurveTo(40, 14, 38, 30); c.stroke();
    c.fillStyle = dark;
    c.beginPath(); c.ellipse(38, 33, 5, 8, 0, 0, 7); c.fill();
    c.lineWidth = 3.5; c.stroke();
    c.fillStyle = bg;
  }

  // ---- paws / feet ----
  if (kind === 3) {
    c.strokeStyle = OUT; c.lineWidth = 4;
    c.beginPath(); c.moveTo(-9, 40); c.lineTo(-9, 47); c.moveTo(9, 40); c.lineTo(9, 47); c.stroke();
    c.fillStyle = "#f0a028"; c.lineWidth = 3;
    c.beginPath(); c.ellipse(-10, 48, 7, 3.5, 0, 0, 7); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(10, 48, 7, 3.5, 0, 0, 7); c.fill(); c.stroke();
    c.lineWidth = 3.5;
  } else {
    c.fillStyle = kind === 2 ? dark : body2;
    c.beginPath(); c.ellipse(-12, 40, 8, 6, 0, 0, 7); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(12, 40, 8, 6, 0, 0, 7); c.fill(); c.stroke();
  }

  // ---- cow patches / hen wing ----
  if (kind === 2) {
    c.save();
    c.beginPath(); c.ellipse(0, 20, 26, 24, 0, 0, 7); c.clip();
    c.fillStyle = dark;
    c.beginPath(); c.ellipse(-14, 14, 11, 9, 0.4, 0, 7); c.fill();
    c.beginPath(); c.ellipse(12, 30, 9, 7, -0.3, 0, 7); c.fill();
    c.restore();
    c.fillStyle = bg;
    c.beginPath(); c.ellipse(0, 20, 26, 24, 0, 0, 7); c.stroke();
  }
  if (kind === 3) {
    c.fillStyle = body2;
    c.beginPath(); c.ellipse(-12, 20, 12, 14, 0.3, 0, 7); c.fill(); c.stroke();
    c.strokeStyle = OUT; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-18, 22); c.quadraticCurveTo(-12, 26, -6, 24); c.stroke();
    c.lineWidth = 3.5;
  }

  // ---- head ----
  c.fillStyle = bg;
  if (kind === 4) {
    c.beginPath(); c.ellipse(0, -20, 20, 24, 0, 0, 7); c.fill(); c.stroke();
  } else {
    c.beginPath(); c.arc(0, -20, 24, 0, 7); c.fill(); c.stroke();
  }

  // ---- ears / horns / comb ----
  if (kind === 0) {
    c.fillStyle = dark;
    c.beginPath(); c.moveTo(-20, -34); c.quadraticCurveTo(-34, -24, -26, -4);
    c.quadraticCurveTo(-18, -8, -14, -24); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(20, -34); c.quadraticCurveTo(34, -24, 26, -4);
    c.quadraticCurveTo(18, -8, 14, -24); c.closePath(); c.fill(); c.stroke();
  } else if (kind === 1) {
    c.fillStyle = body2;
    c.beginPath(); c.moveTo(-22, -32); c.lineTo(-16, -52); c.lineTo(-4, -38); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(22, -32); c.lineTo(16, -52); c.lineTo(4, -38); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = "#f0b6c6";
    c.beginPath(); c.moveTo(-19, -34); c.lineTo(-16, -46); c.lineTo(-9, -37); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(19, -34); c.lineTo(16, -46); c.lineTo(9, -37); c.closePath(); c.fill();
  } else if (kind === 2) {
    c.fillStyle = dark;
    c.beginPath(); c.ellipse(-27, -24, 9, 5, 0.3, 0, 7); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(27, -24, 9, 5, -0.3, 0, 7); c.fill(); c.stroke();
    c.fillStyle = "#efe3c2";
    c.beginPath(); c.moveTo(-16, -40); c.quadraticCurveTo(-24, -50, -18, -54);
    c.quadraticCurveTo(-12, -50, -10, -40); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(16, -40); c.quadraticCurveTo(24, -50, 18, -54);
    c.quadraticCurveTo(12, -50, 10, -40); c.closePath(); c.fill(); c.stroke();
  } else if (kind === 3) {
    c.fillStyle = "#e04b3a";
    c.beginPath();
    c.arc(-8, -44, 6, Math.PI, 0); c.arc(0, -47, 6.5, Math.PI, 0); c.arc(8, -44, 6, Math.PI, 0);
    c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(0, -6, 5, 7, 0, 0, 7); c.fill(); c.stroke();   // wattle
  } else {
    c.fillStyle = body2;
    c.beginPath(); c.moveTo(-16, -38); c.lineTo(-13, -52); c.lineTo(-5, -40); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(16, -38); c.lineTo(13, -52); c.lineTo(5, -40); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = dark;                                       // mane
    c.beginPath(); c.moveTo(-14, -40); c.quadraticCurveTo(0, -50, 14, -40);
    c.quadraticCurveTo(6, -34, 0, -38); c.quadraticCurveTo(-6, -34, -14, -40);
    c.closePath(); c.fill(); c.stroke();
  }

  // ---- muzzle / beak ----
  if (kind === 3) {
    c.fillStyle = "#f0a028";
    c.beginPath(); c.moveTo(-9, -16); c.lineTo(9, -16); c.lineTo(0, -6); c.closePath(); c.fill(); c.stroke();
  } else if (kind === 2) {
    c.fillStyle = muzzle;
    c.beginPath(); c.ellipse(0, -10, 15, 11, 0, 0, 7); c.fill(); c.stroke();
    c.fillStyle = OUT;
    c.beginPath(); c.ellipse(-6, -12, 2.6, 2, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(6, -12, 2.6, 2, 0, 0, 7); c.fill();
  } else if (kind === 4) {
    c.fillStyle = muzzle;
    c.beginPath(); c.ellipse(0, -8, 12, 12, 0, 0, 7); c.fill(); c.stroke();
    c.fillStyle = OUT;
    c.beginPath(); c.ellipse(-5, -11, 2.4, 1.8, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(5, -11, 2.4, 1.8, 0, 0, 7); c.fill();
  } else {
    c.fillStyle = muzzle;
    c.beginPath(); c.ellipse(0, -12, 12, 9, 0, 0, 7); c.fill(); c.stroke();
    if (kind === 1) {
      c.fillStyle = "#f0879d";
      c.beginPath(); c.moveTo(-4, -17); c.lineTo(4, -17); c.lineTo(0, -12); c.closePath(); c.fill();
      c.strokeStyle = OUT; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-12, -14); c.lineTo(-26, -17); c.moveTo(-12, -11); c.lineTo(-26, -8);
      c.moveTo(12, -14); c.lineTo(26, -17); c.moveTo(12, -11); c.lineTo(26, -8);
      c.stroke(); c.lineWidth = 3.5;
    } else {
      c.fillStyle = OUT;
      c.beginPath(); c.ellipse(0, -16, 4.5, 3.5, 0, 0, 7); c.fill();
    }
  }

  // ---- eyes ----
  const ey = kind === 4 ? -28 : -26;
  eyes(c, mood, -9, 9, ey, t);

  // ---- mouth ----
  if (mood === 2) {
    c.strokeStyle = OUT; c.lineWidth = 2.5;
    c.beginPath(); c.arc(0, -4, 5, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
  } else if (kind === 0) {
    c.strokeStyle = OUT; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(-6, -8); c.quadraticCurveTo(0, -4, 6, -8); c.stroke();
    c.fillStyle = "#ff8a9d";
    c.beginPath(); c.moveTo(-2, -6); c.quadraticCurveTo(0, 2, 4, -5); c.closePath(); c.fill();
  } else if (kind !== 3) {
    c.strokeStyle = OUT; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(-5, -7); c.quadraticCurveTo(0, -3, 5, -7); c.stroke();
  }

  c.restore();
  c.restore();
}
