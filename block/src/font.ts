// pixel font (3x5)
import { px } from './gfx';

const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  A: ['111', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['111', '100', '100', '100', '111'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '111', '100', '111'],
  F: ['111', '100', '111', '100', '100'],
  G: ['111', '100', '101', '101', '111'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '111'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'],
  Q: ['111', '101', '101', '111', '011'],
  R: ['111', '101', '111', '110', '101'],
  S: ['111', '100', '111', '001', '111'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  ' ': ['000', '000', '000', '000', '000'],
  '/': ['001', '001', '010', '100', '100'],
  '!': ['010', '010', '010', '000', '010'],
  '-': ['000', '000', '111', '000', '000'],
  '+': ['000', '010', '111', '010', '000'],
  '.': ['000', '000', '000', '000', '010'],
};

export function textWidth(text: string, unit: number): number {
  if (!text.length) return 0;
  return text.length * 3 * unit + (text.length - 1) * unit;
}

export function drawText(
  text: string | number,
  cx: number,
  top: number,
  unit: number,
  color: string,
  shadow: string | null,
): void {
  const s = String(text).toUpperCase();
  const dW = 3 * unit;
  const gap = unit;
  const total = textWidth(s, unit);
  const x0 = Math.round(cx - total / 2);
  for (let i = 0; i < s.length; i++) {
    const g = FONT[s.charAt(i)];
    if (!g) continue;
    const ox = x0 + i * (dW + gap);
    for (let ry = 0; ry < 5; ry++) {
      for (let rx = 0; rx < 3; rx++) {
        if (g[ry].charAt(rx) !== '1') continue;
        if (shadow) px(ox + rx * unit + unit, top + ry * unit + unit, unit, unit, shadow);
        px(ox + rx * unit, top + ry * unit, unit, unit, color);
      }
    }
  }
}

export function drawTextLeft(
  text: string | number,
  x: number,
  top: number,
  unit: number,
  color: string,
  shadow: string | null,
): void {
  const s = String(text);
  drawText(s, x + textWidth(s, unit) / 2, top, unit, color, shadow);
}
