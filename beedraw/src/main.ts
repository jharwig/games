import {
  W, H, PW, PH, CELL, GW, GH, INF, ANIM_NODRAW, TOUCH_R, INK_HALF,
  BEE_SPEED, BEE_SPD_MIN, BEE_SPD_MAX,
  LIFT_TIME, LIFT_STACK_MAX, LIFT_DROP, LIFT_MIN_SPAN, PUSH_R, BRACE_TOL, FALL_TIME,
  P, ANIMAL_LONG
} from "./const";
import { clamp, lerp, dist2, storeGet, storeSet } from "./util";
import {
  audio, initAudio, applyMute, setMusic, pumpMusic, startBuzz, stopBuzz,
  sfxPlip, sfxTap, sfxWin, sfxLose, sfxFall, sfxLift, sfxDrop
} from "./audio";
import { NB, distField, distFieldMulti } from "./grid";
import {
  Level, Gap, genLevel, pointInPond, pointInSolid, inField, gapInner, gapOuter
} from "./level";
import {
  rr, panel, BIOMES, drawMeadow, drawFence, drawPonds, drawSolids, drawInk, RopeView,
  drawBee, drawAnimal
} from "./art";
import { UIButton, ScreenState, PER_PAGE, drawTitle, drawLevels } from "./screens";

const TITLE = 0, LEVELS = 1, PLAY = 2;

type Phase = "draw" | "attack" | "winseq" | "loseseq" | "win" | "lose";

interface Bee {
  x: number; y: number;
  gap: Gap; spd: number; phase: number; delay: number; off: number;
  mode: "wait" | "enter" | "animal";
  wob: number; bump: number; face: number;
  target?: { x: number; y: number };
}

// a loose stretch of the fallen rope that the bees can lift
interface Span {
  i0: number; i1: number;      // first and last stroke segment (segment i is stroke[i-1] -> stroke[i])
  len: number;
  cells: number[];             // grid cells the span's ink covers: the bees' BFS seeds
  held: number;                // lift work done so far, seconds
  lifted: boolean;
  dropT: number;               // when lifted: seconds left before it falls back
  pushers: number;             // bees pressing on it this frame
  holders: number;             // bees anywhere near it this frame (keep a lifted span open)
  vis: number;                 // eased height for the renderer
}

// =========================================================================
// persistence
// =========================================================================
let best = parseInt(storeGet("beedraw.best", "0"), 10) || 0;
let animal = parseInt(storeGet("beedraw.animal", "0"), 10) || 0;
if (animal < 0 || animal > 4) animal = 0;

function saveBest(n: number): void { if (n > best) { best = n; storeSet("beedraw.best", String(best)); } }
function setAnimal(n: number): void { animal = ((n % 5) + 5) % 5; storeSet("beedraw.animal", String(animal)); }

// =========================================================================
// canvas + scaling
// =========================================================================
const canvas = document.getElementById("c") as HTMLCanvasElement;
const g = canvas.getContext("2d")!;
const pix = document.createElement("canvas");
pix.width = PW; pix.height = PH;
const pg = pix.getContext("2d")!;
let cssW = W, cssH = H, portrait = false;
// the meadow and everything solid never move during a level: drawn once, at
// device resolution, and blitted every frame
const bg = document.createElement("canvas");
const bgc = bg.getContext("2d")!;
let bgDirty = true;

function resize(): void {
  // body is padded by the safe-area insets, so its content box is the space
  // the canvas may use
  let vw = document.body.clientWidth || window.innerWidth;
  let vh = document.body.clientHeight || window.innerHeight;
  if (window.visualViewport) {
    vw = Math.min(vw, window.visualViewport.width);
    vh = Math.min(vh, window.visualViewport.height);
  }
  portrait = vh > vw;
  const s = Math.min(vw / W, vh / H);
  cssW = Math.max(1, Math.floor(W * s));
  cssH = Math.max(1, Math.floor(H * s));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  bgDirty = true;
}

function buildBackground(): void {
  bg.width = canvas.width; bg.height = canvas.height;
  bgc.setTransform(bg.width / W, 0, 0, bg.height / H, 0, 0);
  const biome = BIOMES[L.biome];
  drawMeadow(bgc, biome, L.seed);
  drawSolids(bgc, L, biome);
  bgDirty = false;
}
window.addEventListener("resize", resize, { passive: true });
window.addEventListener("orientationchange", function () { setTimeout(resize, 120); }, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", resize, { passive: true });
  window.visualViewport.addEventListener("scroll", resize, { passive: true });
}

// =========================================================================
// game state
// =========================================================================
let state = TITLE;
let phase: Phase = "draw";
let level = 1;
let L: Level;
let stroke: { x: number; y: number }[] = [];
let inkLeft = 0, drawing = false;
let timeLeft = 7;
let bees: Bee[] = [];
let seqT = 0, overlayT = 0;
let blocked: Uint8Array = new Uint8Array(GW * GH);
let flowA: Int32Array | null = null;
let flowL: { d: Int32Array; lab: Int32Array } | null = null;
let spans: Span[] = [];
let segSpan: Int32Array = new Int32Array(0);   // per stroke segment: span index or -1
let ropeView: RopeView | null = null;
let fallT = 0, liftedAny = false;
let tPrev = 0, tAnim = 0;
let uiButtons: UIButton[] = [];
let lvPage = 0;

