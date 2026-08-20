// the shop: spend the wallet on faces, colours and animations. Reached from
// the title and game-over screens only - it never opens on its own. The
// shelves are taller than the screen, so the middle scrolls (drag / wheel)
// between a fixed header (title + wallet) and footer (hint + BACK).
import { W, H, px, ctx } from './gfx';
import { P } from './palette';
import { drawText, textWidth } from './font';
import { drawCoinAt } from './coins';
import {
  S, COLORS, FACES, ANIMS, colorById, faceById, buildGrid, drawGridAt,
  wallet, equipFace, equipColor, isOwned, isEquipped,
  trySpend, ownItem, setEquip,
  type ColorDef, type FaceDef, type AnimDef, type Kind,
} from './cosmetics';
import { drawTrailPreview } from './trail';
import { sfxBuy, sfxDeny, sfxEquip } from './audio';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export function inRect(p: Point | null, rc: Rect): boolean {
  return !!p && p.x >= rc.x && p.x < rc.x + rc.w && p.y >= rc.y && p.y < rc.y + rc.h;
}

export const TITLE_SHOP_BTN: Rect = { x: W / 2 - 22, y: 196, w: 44, h: 14 };
export const DEAD_SHOP_BTN: Rect = { x: W / 2 - 22, y: 172, w: 44, h: 14 };
const SHOP_BACK: Rect = { x: W / 2 - 22, y: 236, w: 44, h: 14 };

// the scrolling viewport sits between the wallet and the hint line
const VIEW_TOP = 36;
const VIEW_BOT = 220;
const VIEW_H = VIEW_BOT - VIEW_TOP;

// cell positions are in content space (0 = top of the scroll area)
interface ShopCell extends Rect {
  kind: Kind;
  item: FaceDef | ColorDef | AnimDef;
}

const FACES_LABEL_Y = 2;
const COLORS_LABEL_Y = 72;
const ANIMS_LABEL_Y = 170;

const shopCells: ShopCell[] = [];
for (let i = 0; i < FACES.length; i++) {
  shopCells.push({
    kind: 'face', item: FACES[i],
    x: 8 + (i % 4) * 36, y: 10 + ((i / 4) | 0) * 30, w: 36, h: 28,
  });
}
for (let i = 0; i < COLORS.length; i++) {
  shopCells.push({
    kind: 'color', item: COLORS[i],
    x: 10 + (i % 5) * 28, y: 82 + ((i / 5) | 0) * 28, w: 28, h: 26,
  });
}
// animations are wide list rows: preview on the left, name + price on the right
for (let i = 0; i < ANIMS.length; i++) {
  shopCells.push({
    kind: 'anim', item: ANIMS[i],
    x: 8, y: 180 + i * 28, w: W - 16, h: 26,
  });
}
const CONTENT_H = 180 + ANIMS.length * 28 + 4;
const MAX_SCROLL = Math.max(0, CONTENT_H - VIEW_H);

let scroll = 0;

// drag state: a press that moves more than a few pixels is a scroll, not a tap
const TAP_SLOP = 4;
let dragStart: Point | null = null;
let dragScroll0 = 0;
let dragged = false;

// brief red flash of the wallet after tapping something unaffordable
let denyT = 0;

export function tickShop(dt: number): void {
  if (denyT > 0) denyT -= dt;
}

export function resetShopScroll(): void {
  scroll = 0;
  dragStart = null;
  dragged = false;
}

function clampScroll(): void {
  if (scroll < 0) scroll = 0;
  if (scroll > MAX_SCROLL) scroll = MAX_SCROLL;
}

export function drawButton(rc: Rect, label: string): void {
  ctx.fillStyle = 'rgba(5,6,15,0.78)';
  ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
  px(rc.x, rc.y, rc.w, 1, '#2a2f4c');
  px(rc.x, rc.y + rc.h - 1, rc.w, 1, '#2a2f4c');
  px(rc.x, rc.y, 1, rc.h, '#2a2f4c');
  px(rc.x + rc.w - 1, rc.y, 1, rc.h, '#2a2f4c');
  drawText(label, rc.x + rc.w / 2, rc.y + Math.round((rc.h - 5) / 2), 1, P.hud, P.hudShadow);
}

function drawEquipFrame(x: number, y: number): void {
  px(x - 2, y - 2, S + 4, 1, P.hud);
  px(x - 2, y + S + 1, S + 4, 1, P.hud);
  px(x - 2, y - 2, 1, S + 4, P.hud);
  px(x + S + 1, y - 2, 1, S + 4, P.hud);
}

function priceColor(price: number): string {
  return wallet >= price ? '#ffd166' : '#5f6479';
}

