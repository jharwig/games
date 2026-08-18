import * as THREE from 'three';

/**
 * Seabed depth field, generated on the CPU and uploaded to the water shader
 * as a repeat-wrapped texture. Gameplay/effects code (whitecaps) and the
 * fragment shader must agree on where the deep water is, and the shader's
 * old fract(sin())-hash fbm can't be reproduced exactly in JS (float32 GPU
 * sin diverges) — so the CPU field is the single source of truth.
 *
 * Same character as the old in-shader fbm(p * 0.023): three value-noise
 * octaves at ~43 m / ~20 m / ~10 m, tiling every SEABED_TILE meters.
 */

export const SEABED_TILE = 512;

// cells per tile (integer, so the field tiles cleanly) and amplitude
const OCTAVES = [
  { cells: 12, amp: 0.55 },
  { cells: 25, amp: 0.28 },
  { cells: 51, amp: 0.17 },
];

function hash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** bilinear value noise on a lattice that wraps every `period` cells */
function vnoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Depth field at a world XZ position, 0..1 — matches what the water shader
 * paints: < ~0.34 trench, > 0.60 shelving toward visible sand.
 */
export function bedAt(x: number, z: number): number {
  let v = 0;
  for (let o = 0; o < OCTAVES.length; o++) {
    const { cells, amp } = OCTAVES[o]!;
    const s = cells / SEABED_TILE;
    v += vnoise(x * s, z * s, cells, o + 1) * amp;
  }
  return v;
}

/** bedAt() baked into a tiling texture for the water fragment shader */
export function makeBedTexture(): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = bedAt(((i + 0.5) / N) * SEABED_TILE, ((j + 0.5) / N) * SEABED_TILE);
      data[j * N + i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
