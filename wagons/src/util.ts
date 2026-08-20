export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0];
export const TAU = Math.PI * 2;
/** smallest signed angle from a to b */
export const angDiff = (a: number, b: number) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
export function loadStr(k: string, d: string) {
  try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; }
}
export function saveStr(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode etc. */ }
}
export const isTouch = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