export function drawShop(clock: number): void {
  ctx.fillStyle = 'rgba(5,6,15,0.92)';
  ctx.fillRect(0, 0, W, H);

  drawText('SHOP', W / 2, 6, 3, P.hud, P.hudShadow);

  // wallet, front and center
  const wtxt = String(wallet);
  const ww = textWidth(wtxt, 1) + 11;
  const wx = Math.round(W / 2 - ww / 2);
  drawCoinAt(wx, 25, 2);
  drawText(wtxt, wx + 11 + textWidth(wtxt, 1) / 2, 26, 1, denyT > 0 ? '#c86060' : '#ffd166', P.hudShadow);

  // ---- scrolling shelves ----
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, VIEW_TOP, W, VIEW_H);
  ctx.clip();
  const oy = VIEW_TOP - Math.round(scroll);

  drawText('FACES', W / 2, oy + FACES_LABEL_Y, 1, '#9aa3c8', null);
  drawText('COLORS', W / 2, oy + COLORS_LABEL_Y, 1, '#9aa3c8', null);
  drawText('ANIMATIONS', W / 2, oy + ANIMS_LABEL_Y, 1, '#9aa3c8', null);

  for (const cell of shopCells) {
    const it = cell.item;
    const cy = oy + cell.y;
    if (cy + cell.h < VIEW_TOP || cy > VIEW_BOT) continue;
    const owned = isOwned(cell.kind, it.id);
    const equipped = isEquipped(cell.kind, it.id);

    if (cell.kind === 'anim') {
      const a = it as AnimDef;
      const cubeX = cell.x + 42;
      const cubeY = cy + 6;
      // the worn look with the animation trailing behind it
      drawGridAt(buildGrid(colorById(equipColor), faceById(equipFace)), cubeX, cubeY);
      if (a.id === 'sparkle') drawTrailPreview(cubeX, cubeY, clock);
      if (equipped) drawEquipFrame(cubeX, cubeY);
      const tx = cell.x + 104;
      drawText(a.label, tx, cy + 6, 1, P.hud, P.hudShadow);
      if (!owned) drawText(String(a.price), tx, cy + 15, 1, priceColor(a.price), null);
      else drawText(equipped ? 'WEARING' : 'OWNED', tx, cy + 15, 1, '#9aa3c8', null);
      continue;
    }

    const isFace = cell.kind === 'face';
    const cubeX = cell.x + ((cell.w - S) >> 1);
    const cubeY = cy + 2;

    // preview faces on the equipped colour, colours with the equipped face
    const g = isFace
      ? buildGrid(colorById(equipColor), it as FaceDef)
      : buildGrid(it as ColorDef, faceById(equipFace));
    drawGridAt(g, cubeX, cubeY);

    // white frame marks the worn look
    if (equipped) drawEquipFrame(cubeX, cubeY);

    // price only while it still costs something
    if (!owned) drawText(String(it.price), cell.x + cell.w / 2, cubeY + S + 4, 1, priceColor(it.price), null);
  }
  ctx.restore();

  // thin scrollbar on the right edge of the viewport
  if (MAX_SCROLL > 0) {
    const trackH = VIEW_H - 4;
    const thumbH = Math.max(6, Math.round((VIEW_H / CONTENT_H) * trackH));
    const thumbY = VIEW_TOP + 2 + Math.round((scroll / MAX_SCROLL) * (trackH - thumbH));
    px(W - 3, VIEW_TOP + 2, 1, trackH, '#2a2f4c');
    px(W - 3, thumbY, 1, thumbH, '#9aa3c8');
  }

  drawText('TAP AN ITEM TO BUY OR WEAR', W / 2, 224, 1, '#9aa3c8', null);
  drawButton(SHOP_BACK, 'BACK');
}

// ---- input -----------------------------------------------------------------

export function shopWheel(dy: number): void {
  scroll += dy;
  clampScroll();
}

export function shopPointerDown(p: Point | null): void {
  dragStart = p;
  dragScroll0 = scroll;
  dragged = false;
}

export function shopPointerMove(p: Point | null): void {
  if (!dragStart || !p) return;
  const dy = p.y - dragStart.y;
  if (!dragged && Math.abs(dy) > TAP_SLOP && dragStart.y >= VIEW_TOP && dragStart.y < VIEW_BOT) dragged = true;
  if (dragged) {
    scroll = dragScroll0 - dy;
    clampScroll();
  }
}

// release: a tap (no drag) buys / wears / closes. Returns true when the shop
// should close.
export function shopPointerUp(p: Point | null): boolean {
  const start = dragStart;
  const wasDrag = dragged;
  dragStart = null;
  dragged = false;
  if (wasDrag || !start) return false;
  return shopTap(p || start);
}

function shopTap(p: Point): boolean {
  if (inRect(p, SHOP_BACK)) return true;
  if (p.y < VIEW_TOP || p.y >= VIEW_BOT) return false;

  const cy = p.y - VIEW_TOP + scroll;
  for (const cell of shopCells) {
    if (!inRect({ x: p.x, y: cy }, cell)) continue;
    const it = cell.item;
    const kind = cell.kind;
    if (isOwned(kind, it.id)) {
      if (kind === 'anim') {
        // animations toggle: tap to wear, tap again to take off
        setEquip(kind, isEquipped(kind, it.id) ? 'none' : it.id);
        sfxEquip();
      } else if (!isEquipped(kind, it.id)) {
        setEquip(kind, it.id);
        sfxEquip();
      }
    } else if (trySpend(it.price)) {
      ownItem(kind, it.id);
      setEquip(kind, it.id);
      sfxBuy();
    } else {
      denyT = 0.5;
      sfxDeny();
    }
    return false;
  }
  return false;
}