function startLevel(n: number): void {
  level = n;
  L = genLevel(n);
  stroke = []; inkLeft = L.ink; drawing = false;
  timeLeft = L.time; seqT = 0; overlayT = 0;
  spans = []; segSpan = new Int32Array(0); ropeView = null; flowL = null;
  fallT = 0; liftedAny = false;
  phase = "draw";
  state = PLAY;
  buildStatic();
  bgDirty = true;
  bees = [];
  for (let i = 0; i < L.bees.length; i++) {
    const s = L.bees[i];
    const out = gapOuter(s.gap, s.off);
    bees.push({
      x: out.x, y: out.y,
      gap: s.gap, spd: s.spd, phase: s.phase, delay: s.delay, off: s.off,
      mode: "wait", wob: Math.random() * 6.28, bump: 0, face: 1
    });
  }
  setMusic("game");
  stopBuzz();
}

// =========================================================================
// pathfinding grid + flow fields
// =========================================================================
let staticBlocked: Uint8Array = new Uint8Array(GW * GH);

function buildStatic(): void {
  staticBlocked = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
      let bad = 0;
      if (!inField(x, y, 8)) bad = 1;
      else if (pointInSolid(L, x, y, 6)) bad = 1;
      staticBlocked[gy * GW + gx] = bad;
    }
  }
  blocked = new Uint8Array(staticBlocked);
}

// stamp the drawn stroke into the grid, thickened by ~1 cell - lifted spans
// are up in the air and leave their cells open
function rasterInk(): void {
  blocked = new Uint8Array(staticBlocked);
  const rad = INK_HALF + CELL;                 // no slipping through
  for (let i = 1; i < stroke.length; i++) {
    const si = segSpan.length > i ? segSpan[i] : -1;
    if (si >= 0 && spans[si].lifted) continue;
    const a = stroke[i - 1], b = stroke[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(len / 5));
    for (let s = 0; s <= steps; s++) {
      const x = a.x + dx * s / steps, y = a.y + dy * s / steps;
      stampCircle(x, y, rad);
    }
  }
}

function stampCircle(x: number, y: number, rad: number): void {
  const g0 = clamp(((x - rad) / CELL) | 0, 0, GW - 1), g1 = clamp(((x + rad) / CELL) | 0, 0, GW - 1);
  const h0 = clamp(((y - rad) / CELL) | 0, 0, GH - 1), h1 = clamp(((y + rad) / CELL) | 0, 0, GH - 1);
  for (let gy = h0; gy <= h1; gy++) {
    for (let gx = g0; gx <= g1; gx++) {
      const cx = gx * CELL + CELL / 2, cy = gy * CELL + CELL / 2;
      if (dist2(cx, cy, x, y) <= rad * rad) blocked[gy * GW + gx] = 1;
    }
  }
}

function makeFlow(tx: number, ty: number): Int32Array { return distField(blocked, tx, ty); }

function rebuildFlows(): void {
  rasterInk();
  flowA = makeFlow(L.ax, L.ay);
  // one shared field toward the nearest liftable span, whichever it is
  const seeds: number[] = [], labels: number[] = [];
  for (let s = 0; s < spans.length; s++) {
    if (spans[s].lifted) continue;
    for (let k = 0; k < spans[s].cells.length; k++) { seeds.push(spans[s].cells[k]); labels.push(s); }
  }
  flowL = seeds.length ? distFieldMulti(blocked, seeds, labels) : null;
}

// =========================================================================
// the rope: when the finger lifts, the line falls onto the meadow. Stretches
// pressed against something solid (or the fence) are braced and never move;
// the rest is loose, and a loose run with room for a bee underneath can be
// lifted. Bees pressing on a span add up their lift; it stays up while any
// bee is near and falls back shortly after the last one leaves.
// =========================================================================
function bracedAt(x: number, y: number): boolean {
  if (!inField(x, y, 12 + BRACE_TOL)) return true;
  return pointInSolid(L, x, y, 4 + BRACE_TOL);
}

