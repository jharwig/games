// Loose items in the Room: Dislike messes the player stashes, and Like
// crafts the player puts up on display spots. Owns the item list, hit
// testing, and each kind's cartoon drawing.

import { SEVERITY, rand, pick } from './constants';
import { ctx, outline, blob, rr, poly, line } from './gfx';

export type MessKind = 'toys' | 'juice' | 'pawprints' | 'cushion';
export type CraftKind = 'macaroni' | 'drawing';

export interface Item {
  id: number;
  kind: MessKind | CraftKind;
  craft: boolean;
  x: number;
  y: number;
  held: boolean;
  slot: string | null;      // display slot id once a craft is placed
  admired: boolean;         // a craft only earns its Reaction once
  fade: number;             // 1 → 0 while being removed
  removing: boolean;
  seed: number;
  born: number;
}

export const items: Item[] = [];
let nextId = 1;

export function clearItems(): void { items.length = 0; }

export function addMess(kind: MessKind, x: number, y: number): Item {
  const it: Item = {
    id: nextId++, kind, craft: false, x, y, held: false, slot: null,
    admired: false, fade: 1, removing: false, seed: Math.random() * 7, born: performance.now(),
  };
  items.push(it);
  return it;
}

export function addCraft(x: number, y: number): Item {
  const it: Item = {
    id: nextId++, kind: pick<CraftKind>(['macaroni', 'drawing']), craft: true,
    x, y, held: false, slot: null,
    admired: false, fade: 1, removing: false, seed: Math.random() * 7, born: performance.now(),
  };
  items.push(it);
  return it;
}

export function removeItem(it: Item): void { it.removing = true; }

export function updateItems(dt: number): void {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.removing) {
      it.fade -= dt * 3;
      if (it.fade <= 0) items.splice(i, 1);
    }
  }
}

export function slotTaken(id: string): boolean {
  return items.some(it => it.slot === id && !it.removing);
}

// Topmost draggable item under the pointer.
export function itemAt(x: number, y: number): Item | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.removing) continue;
    const r = it.craft ? 30 : 36;
    if (Math.abs(x - it.x) < r && Math.abs(y - it.y) < r + 6) return it;
  }
  return null;
}

export function messMeter(kind: MessKind): number { return SEVERITY[kind].meter; }
export function messStashPts(kind: MessKind): number { return SEVERITY[kind].stashPts; }

export function randomFloorSpot(): { x: number; y: number } {
  return { x: rand(120, 640), y: rand(455, 512) };
}

// ---- drawing -------------------------------------------------------------

export function drawItem(it: Item, t: number): void {
  ctx.save();
  ctx.globalAlpha = it.fade;
  const lift = it.held ? 1.18 : 1;
  ctx.translate(it.x, it.y);
  ctx.scale(lift, lift);
  if (it.held) {
    ctx.rotate(Math.sin(t * 10) * 0.06);
    // drop shadow while carried
    ctx.save();
    ctx.globalAlpha = 0.2 * it.fade;
    blob(0, 34, 26, 7, '#241a10', false);
    ctx.restore();
  }
  switch (it.kind) {
    case 'toys': drawToys(it.seed); break;
    case 'juice': drawJuice(); break;
    case 'pawprints': drawPawprints(); break;
    case 'cushion': drawCushion(); break;
    case 'macaroni': drawMacaroni(!!it.slot); break;
    case 'drawing': drawDrawing(!!it.slot); break;
  }
  ctx.restore();
}

function drawToys(seed: number): void {
  blob(-14, 4, 11, 11, '#e0322a');                    // ball
  line(-22, 2, -6, 6, 2.5, '#fff8e7');
  rr(0, -4, 18, 18, 3, '#3a7bd5');                    // block
  ctx.fillStyle = '#fff8e7';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('A', 5, 10);
  const jx = seed > 3.5 ? -4 : 4;
  blob(jx + 14, -8, 8, 8, '#f2c114');                 // jack-in-box head popped
  rr(jx + 8, -2, 13, 12, 2, '#57b843');
  blob(-2, 12, 6, 6, '#f08fb0');                      // marble
}

function drawJuice(): void {
  ctx.beginPath();
  ctx.ellipse(4, 12, 30, 11, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ff8f2b'; ctx.fill(); outline(); ctx.stroke();
  ctx.save();
  ctx.translate(-20, -2);
  ctx.rotate(-1.2);
  rr(-8, -12, 16, 24, 3, '#f08fb0');                  // tipped cup
  ctx.restore();
  blob(14, 9, 4, 2.5, '#ffd94d', false);              // glint
}

function drawPawprints(): void {
  for (let i = 0; i < 3; i++) {
    const px = -22 + i * 22, py = 8 - i * 9;
    blob(px, py, 7, 5.5, '#7a5230');
    blob(px - 6, py - 7, 2.8, 2.8, '#7a5230');
    blob(px, py - 9, 2.8, 2.8, '#7a5230');
    blob(px + 6, py - 7, 2.8, 2.8, '#7a5230');
  }
}

function drawCushion(): void {
  ctx.save();
  ctx.rotate(0.18);
  rr(-24, -16, 48, 32, 9, '#37b0a8');
  // the rip + fluff
  poly([[-6, -16], [0, -4], [8, -16]], '#241a10', true, false);
  blob(2, -18, 8, 6, '#fffdf4');
  blob(10, -14, 6, 5, '#fffdf4');
  ctx.restore();
  blob(24, 14, 5, 4, '#fffdf4');                      // escaped stuffing
}

function paper(displayed: boolean): void {
  if (displayed) {
    // propped upright on its spot
    rr(-17, -40, 34, 40, 2, '#fffdf4');
  } else {
    ctx.rotate(0.12);
    rr(-19, -14, 38, 30, 2, '#fffdf4');
  }
}

function drawMacaroni(displayed: boolean): void {
  ctx.save();
  paper(displayed);
  const oy = displayed ? -20 : 0;
  // macaroni heart
  ctx.strokeStyle = '#f2a114';
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const hx = Math.sin(a) ** 3 * 11;
    const hy = -(1.1 * Math.cos(a) - 0.45 * Math.cos(2 * a) - 0.18 * Math.cos(3 * a)) * 10;
    ctx.beginPath();
    ctx.arc(hx, oy + hy, 3, a, a + 2.2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDrawing(displayed: boolean): void {
  ctx.save();
  paper(displayed);
  const oy = displayed ? -22 : -1;
  // crayon house + sun
  ctx.strokeStyle = '#e0322a';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-10, oy + 1, 13, 10);
  ctx.beginPath();
  ctx.moveTo(-12, oy + 1); ctx.lineTo(-3.5, oy - 7); ctx.lineTo(5, oy + 1);
  ctx.stroke();
  ctx.strokeStyle = '#f2a114';
  ctx.beginPath();
  ctx.arc(10, oy - 6, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
