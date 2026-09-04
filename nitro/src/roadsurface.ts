// =============================================================================
// road surface textures, painted on a canvas per theme. One tile spans the
// full road width across (u) and TILE_M metres along the road (v).
// =============================================================================
import * as THREE from 'three';
import type { TrackId } from './tracks';
import { seeded } from './util';

export const TILE_M = 24;
const W = 256, H = 512;

export function roadTexture(id: TrackId): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const rnd = seeded(99);
  const noise = (n: number, col: string, r: [number, number], alpha = 1) => {
    g.globalAlpha = alpha; g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const s = r[0] + rnd() * (r[1] - r[0]);
      g.fillRect(rnd() * W, rnd() * H, s, s);
    }
    g.globalAlpha = 1;
  };
  const dashes = (x: number, w: number, len: number, gap: number, col: string) => {
    g.fillStyle = col;
    for (let y = 0; y < H; y += len + gap) g.fillRect(x - w / 2, y, w, len);
  };
  const line = (x: number, w: number, col: string) => { g.fillStyle = col; g.fillRect(x - w / 2, 0, w, H); };

  switch (id) {
    case 'speedway':
      g.fillStyle = '#3f424d'; g.fillRect(0, 0, W, H);
      noise(2600, '#4a4e5a', [1, 3]); noise(1800, '#33353e', [1, 3]);
      line(10, 4, '#f4f4f4'); line(W - 10, 4, '#f4f4f4');
      dashes(W / 2, 4, 56, 40, '#ffd12e');
      break;
    case 'beach':
      g.fillStyle = '#c9a877'; g.fillRect(0, 0, W, H);
      noise(3000, '#d8ba8c', [1, 4]); noise(1600, '#b6935f', [1, 4]);
      // two tyre tracks worn into the sand
      g.globalAlpha = 0.35; line(W * 0.3, 26, '#a8865a'); line(W * 0.7, 26, '#a8865a'); g.globalAlpha = 1;
      noise(90, '#fff5da', [2, 5]); // shells
      // boardwalk plank edges
      for (let y = 0; y < H; y += 20) { g.fillStyle = y % 40 ? '#8a6238' : '#a0733f'; g.fillRect(0, y, 14, 18); g.fillRect(W - 14, y, 14, 18); }
      break;
    case 'dirt':
      g.fillStyle = '#8f6a40'; g.fillRect(0, 0, W, H);
      noise(3200, '#a07a4b', [1, 4]); noise(2200, '#6f5130', [1, 4]);
      g.globalAlpha = 0.5; line(W * 0.3, 30, '#6a4d2d'); line(W * 0.7, 30, '#6a4d2d'); g.globalAlpha = 1;
      noise(160, '#b9b2a4', [2, 5]); // stones
      noise(70, '#5a4326', [3, 7]);   // clods
      break;
    case 'ice':
      g.fillStyle = '#bfe3f5'; g.fillRect(0, 0, W, H);
      noise(1400, '#d8f0fb', [2, 6], 0.7); noise(900, '#a7d3ea', [2, 6], 0.7);
      // long white cracks / skate streaks
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        g.beginPath(); let x = rnd() * W, y = rnd() * H; g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 40; y += 20 + rnd() * 40; g.lineTo(x, y); }
        g.stroke();
      }
      g.globalAlpha = 0.5; dashes(W / 2, 4, 40, 40, '#2f6db5'); g.globalAlpha = 1;
      break;
    case 'volcano':
      g.fillStyle = '#2e262b'; g.fillRect(0, 0, W, H);
      noise(2600, '#3a3036', [1, 4]); noise(1800, '#221b1f', [1, 4]);
      // glowing cracks
      g.lineWidth = 3; g.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = `rgba(255,${110 + Math.floor(rnd() * 60)},30,0.95)`;
        g.beginPath(); let x = rnd() * W, y = rnd() * H; g.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 50; y += 10 + rnd() * 30; g.lineTo(x, y); }
        g.stroke();
      }
      g.globalAlpha = 0.6; dashes(W / 2, 4, 40, 48, '#ff9a3a'); g.globalAlpha = 1;
      break;
    case 'space':
      g.fillStyle = '#1b1e46'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(61,242,255,0.55)'; g.lineWidth = 2;
      for (let x = 0; x <= W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y <= H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      dashes(W / 2, 6, 48, 40, '#ff4df0');
      noise(200, '#ffffff', [1, 2], 0.6);
      break;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