function buildRope(): void {
  const n = stroke.length;
  const nseg = Math.max(0, n - 1);
  const seg = new Uint8Array(nseg);          // 0 braced, 1 loose
  segSpan = new Int32Array(n);               // indexed like rasterInk: segment i is stroke[i-1] -> stroke[i]
  spans = [];
  for (let i = 0; i < n; i++) segSpan[i] = -1;
  if (L.lift && n >= 2) {
    const pb: boolean[] = [];
    for (let i = 0; i < n; i++) pb.push(bracedAt(stroke[i].x, stroke[i].y));
    for (let i = 0; i < nseg; i++) seg[i] = (pb[i] && pb[i + 1]) ? 0 : 1;
    // runs of loose segments become spans - if there is room for a bee
    let i = 0;
    while (i < nseg) {
      if (seg[i] === 0) { i++; continue; }
      let j = i, len = 0;
      while (j < nseg && seg[j] === 1) {
        len += Math.sqrt(dist2(stroke[j].x, stroke[j].y, stroke[j + 1].x, stroke[j + 1].y));
        j++;
      }
      if (len >= LIFT_MIN_SPAN) {
        const sp: Span = { i0: i + 1, i1: j, len: len, cells: [], held: 0, lifted: false, dropT: 0,
                           pushers: 0, holders: 0, vis: 0 };
        // segment s runs stroke[s-1] -> stroke[s]; seg[] is 0-based on segments
        for (let s = i; s < j; s++) segSpan[s + 1] = spans.length;
        // the cells this span covers, for the bees' search
        const scratch = new Uint8Array(GW * GH);
        const rad = INK_HALF + CELL;
        for (let s = i + 1; s <= j; s++) {
          const a = stroke[s - 1], b = stroke[s];
          const dx = b.x - a.x, dy = b.y - a.y;
          const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 5));
          for (let q = 0; q <= steps; q++) stampCircleInto(scratch, a.x + dx * q / steps, a.y + dy * q / steps, rad);
        }
        for (let cidx = 0; cidx < scratch.length; cidx++) if (scratch[cidx]) sp.cells.push(cidx);
        spans.push(sp);
      } else {
        for (let s = i; s < j; s++) seg[s] = 0;   // too short to get under: as good as braced
      }
      i = j;
    }
  }
  ropeView = { seg: seg, lift: new Float32Array(nseg), fall: 0 };
}

function stampCircleInto(arr: Uint8Array, x: number, y: number, rad: number): void {
  const g0 = clamp(((x - rad) / CELL) | 0, 0, GW - 1), g1 = clamp(((x + rad) / CELL) | 0, 0, GW - 1);
  const h0 = clamp(((y - rad) / CELL) | 0, 0, GH - 1), h1 = clamp(((y + rad) / CELL) | 0, 0, GH - 1);
  for (let gy = h0; gy <= h1; gy++) {
    for (let gx = g0; gx <= g1; gx++) {
      const cx = gx * CELL + CELL / 2, cy = gy * CELL + CELL / 2;
      if (dist2(cx, cy, x, y) <= rad * rad) arr[gy * GW + gx] = 1;
    }
  }
}

// nearest point on a span to (x, y), and its distance
function nearestOnSpan(sp: Span, x: number, y: number): { x: number; y: number; d: number } {
  let bx = stroke[sp.i0 - 1].x, by = stroke[sp.i0 - 1].y, bd = INF;
  for (let s = sp.i0; s <= sp.i1; s++) {
    const a = stroke[s - 1], b = stroke[s];
    const vx = b.x - a.x, vy = b.y - a.y;
    const l2 = vx * vx + vy * vy;
    const t = l2 ? clamp(((x - a.x) * vx + (y - a.y) * vy) / l2, 0, 1) : 0;
    const px = a.x + vx * t, py = a.y + vy * t;
    const d = dist2(px, py, x, y);
    if (d < bd) { bd = d; bx = px; by = py; }
  }
  return { x: bx, y: by, d: Math.sqrt(bd) };
}

function updateSpans(dt: number): void {
  let changed = false;
  for (let s = 0; s < spans.length; s++) {
    const sp = spans[s];
    if (!sp.lifted) {
      if (sp.pushers > 0) {
        sp.held += dt * Math.min(sp.pushers, LIFT_STACK_MAX);
        if (sp.held >= LIFT_TIME) {
          sp.lifted = true; sp.dropT = LIFT_DROP; liftedAny = true; changed = true;
          sfxLift();
        }
      } else {
        sp.held = Math.max(0, sp.held - dt);    // the strain relaxes when nobody pushes
      }
    } else {
      if (sp.holders > 0) sp.dropT = LIFT_DROP;
      else sp.dropT -= dt;
      if (sp.dropT <= 0) {
        sp.lifted = false; sp.held = 0; changed = true;
        sfxDrop();
      }
    }
    const target = sp.lifted ? 1 : Math.min(0.35, sp.held / LIFT_TIME * 0.35);
    sp.vis += (target - sp.vis) * Math.min(1, dt * 10);
    sp.pushers = 0; sp.holders = 0;
  }
  if (changed) rebuildFlows();
  if (ropeView) {
    for (let i = 0; i < segSpan.length; i++) {
      const si = segSpan[i];
      if (i >= 1) ropeView.lift[i - 1] = si >= 0 ? spans[si].vis : 0;
    }
    ropeView.fall = clamp(fallT / FALL_TIME, 0, 1);
  }
}

// steer vector from a flow field at a world position
function flowDir(field: Int32Array, x: number, y: number): { x: number; y: number; reach: boolean } | null {
  const gx = clamp((x / CELL) | 0, 0, GW - 1), gy = clamp((y / CELL) | 0, 0, GH - 1);
  const here = field[gy * GW + gx];
  let bestD = here, bx = 0, by = 0, found = false;
  for (let i = 0; i < NB.length; i++) {
    const ax = gx + NB[i][0], ay = gy + NB[i][1];
    if (ax < 0 || ay < 0 || ax >= GW || ay >= GH) continue;
    const ai = ay * GW + ax;
    if (blocked[ai]) continue;
    if (NB[i][0] && NB[i][1] && blocked[gy * GW + ax] && blocked[ay * GW + gx]) continue;
    if (field[ai] < bestD) { bestD = field[ai]; bx = NB[i][0]; by = NB[i][1]; found = true; }
  }
  if (!found) return null;
  const len = Math.sqrt(bx * bx + by * by) || 1;
  return { x: bx / len, y: by / len, reach: here < INF };
}

