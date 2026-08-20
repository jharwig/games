// the shop: spend the wallet on faces and colours. Reached from the title
// and game-over screens only - it never opens on its own.
import { W, px, ctx } from './gfx';
import { P } from './palette';
import { drawText, textWidth } from './font';
import { drawCoinAt } from './coins';
import {
  S, COLORS, FACES, colorById, faceById, buildGrid, drawGridAt,
  wallet, equipFace, equipColor, ownedFaces, ownedColors,
  trySpend, ownItem, setEquip,
  type ColorDef, type FaceDef,
} from './cosmetics';
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

interface ShopCell extends Rect {
  kind: 'face' | 'color';
  item: FaceDef | ColorDef;
}

const shopCells: ShopCell[] = [];
for (let i = 0; i < FACES.length; i++) {
  shopCells.push({
    kind: 'face', item: FACES[i],
    x: 8 + (i % 4) * 36, y: 46 + ((i / 4) | 0) * 30, w: 36, h: 28,
  });
}
for (let i = 0; i < COLORS.length; i++) {
  shopCells.push({
    kind: 'color', item: COLORS[i],
    x: 10 + (i % 5) * 28, y: 118 + ((i / 5) | 0) * 28, w: 28, h: 26,
  });
}

// brief red flash of the wallet after tapping something unaffordable
let denyT = 0;

export function tickShop(dt: number): void {
  if (denyT > 0) denyT -= dt;
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

export function drawShop(): void {
  ctx.fillStyle = 'rgba(5,6,15,0.92)';
  ctx.fillRect(0, 0, W, ctx.canvas.height);

  drawText('SHOP', W / 2, 6, 3, P.hud, P.hudShadow);

  // wallet, front and center
  const wtxt = String(wallet);
  const ww = textWidth(wtxt, 1) + 11;
  const wx = Math.round(W / 2 - ww / 2);
  drawCoinAt(wx, 25, 2);
  drawText(wtxt, wx + 11 + textWidth(wtxt, 1) / 2, 26, 1, denyT > 0 ? '#c86060' : '#ffd166', P.hudShadow);

  drawText('FACES', W / 2, 38, 1, '#9aa3c8', null);
  drawText('COLORS', W / 2, 108, 1, '#9aa3c8', null);

  for (const cell of shopCells) {
    const it = cell.item;
    const isFace = cell.kind === 'face';
    const cubeX = cell.x + ((cell.w - S) >> 1);
    const cubeY = cell.y + 2;
    const owned = isFace ? ownedFaces[it.id] : ownedColors[it.id];
    const equipped = isFace ? equipFace === it.id : equipColor === it.id;

    // preview faces on the equipped colour, colours with the equipped face
    const g = isFace
      ? buildGrid(colorById(equipColor), it as FaceDef)
      : buildGrid(it as ColorDef, faceById(equipFace));
    drawGridAt(g, cubeX, cubeY);

    if (equipped) {
      // white frame marks the worn look
      px(cubeX - 2, cubeY - 2, S + 4, 1, P.hud);
      px(cubeX - 2, cubeY + S + 1, S + 4, 1, P.hud);
      px(cubeX - 2, cubeY - 2, 1, S + 4, P.hud);
      px(cubeX + S + 1, cubeY - 2, 1, S + 4, P.hud);
    }

    // price only while it still costs something
    if (!owned) {
      const affordable = wallet >= it.price;
      drawText(String(it.price), cell.x + cell.w / 2, cubeY + S + 4, 1, affordable ? '#ffd166' : '#5f6479', null);
    }
  }

  drawText('TAP AN ITEM TO BUY OR WEAR', W / 2, 224, 1, '#9aa3c8', null);
  drawButton(SHOP_BACK, 'BACK');
}

// returns true when the shop should close
export function shopPress(p: Point | null): boolean {
  if (!p) return false;
  if (inRect(p, SHOP_BACK)) return true;

  for (const cell of shopCells) {
    if (!inRect(p, cell)) continue;
    const it = cell.item;
    const isFace = cell.kind === 'face';
    const ownedSet = isFace ? ownedFaces : ownedColors;
    const kind = cell.kind;
    if (ownedSet[it.id]) {
      const already = isFace ? equipFace === it.id : equipColor === it.id;
      if (!already) {
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
