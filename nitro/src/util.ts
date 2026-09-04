export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential approach. */
export const damp = (cur: number, target: number, k: number, dt: number) =>
  lerp(cur, target, 1 - Math.exp(-k * dt));
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Small deterministic PRNG (mulberry32) so scenery is the same every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fmtTime(s: number): string {
  if (!isFinite(s)) return '--:--.--';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}

export function storeGet(k: string, d: string): string {
  try { return localStorage.getItem(k) ?? d; } catch { return d; }
}
export function storeSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}
