import {
  W, H, PW, PH, CELL, GW, GH, INF, ANIM_NODRAW, HONEY_DWELL, TOUCH_R, INK_HALF,
  P, ANIMAL_LONG
} from "./const";
import { clamp, lerp, dist2, storeGet, storeSet } from "./util";
import {
  audio, initAudio, applyMute, setMusic, pumpMusic, startBuzz, stopBuzz,
  sfxPlip, sfxTap, sfxWin, sfxLose
} from "./audio";
import { NB, distField } from "./grid";
import {
  Level, Gap, genLevel, pointInPond, pointInRock, inField, gapInner, gapOuter
} from "./level";
import {
  rr, panel, drawMeadow, drawFence, drawPonds, drawRocks, drawHoney, drawInk,
  drawBee, drawAnimal
} from "./art";
import { UIButton, ScreenState, PER_PAGE, drawTitle, drawLevels } from "./screens";

const TITLE = 0, LEVELS = 1, PLAY = 2;

type Phase = "draw" | "attack" | "winseq" | "loseseq" | "win" | "lose";

interface Bee {
  x: number; y: number;
  gap: Gap; fast: boolean; phase: number; delay: number; off: number;
  mode: "wait" | "enter" | "honey" | "drink" | "animal";
  dwell: number; wob: number; bump: number; face: number;
  target?: { x: number; y: number };
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
let flowA: Int32Array | null = null, flowH: Int32Array | null = null;
let tPrev = 0, tAnim = 0;
let uiButtons: UIButton[] = [];
let lvPage = 0;

function startLevel(n: number): void {
  level = n;
  L = genLevel(n);
  stroke = []; inkLeft = L.ink; drawing = false;
  timeLeft = L.time; seqT = 0; overlayT = 0;
  phase = "draw";
  state = PLAY;
  buildStatic();
  bees = [];
  for (let i = 0; i < L.bees.length; i++) {
    const s = L.bees[i];
    const out = gapOuter(s.gap, s.off);
    bees.push({
      x: out.x, y: out.y,
      gap: s.gap, fast: s.fast, phase: s.phase, delay: s.delay, off: s.off,
      mode: "wait", dwell: 0, wob: Math.random() * 6.28, bump: 0, face: 1
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
      else if (pointInRock(L, x, y, 6)) bad = 1;
      staticBlocked[gy * GW + gx] = bad;
    }
  }
  blocked = new Uint8Array(staticBlocked);
}

// stamp the drawn stroke into the grid, thickened by ~1 cell
function rasterInk(): void {
  blocked = new Uint8Array(staticBlocked);
  const rad = INK_HALF + CELL;                 // no slipping through
  for (let i = 1; i < stroke.length; i++) {
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
  flowH = L.honey ? makeFlow(L.honey.x, L.honey.y) : null;
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
  if (pointInRock(L, x, y, 4)) return false;
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

function addInkPoint(x: number, y: number): void {
  if (inkLeft <= 0) return;
  if (stroke.length === 0) {
    if (!validInk(x, y)) return;
    stroke.push({ x: x, y: y });
    sfxPlip();
    return;
  }
  const last = stroke[stroke.length - 1];
  const d = Math.sqrt(dist2(x, y, last.x, last.y));
  if (d < 2) return;
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
  rebuildFlows();
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
    stepBees(dt);
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
    b.wob += dt * (b.fast ? 12 : 8);
    if (b.delay > 0) { b.delay -= dt; continue; }
    let speed = (b.fast ? 1.7 : 1) * 78;

    if (b.mode === "enter") {
      const t = b.target!;
      const dx = t.x - b.x, dy = t.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 8) { b.mode = (L.honey && flowH) ? "honey" : "animal"; continue; }
      const sx2 = dx / d * speed * dt, sy2 = dy / d * speed * dt;
      if (!inField(b.x, b.y, 8)) { b.x += sx2; b.y += sy2; }   // still outside
      else moveBee(b, sx2, sy2);                               // ink can stop it
      b.face = dx < 0 ? -1 : 1;
      continue;
    }

    if (b.mode === "drink") {
      b.dwell -= dt;
      moveBee(b, Math.sin(b.wob * 2) * 8 * dt, Math.cos(b.wob * 2.4) * 10 * dt);
      if (b.dwell <= 0) b.mode = "animal";
      continue;
    }

    const field = b.mode === "honey" ? flowH : flowA;
    const goal = b.mode === "honey" ? L.honey : { x: L.ax, y: L.ay };
    if (b.mode === "honey" && (!L.honey || !flowH)) { b.mode = "animal"; continue; }

    const dirv = flowDir(field!, b.x, b.y);
    const gd = Math.sqrt(dist2(b.x, b.y, goal!.x, goal!.y));
    if (b.mode === "honey" && gd < 26) { b.mode = "drink"; b.dwell = HONEY_DWELL; continue; }

    let vx, vy;
    if (gd < 60 || !dirv || !dirv.reach) {
      // close in straight, or - when sealed off - press angrily at the wall
      const ddx = goal!.x - b.x, ddy = goal!.y - b.y, dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      vx = ddx / dd; vy = ddy / dd;
      if (dirv && !dirv.reach) {
        b.bump += dt;
        vx = vx * 0.7 + Math.cos(b.wob * 1.7) * 0.7;
        vy = vy * 0.7 + Math.sin(b.wob * 2.1) * 0.7;
        speed *= 0.8;
      }
    } else {
      vx = dirv.x; vy = dirv.y;
      // a little wiggle so the swarm does not fly in a rigid line
      const w = Math.sin(b.wob * 1.4 + b.phase) * 0.35;
      const nx = -vy, ny = vx;
      vx += nx * w; vy += ny * w;
      const vl = Math.sqrt(vx * vx + vy * vy) || 1;
      vx /= vl; vy /= vl;
    }

    const stepX = vx * speed * dt, stepY = vy * speed * dt;
    moveBee(b, stepX, stepY);
    b.face = stepX < 0 ? -1 : 1;
  }
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
  if (phase === "draw") hint = stroke.length ? "lift to start the bees" : "draw a line - lift to start the bees";
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
  drawMeadow(c);
  drawPonds(c, L, t);
  drawRocks(c, L);
  drawHoney(c, L, t);
  drawInk(c, stroke, drawing);
  const mood = (phase === "loseseq" || phase === "lose") ? 2 :
               (phase === "winseq" || phase === "win") ? 1 : 0;
  drawAnimal(c, animal, L.ax, L.ay, 1, t, mood);
  drawFence(c, L);
  for (let i = 0; i < bees.length; i++) {
    const b = bees[i];
    const s = b.fast ? 0.82 : 0.78;
    drawBee(c, b.x, b.y, s, b.face < 0, b.fast, b.wob);
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
                   "the bees got to your " + ANIMAL_LONG[animal] + "!", W / 2, by + 78);
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
