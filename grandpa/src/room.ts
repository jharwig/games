// The Room: the single side-view living-room scene. Owns the static layout —
// furniture, stash spots, display spots — and draws everything that isn't a
// being or a loose item. Grandpa's recliner is drawn by grandpa.ts (its
// footrest animates with him).

import { W, H } from './constants';
import { ctx, outline, blob, rr, poly, line } from './gfx';

export const FLOOR_Y = 430;
export const WALK_MIN_Y = 445;   // beings roam this floor band
export const WALK_MAX_Y = 515;

// The sweep starts behind the recliner (nowhere in the Room is safe from
// judgment) and travels left; things near the chair get almost no grace.
export const GAZE_START = 950;
export const GAZE_END = -30;

// ---- spots ---------------------------------------------------------------

export type StashId = 'bin' | 'couch' | 'hamper';

export interface DisplaySlot {
  id: string;
  x: number;
  y: number;        // where a displayed craft sits
}

export const DISPLAY_SLOTS: DisplaySlot[] = [
  { id: 'mantel1', x: 692, y: 224 },
  { id: 'mantel2', x: 736, y: 224 },
  { id: 'table1', x: 385, y: 392 },
  { id: 'table2', x: 432, y: 392 },
];

const STASH_ZONES: { id: StashId; x: number; y: number; w: number; h: number }[] = [
  { id: 'bin', x: 14, y: 400, w: 84, h: 90 },
  { id: 'hamper', x: 196, y: 390, w: 80, h: 100 },
  { id: 'couch', x: 470, y: 430, w: 180, h: 80 },
];

const DISPLAY_ZONES: { ids: string[]; x: number; y: number; w: number; h: number }[] = [
  { ids: ['mantel1', 'mantel2'], x: 655, y: 180, w: 125, h: 70 },
  { ids: ['table1', 'table2'], x: 352, y: 360, w: 110, h: 60 },
];

export const TV = { x: 96, y: 268, w: 104, h: 84 };   // screen box; stand below
export const DOG_BED = { x: 305, y: 468 };
export const COUCH = { x: 468, y: 330, w: 185 };

export function stashSpotAt(x: number, y: number): StashId | null {
  for (const z of STASH_ZONES) {
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z.id;
  }
  return null;
}

// Returns the free slot nearest the drop point, if the drop is on a display area.
export function displaySlotAt(x: number, y: number, taken: (id: string) => boolean): DisplaySlot | null {
  for (const z of DISPLAY_ZONES) {
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) {
      let best: DisplaySlot | null = null;
      for (const s of DISPLAY_SLOTS) {
        if (!z.ids.includes(s.id) || taken(s.id)) continue;
        if (!best || Math.abs(s.x - x) < Math.abs(best.x - x)) best = s;
      }
      return best;
    }
  }
  return null;
}

export function onTV(x: number, y: number): boolean {
  return x >= TV.x - 12 && x <= TV.x + TV.w + 12 && y >= TV.y - 12 && y <= TV.y + TV.h + 46;
}

// ---- drawing -------------------------------------------------------------

export interface RoomView {
  tvOn: boolean;
  hour: number;
  chimeT: number;      // seconds since last chime (for the clock wiggle)
  binCount: number;
  hamperCount: number;
  couchCount: number;  // lumps hidden under the couch
}

