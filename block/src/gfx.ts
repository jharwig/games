// canvas setup, integer-scaled to the viewport, plus tiny drawing helpers

export const W = 160;
export const H = 288;

export const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;

export const ctx = canvas.getContext('2d')!;

export interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

export function killSmoothing(c: CanvasRenderingContext2D): void {
  c.imageSmoothingEnabled = false;
  (c as any).mozImageSmoothingEnabled = false;
  (c as any).webkitImageSmoothingEnabled = false;
  (c as any).msImageSmoothingEnabled = false;
}
killSmoothing(ctx);

function fitScale(): void {
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  if (window.visualViewport) {
    vw = window.visualViewport.width;
    vh = window.visualViewport.height;
  }
  // keep a small margin on large (desktop) screens only
  const margin = vw < W * 3 || vh < H * 3 ? 0 : 16;
  const dpr = window.devicePixelRatio || 1;
  // snap the scale to whole device pixels so the art stays sharp, but
  // fill as much of the screen as possible (important on phones, where
  // whole CSS-pixel steps waste a lot of space)
  let s = Math.min(((vw - margin) * dpr) / W, ((vh - margin) * dpr) / H);
  s = Math.floor(s) / dpr;
  if (!isFinite(s) || s <= 0) s = 1;
  if (s > 4) s = 4;
  canvas.style.width = W * s + 'px';
  canvas.style.height = H * s + 'px';
}
fitScale();
window.addEventListener('resize', fitScale);
window.addEventListener('orientationchange', fitScale);
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitScale);

export function pxc(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string): void {
  c.fillStyle = col;
  c.fillRect(x | 0, y | 0, w | 0, h | 0);
}

export function px(x: number, y: number, w: number, h: number, col: string): void {
  pxc(ctx, x, y, w, h, col);
}

// deterministic PRNG (mulberry32) - used for the pre-rendered art layers
export function rng(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeLayer(w: number, h: number): Layer {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cc = c.getContext('2d')!;
  killSmoothing(cc);
  return { canvas: c, ctx: cc, w, h };
}