function cellBlockedAt(x: number, y: number): boolean {
  const gx = clamp((x / CELL) | 0, 0, GW - 1), gy = clamp((y / CELL) | 0, 0, GH - 1);
  return blocked[gy * GW + gx] === 1;
}

// =========================================================================
// drawing the ink stroke (player input)
// =========================================================================
function validInk(x: number, y: number): boolean {
  if (!inField(x, y, 12)) return false;
  if (pointInSolid(L, x, y, 4)) return false;
  if (pointInPond(L, x, y, 2)) return false;
  if (dist2(x, y, L.ax, L.ay) < ANIM_NODRAW * ANIM_NODRAW) return false;
  return true;
}

// walk from a to b, return the last valid point (clamped at the obstacle edge)
function clampToValid(ax: number, ay: number, bx: number, by: number): { x: number; y: number } | null {
  const dx = bx - ax, dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(len / 3));
  let lastX = ax, lastY = ay, got = false;
  for (let s = 1; s <= steps; s++) {
    const x = ax + dx * s / steps, y = ay + dy * s / steps;
    if (!validInk(x, y)) break;
    lastX = x; lastY = y; got = true;
  }
  return got ? { x: lastX, y: lastY } : null;
}

// the straight path to the pointer is blocked - feel around the obstacle and
// keep the tip moving along its edge toward the pointer instead of freezing
function slidePoint(last: { x: number; y: number }, x: number, y: number): { x: number; y: number } | null {
  const dx = x - last.x, dy = y - last.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / d, uy = dy / d;
  const step = Math.min(d, 7);
  let best: { x: number; y: number } | null = null;
  let bestD = d - 0.4;                  // must actually approach the pointer
  const angs = [0.45, -0.45, 0.9, -0.9, 1.3, -1.3];
  for (let i = 0; i < angs.length; i++) {
    const ca = Math.cos(angs[i]), sa = Math.sin(angs[i]);
    const p = clampToValid(last.x, last.y,
      last.x + (ux * ca - uy * sa) * step, last.y + (ux * sa + uy * ca) * step);
    if (!p) continue;
    const pd = Math.sqrt(dist2(p.x, p.y, x, y));
    if (pd < bestD) { bestD = pd; best = p; }
  }
  return best;
}

// retracing the line erases it and refunds the ink - a bad wall is not a
// lost level as long as the finger stays down
const ERASE_R = 9, ERASE_LOOK = 90, ERASE_MIN = 6;

function tryErase(x: number, y: number): boolean {
  if (stroke.length < 2) return false;
  // nearest point on the tail of the stroke to the pointer
  let acc = 0, bestSeg = -1, bestT = 0, bestD = ERASE_R;
  for (let i = stroke.length - 1; i >= 1; i--) {
    const a = stroke[i - 1], b = stroke[i];
    const vx = b.x - a.x, vy = b.y - a.y;
    const len = Math.sqrt(vx * vx + vy * vy);
    const t = len ? clamp(((x - a.x) * vx + (y - a.y) * vy) / (len * len), 0, 1) : 0;
    const d = Math.sqrt(dist2(x, y, a.x + vx * t, a.y + vy * t));
    if (d < bestD) { bestD = d; bestSeg = i; bestT = t; }
    acc += len;
    if (acc > ERASE_LOOK) break;
  }
  if (bestSeg < 0) return false;
  // how much line sits between the hit and the tip
  const a = stroke[bestSeg - 1], b = stroke[bestSeg];
  const cut = { x: a.x + (b.x - a.x) * bestT, y: a.y + (b.y - a.y) * bestT };
  let removed = Math.sqrt(dist2(cut.x, cut.y, b.x, b.y));
  for (let i = bestSeg + 1; i < stroke.length; i++) {
    removed += Math.sqrt(dist2(stroke[i - 1].x, stroke[i - 1].y, stroke[i].x, stroke[i].y));
  }
  if (removed < ERASE_MIN) return false;    // just drawing near the tip
  stroke.length = bestSeg;
  if (bestT > 0.05) stroke.push(cut);
  inkLeft = Math.min(L.ink, inkLeft + removed);
  sfxPlip();
  return true;
}

