// Canvas setup and the 90s-cartoon drawing primitives every module shares:
// flat fills with thick dark outlines.

import { W, H } from './constants';

export const canvas = document.getElementById('game') as HTMLCanvasElement;
export let ctx = canvas.getContext('2d')!;

// Temporarily point every drawing helper at another canvas (e.g. the title
// screen's dog portraits). `ctx` is a live binding, so importers follow.
export function withCtx(c: CanvasRenderingContext2D, fn: () => void): void {
  const old = ctx;
  ctx = c;
  try { fn(); } finally { ctx = old; }
}

export const INK = '#241a10';
export const LINE = 3.5;

export let viewScale = 1;

export function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  viewScale = s;
  canvas.style.width = `${W * s}px`;
  canvas.style.height = `${H * s}px`;
  canvas.width = Math.round(W * s * dpr);
  canvas.height = Math.round(H * s * dpr);
  ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
}

// Screen (CSS pixel) coordinates → game coordinates.
export function toGame(clientX: number, clientY: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) / viewScale, y: (clientY - r.top) / viewScale };
}

export function outline(width = LINE): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

export function blob(x: number, y: number, rx: number, ry: number, fill: string, stroke = true): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { outline(); ctx.stroke(); }
}

export function rr(x: number, y: number, w: number, h: number, r: number, fill: string, stroke = true): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { outline(); ctx.stroke(); }
}

export function poly(pts: number[][], fill: string, stroke = true, close = true): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { outline(); ctx.stroke(); }
}

export function line(x1: number, y1: number, x2: number, y2: number, width = LINE, color = INK): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// A limb drawn shoulder → elbow → hand as a fat stroke.
export function limb(pts: number[][], width: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = INK;
  ctx.lineWidth = width + LINE * 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Comic speech bubble anchored above (x, y). Spiky for shouts, round for warm lines.
export function speechBubble(x: number, y: number, text: string, spiky: boolean, pop: number): void {
  ctx.save();
  ctx.font = `bold 17px "Chalkboard SE", "Comic Sans MS", "Trebuchet MS", sans-serif`;
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > 200 && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
  const bw = tw + 34;
  const bh = lines.length * 20 + 24;
  let bx = x - bw / 2;
  bx = Math.max(8, Math.min(W - bw - 8, bx));
  const by = Math.max(8, y - bh - 26);
  const s = 0.7 + 0.3 * Math.min(1, pop * 6);
  ctx.translate(bx + bw / 2, by + bh);
  ctx.scale(s, s);
  ctx.translate(-(bx + bw / 2), -(by + bh));

  ctx.beginPath();
  if (spiky) {
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rx = bw / 2 + (i % 2 ? 12 : 0);
      const ry = bh / 2 + (i % 2 ? 10 : 0);
      const px = bx + bw / 2 + Math.cos(a) * rx;
      const py = by + bh / 2 + Math.sin(a) * ry;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.roundRect(bx, by, bw, bh, 16);
  }
  ctx.fillStyle = '#fffdf4';
  ctx.fill();
  outline(3);
  ctx.stroke();
  // tail
  ctx.beginPath();
  ctx.moveTo(x - 8, by + bh - 4);
  ctx.lineTo(x + Math.min(14, bw / 4), by + bh - 4);
  ctx.lineTo(x, y - 8);
  ctx.closePath();
  ctx.fillStyle = '#fffdf4';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fffdf4';
  ctx.fillRect(bx + 14, by + bh - 6, Math.max(2, bw - 28), 8);

  ctx.fillStyle = spiky ? '#c22315' : '#1e5c2e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], bx + bw / 2, by + 14 + 10 + i * 20);
  }
  ctx.restore();
}