export function drawRoom(t: number, v: RoomView): void {
  // wall
  ctx.fillStyle = '#ecc27c';
  ctx.fillRect(0, 0, W, FLOOR_Y);
  ctx.fillStyle = '#e2b464';
  for (let x = 24; x < W; x += 72) ctx.fillRect(x, 0, 26, FLOOR_Y);
  // wainscot
  ctx.fillStyle = '#b07a45';
  ctx.fillRect(0, FLOOR_Y - 26, W, 26);
  line(0, FLOOR_Y - 26, W, FLOOR_Y - 26, 3);
  // floor
  ctx.fillStyle = '#c98f4e';
  ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  ctx.strokeStyle = '#a8713a';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const y = FLOOR_Y + 12 + i * 24;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  line(0, FLOOR_Y, W, FLOOR_Y, 4);

  // rug
  ctx.beginPath();
  ctx.ellipse(470, 490, 235, 44, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#d95f3f'; ctx.fill();
  outline(); ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(470, 490, 205, 34, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#f2c114'; ctx.lineWidth = 5; ctx.stroke();

  drawWindow(t);
  drawPictures();
  drawFireplace(v.hour, v.chimeT);
  drawTV(t, v.tvOn);
  drawBin(v.binCount);
  drawHamper(v.hamperCount);
  drawDogBed();
  drawCouch(v.couchCount);
  drawTable();
}

function drawWindow(t: number): void {
  rr(268, 78, 120, 150, 6, '#8fd4e8');
  // hills + sun outside
  ctx.save();
  ctx.beginPath(); ctx.roundRect(268, 78, 120, 150, 6); ctx.clip();
  blob(360, 110, 22, 22, '#ffd94d');
  ctx.beginPath(); ctx.ellipse(300, 232, 70, 40, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#6fbf5a'; ctx.fill(); outline(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(390, 240, 80, 46, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#57a94b'; ctx.fill(); outline(); ctx.stroke();
  const cx = 290 + Math.sin(t * 0.15) * 20;
  blob(cx, 105, 18, 9, '#ffffff'); blob(cx + 14, 100, 13, 8, '#ffffff');
  ctx.restore();
  outline(4);
  ctx.strokeRect(268, 78, 120, 150);
  line(328, 78, 328, 228, 4);
  line(268, 153, 388, 153, 4);
  // curtains
  poly([[262, 72], [292, 72], [278, 140], [268, 200], [262, 200]], '#e0322a');
  poly([[394, 72], [364, 72], [378, 140], [394, 200]], '#e0322a');
  rr(256, 66, 144, 12, 6, '#8a5a33');
}

function drawPictures(): void {
  rr(452, 120, 58, 72, 4, '#fff3d6');
  blob(481, 148, 14, 16, '#e8b27c');      // an old portrait: just a head
  blob(481, 143, 15, 8, '#d8d8d8');
  rr(452, 120, 58, 72, 4, 'transparent');
  rr(530, 100, 66, 50, 4, '#bfe0f0');     // a sailboat picture
  poly([[548, 138], [562, 112], [564, 138]], '#ffffff');
  line(536, 140, 590, 140, 3);
}

function drawFireplace(hour: number, chimeT: number): void {
  // brick body
  rr(658, 250, 138, 180, 4, '#b0523a');
  ctx.fillStyle = '#9e442e';
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 4; c++) {
      ctx.fillRect(662 + c * 34 + (r % 2 ? 15 : 0), 256 + r * 29, 28, 22);
    }
  }
  // opening + a cozy fire
  rr(682, 300, 90, 110, 10, '#3a2418');
  const fl = Math.sin(performance.now() * 0.012);
  poly([[700, 408], [712, 368 + fl * 6], [724, 392], [734, 358 - fl * 6], [746, 390], [754, 408]], '#ff8f2b');
  poly([[712, 408], [722, 382 + fl * 4], [730, 396], [738, 378 - fl * 4], [744, 408]], '#ffd94d');
  // mantel shelf (display spot)
  rr(646, 236, 162, 18, 5, '#8a5a33');
  // the mantel clock
  const wig = chimeT < 1.6 ? Math.sin(chimeT * 30) * 0.12 * (1.6 - chimeT) : 0;
  ctx.save();
  ctx.translate(782, 236);
  ctx.rotate(wig);
  rr(-20, -46, 40, 46, 10, '#8a5a33');
  blob(0, -26, 14, 14, '#fff3d6');
  const a = (hour % 12) / 12 * Math.PI * 2 - Math.PI / 2;
  line(0, -26, Math.cos(a) * 8, -26 + Math.sin(a) * 8, 2.5);
  line(0, -26, 0, -36, 2);
  ctx.restore();
}

function drawTV(t: number, on: boolean): void {
  // stand
  rr(100, 352, 96, 58, 4, '#8a5a33');
  line(108, 380, 188, 380, 3);
  // set
  rr(TV.x, TV.y, TV.w, TV.h, 10, '#6b6880');
  const sx = TV.x + 8, sy = TV.y + 8, sw = TV.w - 30, sh = TV.h - 16;
  if (on) {
    const f = Math.floor(t * 10) % 3;
    ctx.fillStyle = ['#8fd4e8', '#ffd94d', '#f08fb0'][f];
    ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = '#241a10';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('!!', sx + 24, sy + 42);
    // blasting music notes
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.7 + i * 0.33) % 1;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#241a10';
      ctx.fillText(i % 2 ? '♪' : '♫', TV.x + TV.w / 2 + Math.sin(p * 9 + i) * 26, TV.y - 4 - p * 60);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = '#3c3a4a';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = '#565468';
    ctx.fillRect(sx + 4, sy + 4, 14, 8);
  }
  outline();
  ctx.strokeRect(sx, sy, sw, sh);
  // knobs + antenna
  blob(TV.x + TV.w - 11, TV.y + 20, 6, 6, '#d8d8d8');
  blob(TV.x + TV.w - 11, TV.y + 40, 6, 6, '#d8d8d8');
  line(TV.x + 40, TV.y, TV.x + 16, TV.y - 34, 3);
  line(TV.x + 50, TV.y, TV.x + 78, TV.y - 30, 3);
}

