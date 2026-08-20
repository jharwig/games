// player cosmetics: body colours + faces (designed by Arthur Harwig), bought
// with coins in the shop. The equipped look is baked into HERO_GRID, so the
// tilt shear and the per-pixel explosion debris inherit it for free.
import { px } from './gfx';
import { P } from './palette';

export const S = 14; // hero sprite is 14x14

export interface ColorDef {
  id: string;
  price: number;
  base: string;
}

export interface FaceDef {
  id: string;
  price: number;
  feats: string[];
}

function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// mix a hex colour toward white (target 255) or black (target 0)
function mixHex(h: string, target: number, f: number): string {
  const c = hexToRgb(h);
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const v = Math.round(c[i] + (target - c[i]) * f);
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}

export const COLORS: ColorDef[] = [
  { id: 'orange', price: 0, base: P.hero },
  { id: 'black', price: 5, base: '#26262c' },
  { id: 'brown', price: 10, base: '#8a5a33' },
  { id: 'magenta', price: 15, base: '#d63e78' },
  { id: 'pink', price: 20, base: '#ff7bac' },
  { id: 'purple', price: 25, base: '#6a3fc9' },
  { id: 'blue', price: 30, base: '#2b4ff0' },
  { id: 'lightblue', price: 35, base: '#35b5f0' },
  { id: 'darkgreen', price: 40, base: '#0f7a52' },
  { id: 'green', price: 45, base: '#3fbf3f' },
  { id: 'yellow', price: 50, base: '#f0e13b' },
  { id: 'red', price: 55, base: '#e03535' },
  { id: 'white', price: 60, base: '#f2f2f6' },
];

// face features as [x, y, w, h] rects on the 14x14 body
const FEAT: Record<string, number[][]> = {
  eyes: [[3, 3, 2, 3], [9, 3, 2, 3]],
  browsUp: [[3, 1, 2, 1], [2, 2, 1, 1], [5, 2, 1, 1], [9, 1, 2, 1], [8, 2, 1, 1], [11, 2, 1, 1]],
  browsDown: [[2, 1, 2, 1], [3, 2, 2, 1], [10, 1, 2, 1], [9, 2, 2, 1]],
  smile: [[3, 8, 1, 1], [10, 8, 1, 1], [4, 9, 1, 1], [9, 9, 1, 1], [5, 10, 4, 1]],
  smileWide: [[2, 7, 1, 2], [11, 7, 1, 2], [3, 9, 1, 1], [10, 9, 1, 1], [4, 10, 6, 1]],
  frown: [[3, 10, 1, 1], [10, 10, 1, 1], [4, 9, 1, 1], [9, 9, 1, 1], [5, 8, 4, 1]],
  tongue: [[8, 11, 2, 2]],
};

export const FACES: FaceDef[] = [
  { id: 'plain', price: 0, feats: [] },
  { id: 'eyes', price: 5, feats: ['eyes'] },
  { id: 'smile', price: 10, feats: ['eyes', 'smile'] },
  { id: 'grin', price: 15, feats: ['eyes', 'browsUp', 'smileWide'] },
  { id: 'mischief', price: 25, feats: ['eyes', 'browsDown'] },
  { id: 'sad', price: 35, feats: ['eyes', 'frown'] },
  { id: 'angry', price: 50, feats: ['eyes', 'browsDown', 'frown'] },
  { id: 'silly', price: 70, feats: ['eyes', 'smile', 'tongue'] },
];

export function colorById(id: string): ColorDef {
  return COLORS.find((c) => c.id === id) || COLORS[0];
}

export function faceById(id: string): FaceDef {
  return FACES.find((f) => f.id === id) || FACES[0];
}

// ---- wallet + owned cosmetics, persisted ----------------------------------
export let wallet = 0;
export let runCoins = 0;
export let equipFace = 'plain';
export let equipColor = 'orange';
export const ownedFaces: Record<string, 1> = { plain: 1 };
export const ownedColors: Record<string, 1> = { orange: 1 };

