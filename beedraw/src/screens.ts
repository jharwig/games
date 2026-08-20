// =========================================================================
// pixel screens (title + level select) - drawn small, blitted 3x
// =========================================================================
import { PW, PH, P, ANIMALS } from "./const";

type Ctx = CanvasRenderingContext2D;

export interface UIButton { id: string; x: number; y: number; w: number; h: number; pixel: boolean }

// the mutable bits of game state the screens read and the buttons they emit
export interface ScreenState {
  buttons: UIButton[];
  best: number;
  animal: number;
  muted: boolean;
  tAnim: number;
  lvPage: number;
}

export const PER_PAGE = 24;

function px(c: Ctx, x: number, y: number, w: number, h: number, col: string): void {
  c.fillStyle = col; c.fillRect(x, y, w, h);
}
function ptext(c: Ctx, s: string, x: number, y: number, col: string, size?: number): void {
  c.fillStyle = col; c.font = (size || 8) + "px 'Courier New',monospace";
  c.textBaseline = "top"; c.textAlign = "left";
  c.fillText(s, x, y);
}
function pbtn(c: Ctx, st: ScreenState, id: string, x: number, y: number,
              w: number, h: number, col: string, hi: string): void {
  st.buttons.push({ id: id, x: x, y: y, w: w, h: h, pixel: true });
  px(c, x, y, w, h, col);
  px(c, x, y, w, 2, hi);
}

function pixMeadow(c: Ctx): void {
  px(c, 0, 0, PW, PH, P.grass1);
  let i, x, y;
  for (i = 0; i < 200; i++) {
    x = (i * 97) % PW; y = (i * 61) % PH;
    px(c, x, y, 2, 2, (i % 3 === 0) ? P.grass2 : P.grass3);
  }
  for (i = 0; i < 14; i++) {
    x = 20 + ((i * 137) % (PW - 40)); y = 18 + ((i * 89) % (PH - 36));
    px(c, x, y, 2, 2, [P.flower1, P.flower2, P.flower3][i % 3]);
    px(c, x - 1, y + 2, 1, 1, P.grass2);
  }
}

function pixBee(c: Ctx, x: number, y: number): void {
  px(c, x + 1, y - 2, 2, 2, "#dff2ff"); px(c, x + 4, y - 2, 2, 2, "#dff2ff");
  px(c, x, y, 7, 4, P.beeY);
  px(c, x + 1, y, 1, 4, "#2a2a2a"); px(c, x + 3, y, 1, 4, "#2a2a2a"); px(c, x + 5, y, 1, 4, "#2a2a2a");
  px(c, x + 7, y + 1, 1, 1, "#2a2a2a");
}

function pixHead(c: Ctx, x: number, y: number, kind: number): void {
  if (kind === 0) {
    px(c, x, y, 10, 9, P.dogB); px(c, x - 1, y, 2, 5, P.dogD); px(c, x + 9, y, 2, 5, P.dogD);
    px(c, x + 2, y + 3, 1, 2, "#000"); px(c, x + 7, y + 3, 1, 2, "#000"); px(c, x + 4, y + 6, 2, 2, P.dogD);
  } else if (kind === 1) {
    px(c, x, y + 1, 10, 8, P.catB); px(c, x, y - 1, 2, 3, P.catB); px(c, x + 8, y - 1, 2, 3, P.catB);
    px(c, x + 2, y + 3, 1, 2, "#2aa02a"); px(c, x + 7, y + 3, 1, 2, "#2aa02a"); px(c, x + 4, y + 6, 2, 1, "#d06a8a");
  } else if (kind === 2) {
    px(c, x, y, 10, 9, P.cowW); px(c, x + 5, y + 1, 4, 3, P.cowB); px(c, x + 1, y + 5, 3, 2, P.cowB);
    px(c, x + 2, y + 3, 1, 2, "#000"); px(c, x + 7, y + 3, 1, 2, "#000");
    px(c, x - 1, y + 1, 2, 2, P.cowB); px(c, x + 9, y + 1, 2, 2, P.cowB);
    px(c, x + 3, y + 7, 4, 2, "#e8b8c8");
  } else if (kind === 3) {
    px(c, x + 1, y + 1, 8, 8, P.chW); px(c, x + 2, y - 1, 5, 2, P.chR);
    px(c, x + 3, y + 3, 1, 2, "#000"); px(c, x + 6, y + 3, 1, 2, "#000"); px(c, x + 4, y + 5, 2, 2, P.chY);
  } else {
    px(c, x, y, 10, 9, P.hoB); px(c, x + 2, y - 2, 6, 3, P.hoD);
    px(c, x + 2, y + 3, 1, 2, "#000"); px(c, x + 7, y + 3, 1, 2, "#000"); px(c, x + 3, y + 7, 4, 2, P.hoD);
  }
}

function pixMute(c: Ctx, st: ScreenState, x: number, y: number): void {
  // the hit box is padded out so the tap target stays ~44 CSS px on a phone
  st.buttons.push({ id: "mute", x: x - 4, y: y - 4, w: 24, h: 20, pixel: true });
  px(c, x - 2, y - 2, 20, 16, "rgba(10,10,16,0.55)");
  px(c, x + 1, y + 4, 3, 4, "#ffffff");
  px(c, x + 4, y + 2, 2, 8, "#ffffff");
  px(c, x + 6, y, 2, 12, "#ffffff");
  if (st.muted) {
    px(c, x + 9, y + 4, 6, 2, "#ff5a5a");
    px(c, x + 11, y + 2, 2, 6, "#ff5a5a");
  } else {
    px(c, x + 10, y + 3, 1, 5, "#ffe06a");
    px(c, x + 12, y + 1, 1, 9, "#ffe06a");
  }
}