function addInkPoint(x: number, y: number): void {
  if (stroke.length === 0) {
    if (inkLeft <= 0) return;
    if (!validInk(x, y)) return;
    stroke.push({ x: x, y: y });
    sfxPlip();
    return;
  }
  const last = stroke[stroke.length - 1];
  const d = Math.sqrt(dist2(x, y, last.x, last.y));
  if (d < 2) return;
  if (tryErase(x, y)) return;
  if (inkLeft <= 0) return;
  let p = clampToValid(last.x, last.y, x, y);
  let seg = p ? Math.sqrt(dist2(p.x, p.y, last.x, last.y)) : 0;
  if (!p || seg < 1) {                  // blocked - slide along the obstacle
    p = slidePoint(last, x, y);
    if (!p) return;
    seg = Math.sqrt(dist2(p.x, p.y, last.x, last.y));
    if (seg < 1) return;
  }
  if (seg > inkLeft) {                  // out of ink - stop at the budget
    const f = inkLeft / seg;
    p = { x: last.x + (p.x - last.x) * f, y: last.y + (p.y - last.y) * f };
    seg = inkLeft;
  }
  inkLeft -= seg;
  stroke.push(p);
  sfxPlip();
}

// =========================================================================
// phase transitions
// =========================================================================
function beginAttack(): void {
  if (phase !== "draw") return;
  drawing = false;
  phase = "attack";
  timeLeft = L.time;
  buildRope();
  fallT = 0;
  rebuildFlows();
  sfxFall();
  for (let i = 0; i < bees.length; i++) {
    const b = bees[i];
    b.mode = "enter";
    b.target = gapInner(b.gap);
  }
  startBuzz();
}

function doWin(): void {
  if (phase !== "attack") return;
  phase = "winseq"; seqT = 0;
  saveBest(level);
  stopBuzz();
  setMusic("");
  sfxWin();
}
function doLose(): void {
  if (phase !== "attack") return;
  phase = "loseseq"; seqT = 0;
  stopBuzz();
  setMusic("");
  sfxLose();
}

// =========================================================================
// simulation
// =========================================================================
function updatePlay(dt: number): void {
  tAnim += dt;
  if (phase === "draw") {
    for (let i = 0; i < bees.length; i++) {
      const b = bees[i];
      b.wob += dt * 6;
      const o = gapOuter(b.gap, b.off);
      b.x = o.x + Math.sin(b.wob) * 7;
      b.y = o.y + Math.cos(b.wob * 0.8) * 6;
      b.face = (b.gap.side === 3) ? -1 : 1;
    }
    return;
  }

  if (phase === "attack") {
    timeLeft -= dt;
    fallT += dt;
    stepBees(dt);
    updateSpans(dt);
    for (let j = 0; j < bees.length; j++) {
      if (dist2(bees[j].x, bees[j].y, L.ax, L.ay) < TOUCH_R * TOUCH_R) { doLose(); return; }
    }
    if (timeLeft <= 0) { timeLeft = 0; doWin(); }
    return;
  }

  if (phase === "winseq") {
    seqT += dt;
    // the bees fly home, sad
    for (let k = 0; k < bees.length; k++) {
      const bb = bees[k];
      const out = gapOuter(bb.gap, bb.off);
      bb.x = lerp(bb.x, out.x, 1 - Math.exp(-2 * dt));
      bb.y = lerp(bb.y, out.y, 1 - Math.exp(-2 * dt));
      bb.wob += dt * 8;
    }
    if (seqT > 1.0) { phase = "win"; overlayT = 0; setMusic("game"); }
    return;
  }
  if (phase === "loseseq") {
    seqT += dt;
    for (let m = 0; m < bees.length; m++) {
      const bz = bees[m];
      bz.wob += dt * 10;
      const ang = bz.wob * 0.8 + m;
      const rr2 = 46 + Math.sin(bz.wob * 0.5 + m) * 12;
      const tx = L.ax + Math.cos(ang) * rr2, ty = L.ay + Math.sin(ang) * rr2;
      bz.x = lerp(bz.x, tx, 1 - Math.exp(-5 * dt));
      bz.y = lerp(bz.y, ty, 1 - Math.exp(-5 * dt));
    }
    if (seqT > 1.2) { phase = "lose"; overlayT = 0; setMusic("game"); }
    return;
  }
  // win / lose overlays keep animating gently
  overlayT += dt;
  for (let q = 0; q < bees.length; q++) {
    const bq = bees[q];
    bq.wob += dt * 8;
    if (phase === "lose") {
      const a2 = bq.wob * 0.6 + q;
      bq.x = L.ax + Math.cos(a2) * 48;
      bq.y = L.ay + Math.sin(a2) * 42;
    }
  }
}

