// small helpers

export function clamp(v: number, a: number, b: number): number { return v < a ? a : (v > b ? b : v); }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function rand(a: number, b: number): number { return a + Math.random() * (b - a); }
export function damp(a: number, b: number, lambda: number, dt: number): number { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
export function smoothstep(p: number): number { return p * p * (3 - 2 * p); }
export function roundTo2Pi(a: number): number { return Math.round(a / (Math.PI * 2)) * Math.PI * 2; }

export function storeGet(k: string, d: string): string {
  try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; }
}
export function storeSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch (e) { /* private mode etc. */ }
}