export function drawTitle(c: Ctx, st: ScreenState): void {
  const t = st.tAnim;
  px(c, 0, 0, PW, PH, P.sky);
  // clouds
  let i;
  for (i = 0; i < 3; i++) {
    const cx = ((i * 90 + t * 6) % (PW + 60)) - 30, cy = 16 + i * 14;
    px(c, cx, cy, 22, 5, "#ffffff"); px(c, cx + 5, cy - 3, 12, 4, "#ffffff");
  }
  px(c, 0, 112, PW, PH - 112, P.grass1);
  px(c, 0, 112, PW, 2, P.grass3);
  for (i = 0; i < 40; i++) px(c, (i * 67) % PW, 116 + ((i * 31) % 42), 2, 2, P.grass2);
  for (i = 0; i < 6; i++) px(c, 12 + ((i * 41) % 232), 118 + ((i * 17) % 36), 2, 2, [P.flower1, P.flower2, P.flower3][i % 3]);
  // sun
  px(c, 224, 12, 14, 14, P.beeY); px(c, 227, 9, 8, 20, P.beeY); px(c, 221, 15, 20, 8, P.beeY);
  // animated bees
  pixBee(c, 44 + Math.round(Math.sin(t * 1.6) * 6), 26 + Math.round(Math.cos(t * 2.2) * 4));
  pixBee(c, 196 + Math.round(Math.cos(t * 1.3) * 7), 46 + Math.round(Math.sin(t * 1.9) * 5));
  pixBee(c, 130 + Math.round(Math.sin(t * 1.1 + 2) * 40), 18 + Math.round(Math.cos(t * 2.6) * 3));
  // logo
  ptext(c, "BEE DRAW", 56, 38, "#2b2b6e", 28);
  ptext(c, "BEE DRAW", 54, 36, P.beeY, 28);
  ptext(c, "designed by Priella", 78, 66, "#2b5a12", 9);
  // animal picker
  ptext(c, "pick your animal", 84, 77, "#2b2b6e", 8);
  for (i = 0; i < 5; i++) {
    const x = 38 + i * 38, y = 88;
    st.buttons.push({ id: "animal" + i, x: x - 4, y: y - 4, w: 19, h: 25, pixel: true });
    px(c, x - 3, y - 3, 17, 17, (i === st.animal) ? P.beeY : "#ffffff");
    px(c, x - 2, y - 2, 15, 15, (i === st.animal) ? "#fff8dc" : "#e8f4d8");
    pixHead(c, x, y, i);
    ptext(c, ANIMALS[i], x - 2, y + 16, "#2b2b6e", 6);
  }
  // buttons
  pbtn(c, st, "play", 64, 124, 58, 20, P.accent, "#ffc07a");
  ptext(c, "PLAY", 79, 129, "#2b1200", 11);
  pbtn(c, st, "levels", 132, 124, 62, 20, P.open, P.openHi);
  ptext(c, "LEVELS", 141, 130, "#ffffff", 9);
  ptext(c, "best level " + st.best, 90, 148, "#16330a", 8);
  pixMute(c, st, 8, 7);
}

export function drawLevels(c: Ctx, st: ScreenState): void {
  pixMeadow(c);
  px(c, 0, 0, PW, 18, P.ui);
  ptext(c, "CHOOSE LEVEL", 88, 5, P.uiText, 9);
  st.buttons.push({ id: "cycleAnimal", x: 2, y: 0, w: 60, h: 18, pixel: true });
  pixHead(c, 8, 4, st.animal);
  ptext(c, "change", 22, 7, P.uiMut, 6);
  st.buttons.push({ id: "title", x: 218, y: 0, w: 38, h: 18, pixel: true });
  ptext(c, "BACK", 224, 6, P.accent, 8);
  pixMute(c, st, 196, 4);

  for (let i = 0; i < PER_PAGE; i++) {
    const n = st.lvPage * PER_PAGE + i + 1;
    const col = i % 6, row = (i / 6) | 0;
    const x = 14 + col * 38, y = 24 + row * 29;
    const done = n <= st.best, next = n === st.best + 1;
    const open = done || next;
    if (open) st.buttons.push({ id: "lv" + n, x: x, y: y, w: 30, h: 22, pixel: true });
    px(c, x, y, 30, 22, done ? P.open : (next ? P.accent : P.lock));
    px(c, x, y, 30, 2, done ? P.openHi : (next ? "#ffc07a" : "#6a6a80"));
    if (open) {
      const s = String(n);
      ptext(c, s, x + 15 - s.length * 2.7, y + 7, "#fff", 9);
    } else {
      px(c, x + 12, y + 9, 6, 7, "#2a2a35");
      px(c, x + 13, y + 6, 4, 4, "#2a2a35");
      px(c, x + 14, y + 7, 2, 2, P.lock);
    }
  }
  // pager
  if (st.lvPage > 0) { pbtn(c, st, "prev", 8, 138, 46, 19, P.ui, "#3a3a4a"); ptext(c, "< PREV", 12, 143, "#ffffff", 8); }
  pbtn(c, st, "next", 202, 138, 46, 19, P.ui, "#3a3a4a"); ptext(c, "NEXT >", 206, 143, "#ffffff", 8);
  ptext(c, "levels " + (st.lvPage * PER_PAGE + 1) + "-" + ((st.lvPage + 1) * PER_PAGE), 92, 143, "#1e3f10", 8);
}