function stepBees(dt: number): void {
  for (let i = 0; i < bees.length; i++) {
    const b = bees[i];
    b.wob += dt * (6 + b.spd * 3);
    if (b.delay > 0) { b.delay -= dt; continue; }
    let speed = BEE_SPEED * b.spd;

    if (b.mode === "enter") {
      const t = b.target!;
      const dx = t.x - b.x, dy = t.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 8) { b.mode = "animal"; continue; }
      const sx2 = dx / d * speed * dt, sy2 = dy / d * speed * dt;
      if (!inField(b.x, b.y, 8)) { b.x += sx2; b.y += sy2; }   // still outside
      else moveBee(b, sx2, sy2);                               // ink can stop it
      b.face = dx < 0 ? -1 : 1;
      continue;
    }

    // ---- heading for the animal ----
    const cell = cellOfXY(b.x, b.y);
    const reach = flowA![cell] < INF;
    const gd = Math.sqrt(dist2(b.x, b.y, L.ax, L.ay));
    let vx, vy;
    let pressSpan = -1;
    if (reach || gd < 60) {
      const dirv = flowDir(flowA!, b.x, b.y);
      if (gd < 60 || !dirv) {
        const ddx = L.ax - b.x, ddy = L.ay - b.y, dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        vx = ddx / dd; vy = ddy / dd;
      } else {
        vx = dirv.x; vy = dirv.y;
        // a little wiggle so the swarm does not fly in a rigid line
        const w = Math.sin(b.wob * 1.4 + b.phase) * 0.35;
        const nx = -vy, ny = vx;
        vx += nx * w; vy += ny * w;
        const vl = Math.sqrt(vx * vx + vy * vy) || 1;
        vx /= vl; vy /= vl;
      }
    } else if (flowL && flowL.d[cell] < INF && flowL.lab[cell] >= 0) {
      // sealed off - smart bees go for the nearest loose stretch of rope and
      // press on it; several of them on one span lift it faster
      pressSpan = flowL.lab[cell];
      const sp = spans[pressSpan];
      const np = nearestOnSpan(sp, b.x, b.y);
      const dirv = flowDir(flowL.d, b.x, b.y);
      if (dirv && np.d > PUSH_R * 0.8) {
        vx = dirv.x; vy = dirv.y;
      } else {
        // at the rope: shove at it
        b.bump += dt;
        const ddx = np.x - b.x, ddy = np.y - b.y, dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        vx = ddx / dd * 0.8 + Math.cos(b.wob * 1.7) * 0.5;
        vy = ddy / dd * 0.8 + Math.sin(b.wob * 2.1) * 0.5;
        speed *= 0.7;
      }
    } else {
      // nothing to lift - press angrily at the wall
      b.bump += dt;
      const ddx = L.ax - b.x, ddy = L.ay - b.y, dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      vx = ddx / dd * 0.7 + Math.cos(b.wob * 1.7) * 0.7;
      vy = ddy / dd * 0.7 + Math.sin(b.wob * 2.1) * 0.7;
      speed *= 0.8;
    }

    const stepX = vx * speed * dt, stepY = vy * speed * dt;
    moveBee(b, stepX, stepY);
    b.face = stepX < 0 ? -1 : 1;

    // ---- what this bee is doing to the rope ----
    for (let s = 0; s < spans.length; s++) {
      const sp = spans[s];
      const d = nearestOnSpan(sp, b.x, b.y).d;
      if (d > PUSH_R) continue;
      if (sp.lifted) sp.holders++;
      else if (!reach && (pressSpan === s || pressSpan < 0)) sp.pushers++;
    }
  }
}

function cellOfXY(x: number, y: number): number {
  const gx = clamp((x / CELL) | 0, 0, GW - 1), gy = clamp((y / CELL) | 0, 0, GH - 1);
  return gy * GW + gx;
}

function moveBee(b: Bee, sx: number, sy: number): void {
  const nx = b.x + sx, ny = b.y + sy;
  if (!cellBlockedAt(nx, ny)) { b.x = nx; b.y = ny; return; }
  if (!cellBlockedAt(nx, b.y)) { b.x = nx; return; }
  if (!cellBlockedAt(b.x, ny)) { b.y = ny; return; }
  // fully stuck - nudge sideways so the bees do not pile up, but never let
  // the nudge push one through the line
  const jx = b.x + (Math.random() - 0.5) * 2, jy = b.y + (Math.random() - 0.5) * 2;
  if (!cellBlockedAt(jx, jy)) { b.x = jx; b.y = jy; }
}

// =========================================================================
// gameplay rendering
// =========================================================================
function pad2(n: number): string { return n < 10 ? "0" + n : String(n); }

function drawHUD(c: CanvasRenderingContext2D): void {
  c.textBaseline = "middle";
  panel(c, 14, 10, 86, 30);
  c.fillStyle = "#ffffff"; c.font = "bold 19px 'Courier New',monospace";
  c.fillText("LV " + level, 30, 26);

  panel(c, 258, 10, 252, 30);
  c.fillStyle = P.uiMut; c.font = "bold 14px 'Courier New',monospace";
  c.fillText("INK", 272, 26);
  c.fillStyle = "#1d1d2a"; rr(c, 310, 17, 186, 16, 8); c.fill();
  const frac = L.ink > 0 ? clamp(inkLeft / L.ink, 0, 1) : 0;
  if (frac > 0.02) {
    const ig = c.createLinearGradient(310, 0, 496, 0);
    ig.addColorStop(0, "#ffe06a"); ig.addColorStop(1, "#f0a800");
    c.fillStyle = ig; rr(c, 312, 19, Math.max(6, 182 * frac), 12, 6); c.fill();
  }

  panel(c, 668, 10, 86, 30);
  const secs = Math.ceil(timeLeft);
  c.fillStyle = (phase === "attack" && secs <= 3) ? "#ff8f2b" : "#ffffff";
  c.font = "bold 19px 'Courier New',monospace";
  c.fillText("0:" + pad2(secs), 682, 26);

  // hint pill
  let hint = null;
  if (phase === "draw") hint = stroke.length ? "lift to start - draw back to erase" : "draw a line - lift to start the bees";
  else if (phase === "attack") hint = "keep the bees away!";
  if (hint) {
    const w = hint.length * 9 + 32;
    panel(c, W / 2 - w / 2, 438, w, 28);
    c.fillStyle = "#ffe06a"; c.font = "bold 15px 'Courier New',monospace";
    c.textAlign = "center";
    c.fillText(hint, W / 2, 452);
    c.textAlign = "left";
  }
}