function drawBin(count: number): void {
  // toys peeking out as it fills
  const peek = Math.min(count, 4);
  for (let i = 0; i < peek; i++) {
    blob(30 + i * 15, 420 - (i % 2) * 7, 8, 8, ['#e0322a', '#3a7bd5', '#57b843', '#f2c114'][i]);
  }
  poly([[14, 414], [98, 414], [90, 488], [22, 488]], '#3a7bd5');
  ctx.fillStyle = '#fff8e7';
  ctx.font = 'bold 13px "Chalkboard SE", "Comic Sans MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TOYS', 56, 456);
  ctx.textAlign = 'left';
}

function drawHamper(count: number): void {
  poly([[200, 404], [272, 404], [264, 488], [208, 488]], '#e8dcc0');
  ctx.strokeStyle = '#c4b58e';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(206, 418 + i * 17); ctx.lineTo(266, 418 + i * 17); ctx.stroke();
  }
  poly([[200, 404], [272, 404], [264, 488], [208, 488]], '', true);
  // a sock hanging out once something's stashed
  if (count > 0) {
    poly([[212, 404], [206, 424], [212, 430], [220, 410]], '#f08fb0');
  }
  rr(194, 396, 84, 12, 6, '#d4c49a');
}

function drawDogBed(): void {
  ctx.beginPath();
  ctx.ellipse(DOG_BED.x, DOG_BED.y + 6, 52, 20, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#7a5bd0'; ctx.fill(); outline(); ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(DOG_BED.x, DOG_BED.y + 4, 38, 12, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#9b82e0'; ctx.fill(); outline(2.5); ctx.stroke();
}

function drawCouch(hiddenCount: number): void {
  const c = COUCH;
  // lumps of hidden mess bulging out from under
  for (let i = 0; i < Math.min(hiddenCount, 5); i++) {
    blob(c.x + 26 + i * 34, 452, 16, 9, '#b57c3e');
  }
  // back
  rr(c.x, c.y, c.w, 62, 14, '#2f9d96');
  // armrests
  rr(c.x - 14, c.y + 40, 34, 60, 12, '#37b0a8');
  rr(c.x + c.w - 20, c.y + 40, 34, 60, 12, '#37b0a8');
  // seat cushions
  rr(c.x + 16, c.y + 56, (c.w - 36) / 2, 34, 10, '#37b0a8');
  rr(c.x + 16 + (c.w - 36) / 2 + 4, c.y + 56, (c.w - 36) / 2, 34, 10, '#37b0a8');
  // base
  rr(c.x - 6, c.y + 92, c.w + 12, 16, 6, '#2f9d96');
}

function drawTable(): void {
  rr(352, 396, 112, 12, 5, '#8a5a33');
  line(362, 408, 362, 442, 5);
  line(454, 408, 454, 442, 5);
  line(362, 442, 372, 442, 5);
  line(444, 442, 456, 442, 5);
}