try {
  wallet = parseInt(localStorage.getItem('block.coins') || '', 10) || 0;
  const ow = JSON.parse(localStorage.getItem('block.owned') || '{}');
  if (Array.isArray(ow.faces)) for (const id of ow.faces) ownedFaces[String(id)] = 1;
  if (Array.isArray(ow.colors)) for (const id of ow.colors) ownedColors[String(id)] = 1;
  equipFace = localStorage.getItem('block.face') || 'plain';
  equipColor = localStorage.getItem('block.color') || 'orange';
} catch {
  /* private mode / bad data: fall back to defaults */
}
if (!ownedFaces[equipFace]) equipFace = 'plain';
if (!ownedColors[equipColor]) equipColor = 'orange';

function saveWallet(): void {
  try {
    localStorage.setItem('block.coins', String(wallet));
  } catch {
    /* private mode */
  }
}

function saveCosmetics(): void {
  try {
    localStorage.setItem('block.face', equipFace);
    localStorage.setItem('block.color', equipColor);
    localStorage.setItem(
      'block.owned',
      JSON.stringify({ faces: Object.keys(ownedFaces), colors: Object.keys(ownedColors) }),
    );
  } catch {
    /* private mode */
  }
}

// coins bank the moment they are picked up - dying never forfeits them
export function earnCoins(v: number): void {
  wallet += v;
  runCoins += v;
  saveWallet();
}

export function resetRunCoins(): void {
  runCoins = 0;
}

export function trySpend(v: number): boolean {
  if (wallet < v) return false;
  wallet -= v;
  saveWallet();
  return true;
}

export function ownItem(kind: 'face' | 'color', id: string): void {
  (kind === 'face' ? ownedFaces : ownedColors)[id] = 1;
  saveCosmetics();
}

export function setEquip(kind: 'face' | 'color', id: string): void {
  if (kind === 'face') equipFace = id;
  else equipColor = id;
  applyLook();
  saveCosmetics();
}

// ---- sprite grid ----------------------------------------------------------
export type Grid = (string | undefined)[];

export function buildGrid(colorDef: ColorDef, faceDef: FaceDef): Grid {
  const g: Grid = new Array(S * S);
  function set(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        if (i >= 0 && i < S && j >= 0 && j < S) g[j * S + i] = c;
  }
  const base = colorDef.base;
  let light: string, dark: string, outline: string;
  if (colorDef.id === 'orange') {
    light = P.heroLight;
    dark = P.heroDark;
    outline = P.heroOutline;
  } else {
    light = mixHex(base, 255, 0.35);
    dark = mixHex(base, 0, 0.38);
    outline = mixHex(base, 0, 0.75);
  }
  set(0, 0, S, S, base);
  set(0, 0, S, 2, light);
  set(0, 0, 2, S, light);
  set(0, S - 3, S, 3, dark);
  set(S - 3, 0, 3, S, dark);
  set(0, 0, S, 1, outline);
  set(0, S - 1, S, 1, outline);
  set(0, 0, 1, S, outline);
  set(S - 1, 0, 1, S, outline);

  // face ink: dark on bright bodies, light on dark bodies
  const rgb = hexToRgb(base);
  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const ink = lum > 130 ? '#1c1410' : '#f4f0ea';
  for (const feat of faceDef.feats) {
    const col = feat === 'tongue' ? '#e23b3b' : ink;
    for (const r of FEAT[feat]) set(r[0], r[1], r[2], r[3], col);
  }
  return g;
}

export let HERO_GRID: Grid = [];
export let heroGlow = 'rgba(255,140,59,0.10)';

export function applyLook(): void {
  const c = colorById(equipColor);
  HERO_GRID = buildGrid(c, faceById(equipFace));
  const rgb = hexToRgb(c.base);
  heroGlow = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.10)';
}
applyLook();

export function drawGridAt(g: Grid, x: number, y: number): void {
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const c = g[j * S + i];
      if (c) px(x + i, y + j, 1, 1, c);
    }
}