function drawGame(c: CanvasRenderingContext2D): void {
  const t = tAnim;
  if (bgDirty) buildBackground();
  c.drawImage(bg, 0, 0, W, H);
  drawPonds(c, L, t, BIOMES[L.biome]);
  drawInk(c, stroke, drawing, phase === "draw" ? null : ropeView);
  const mood = (phase === "loseseq" || phase === "lose") ? 2 :
               (phase === "winseq" || phase === "win") ? 1 : 0;
  drawAnimal(c, animal, L.ax, L.ay, 1, t, mood);
  drawFence(c, L);
  for (let i = 0; i < bees.length; i++) {
    const b = bees[i];
    const heat = clamp((b.spd - BEE_SPD_MIN) / (BEE_SPD_MAX - BEE_SPD_MIN), 0, 1);
    drawBee(c, b.x, b.y, 0.78 + heat * 0.05, b.face < 0, heat, b.wob);
  }
  drawHUD(c);
  if (phase === "win" || phase === "lose") drawOverlay(c);
  if (portrait) {
    c.fillStyle = "rgba(10,10,16,0.8)";
    rr(c, W / 2 - 170, H - 42, 340, 26, 13); c.fill();
    c.fillStyle = "#ffe06a"; c.font = "bold 14px 'Courier New',monospace";
    c.textAlign = "center";
    c.fillText("turn your device sideways for more room", W / 2, H - 28);
    c.textAlign = "left";
  }
}

// =========================================================================
// overlays (win / lose)
// =========================================================================
function btn(c: CanvasRenderingContext2D, id: string, x: number, y: number,
             w: number, h: number, label: string, col: string, textCol?: string): void {
  uiButtons.push({ id: id, x: x, y: y, w: w, h: h, pixel: false });
  c.fillStyle = col;
  rr(c, x, y, w, h, 10); c.fill();
  c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 3; c.stroke();
  c.fillStyle = "rgba(255,255,255,0.35)";
  rr(c, x + 4, y + 4, w - 8, 6, 3); c.fill();
  c.fillStyle = textCol || "#2b1200";
  c.font = "bold 18px 'Courier New',monospace";
  c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(label, x + w / 2, y + h / 2 + 1);
  c.textAlign = "left";
}

function animalRow(c: CanvasRenderingContext2D, y: number): void {
  const bw = 70, gapx = 8;
  const total = 5 * bw + 4 * gapx;
  const x0 = W / 2 - total / 2;
  for (let i = 0; i < 5; i++) {
    const x = x0 + i * (bw + gapx);
    uiButtons.push({ id: "animal" + i, x: x, y: y, w: bw, h: 56, pixel: false });
    c.fillStyle = i === animal ? "#ffd23e" : "rgba(255,255,255,0.82)";
    rr(c, x, y, bw, 56, 9); c.fill();
    c.strokeStyle = i === animal ? "#b07a00" : "rgba(0,0,0,0.3)"; c.lineWidth = 3; c.stroke();
    c.save();
    c.beginPath(); rr(c, x + 2, y + 2, bw - 4, 52, 7); c.clip();
    drawAnimal(c, i, x + bw / 2, y + 48, 0.44, tAnim + i, 0);
    c.restore();
  }
}

function drawOverlay(c: CanvasRenderingContext2D): void {
  const win = phase === "win";
  const pop = clamp(overlayT * 4, 0, 1);
  const ease = 1 - Math.pow(1 - pop, 3);
  c.fillStyle = "rgba(10,10,16,0.5)"; c.fillRect(0, 0, W, H);
  c.save();
  c.translate(W / 2, H / 2);
  c.scale(0.85 + ease * 0.15, 0.85 + ease * 0.15);
  c.translate(-W / 2, -H / 2);

  const bx = 116, by = 88, bw = W - 232, bh = 306;
  c.fillStyle = "rgba(16,20,12,0.93)";
  rr(c, bx, by, bw, bh, 22); c.fill();
  c.strokeStyle = win ? "#7ecf3e" : "#ff8f2b"; c.lineWidth = 5; c.stroke();

  c.textAlign = "center"; c.textBaseline = "middle";
  c.fillStyle = win ? "#7ecf3e" : "#ff8f2b";
  c.font = "bold 34px 'Courier New',monospace";
  c.fillText(win ? "Level " + level + " clear!" : "Oh no!", W / 2, by + 44);
  c.fillStyle = "#e8f4d8"; c.font = "bold 16px 'Courier New',monospace";
  c.fillText(win ? "the bees gave up - well done" :
                   (liftedAny ? "the bees lifted your line and got your " : "the bees got to your ") +
                   ANIMAL_LONG[animal] + "!", W / 2, by + 78);
  c.textAlign = "left";

  animalRow(c, by + 96);

  const byy = by + 172;
  if (win) btn(c, "next", W / 2 - 190, byy, 180, 56, "NEXT LEVEL", "#ff8f2b");
  else btn(c, "retry", W / 2 - 190, byy, 180, 56, "TRY AGAIN", "#ff8f2b");
  btn(c, "levels", W / 2 + 10, byy, 180, 56, "LEVELS", "#7ecf3e", "#0d2708");
  btn(c, "title", W / 2 - 80, byy + 64, 160, 48, "TITLE", "rgba(255,255,255,0.85)");
  c.restore();
}

