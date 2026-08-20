// =========================================================================
// small helpers
// =========================================================================
export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : (v > b ? b : v);
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

export function storeGet(k: string, d: string): string {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v;
  } catch (e) {
    return d;
  }
}
export function storeSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch (e) { /* private mode */ }
}

// seeded PRNG - level N is the same layout everywhere
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