// =========================================================================
// main loop
// =========================================================================
function frame(ts: number): void {
  requestAnimationFrame(frame);
  const now = ts / 1000;
  const dt = tPrev ? Math.min(0.05, now - tPrev) : 0.016;
  tPrev = now;
  pumpMusic();
  uiButtons = [];

  if (state === PLAY) {
    updatePlay(dt);
    drawGame(g);
  } else {
    tAnim += dt;
    const st: ScreenState = {
      buttons: uiButtons, best: best, animal: animal, muted: audio.muted,
      tAnim: tAnim, lvPage: lvPage
    };
    if (state === TITLE) drawTitle(pg, st); else drawLevels(pg, st);
    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(pix, 0, 0, W, H);
    g.restore();
    if (portrait) {
      g.fillStyle = "rgba(10,10,16,0.8)";
      rr(g, W / 2 - 170, H - 34, 340, 24, 12); g.fill();
      g.fillStyle = "#ffe06a"; g.font = "bold 13px 'Courier New',monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("turn your device sideways to play", W / 2, H - 22);
      g.textAlign = "left";
    }
  }
}

// =========================================================================
// input
// =========================================================================
function toLogical(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width * W,
    y: (e.clientY - r.top) / r.height * H
  };
}

function hitButton(p: { x: number; y: number }): UIButton | null {
  for (let i = uiButtons.length - 1; i >= 0; i--) {
    const b = uiButtons[i];
    let x = p.x, y = p.y;
    if (b.pixel) { x /= 3; y /= 3; }
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

function handleButton(id: string): void {
  initAudio();
  if (id === "mute") { audio.muted = !audio.muted; applyMute(); return; }
  sfxTap();
  if (id.indexOf("animal") === 0) { setAnimal(parseInt(id.slice(6), 10)); return; }
  if (id === "cycleAnimal") { setAnimal(animal + 1); return; }
  if (id === "play") { startLevel(best + 1); return; }
  if (id === "levels") { state = LEVELS; lvPage = Math.floor(best / PER_PAGE); setMusic("title"); return; }
  if (id === "title") { state = TITLE; setMusic("title"); stopBuzz(); return; }
  if (id === "prev") { lvPage = Math.max(0, lvPage - 1); return; }
  if (id === "next") { lvPage++; return; }
  if (id === "retry") { startLevel(level); return; }
  if (id === "nextLevel") { startLevel(level + 1); return; }
  if (id.indexOf("lv") === 0) { startLevel(parseInt(id.slice(2), 10)); return; }
}

let activePointer: number | null = null;

canvas.addEventListener("pointerdown", function (e) {
  e.preventDefault();
  initAudio();
  if (!audio.playing) setMusic(state === PLAY ? "game" : "title");
  const p = toLogical(e);
  const b = hitButton(p);
  if (b) {
    if (b.id === "next" && state === PLAY) handleButton("nextLevel");
    else handleButton(b.id);
    return;
  }
  if (state === PLAY && phase === "draw") {
    activePointer = e.pointerId;
    drawing = true;
    addInkPoint(p.x, p.y);
  }
}, { passive: false });

canvas.addEventListener("pointermove", function (e) {
  if (activePointer === null || e.pointerId !== activePointer) return;
  e.preventDefault();
  const p = toLogical(e);
  if (state === PLAY && phase === "draw") addInkPoint(p.x, p.y);
}, { passive: false });

function endStroke(e: PointerEvent | null): void {
  if (activePointer === null) return;
  if (e && e.pointerId !== activePointer) return;
  if (e && e.preventDefault) e.preventDefault();
  activePointer = null;
  if (state === PLAY && phase === "draw") beginAttack();
}
canvas.addEventListener("pointerup", endStroke, { passive: false });
canvas.addEventListener("pointercancel", endStroke, { passive: false });
canvas.addEventListener("pointerleave", endStroke, { passive: false });
window.addEventListener("blur", function () { endStroke(null); }, { passive: true });
["touchstart", "touchmove", "touchend", "gesturestart", "contextmenu"].forEach(function (n) {
  document.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false });
});

// keyboard nicety on desktop
window.addEventListener("keydown", function (e) {
  if (e.key === "m" || e.key === "M") { initAudio(); audio.muted = !audio.muted; applyMute(); }
  if (e.key === "Escape" && state === PLAY) { state = LEVELS; stopBuzz(); setMusic("title"); }
}, { passive: true });

// =========================================================================
// boot
// =========================================================================
resize();
// no AudioContext until the first gesture (iOS refuses one before that)
audio.mode = "title";
audio.playing = false;
requestAnimationFrame(frame);
