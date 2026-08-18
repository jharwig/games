import * as THREE from 'three';
import type { Island } from './course';
import type { Wind } from './wind';
import { bedAt } from './seabed';
import { WAVE_AMP, waveHeight } from './water';
import { clamp } from './util';

const POOL = 480;
/** below the shader's sandbank threshold (0.60) with margin: open/deep water */
const DEEP_BED = 0.52;
/** waveHeight() above this may break (theoretical max ~1.57) */
const CREST = 1.0;

/** soft round foam dot — bare Points render as hard squares */
function foamSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/**
 * Whitecaps: foam bursts on wave crests out in deep water. Random probes
 * around the camera test the shared CPU wave + seabed fields (water.ts /
 * seabed.ts); a probe that lands on a breaking crest over deep water spawns
 * a short line of foam particles along the crest ridge that ride the swell,
 * drift downwind and fade. Same shared-Points-pool trick as spray.ts.
 */
export class Whitecaps {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array; // xz per particle
  private life: Float32Array;
  private maxLife: Float32Array;
  private head = 0;
  private budget = 0; // fractional probe count carried between frames
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;

  constructor(private islands: Island[]) {
    this.pos = new Float32Array(POOL * 3);
    this.col = new Float32Array(POOL * 3);
    this.vel = new Float32Array(POOL * 2);
    this.life = new Float32Array(POOL);
    this.maxLife = new Float32Array(POOL);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    const mat = new THREE.PointsMaterial({
      size: 1.3,
      map: foamSprite(),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  private emit(x: number, z: number, vx: number, vz: number, life: number): void {
    const i = this.head;
    this.head = (this.head + 1) % POOL;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 2] = vx;
    this.vel[i * 2 + 1] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  /** deep water as the shader paints it: low bed, off the island shelves */
  private isDeepWater(x: number, z: number): boolean {
    if (bedAt(x, z) > DEEP_BED) return false;
    for (const isl of this.islands) {
      const dx = x - isl.x;
      const dz = z - isl.z;
      const shelf = isl.r * 2.6; // matches the shader's shelving smoothstep
      if (dx * dx + dz * dz < shelf * shelf) return false;
    }
    return true;
  }

  update(dt: number, elapsed: number, center: THREE.Vector3, wind: Wind): void {
    // ---- spawn: probe random spots near the camera ----
    this.budget = Math.min(60, this.budget + dt * 900);
    const breeze = clamp((wind.speed - 5) / 5, 0.15, 1);
    const wvx = Math.sin(wind.direction);
    const wvz = Math.cos(wind.direction);
    while (this.budget >= 1) {
      this.budget -= 1;
      if (Math.random() > breeze * 0.7) continue;
      const ang = Math.random() * Math.PI * 2;
      const r = 18 + Math.random() * 115;
      const x = center.x + Math.cos(ang) * r;
      const z = center.z + Math.sin(ang) * r;
      if (waveHeight(x, z, elapsed) < CREST) continue;
      if (!this.isDeepWater(x, z)) continue;
      // crest ridge runs perpendicular to the local surface gradient
      const gx = waveHeight(x + 0.5, z, elapsed) - waveHeight(x - 0.5, z, elapsed);
      const gz = waveHeight(x, z + 0.5, elapsed) - waveHeight(x, z - 0.5, elapsed);
      const gl = Math.hypot(gx, gz) + 1e-6;
      const cx = -gz / gl;
      const cz = gx / gl;
      const n = 5 + ((Math.random() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const along = (Math.random() - 0.5) * 7;
        this.emit(
          x + cx * along + (Math.random() - 0.5) * 0.8,
          z + cz * along + (Math.random() - 0.5) * 0.8,
          wvx * (0.6 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.6,
          wvz * (0.6 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.6,
          0.8 + Math.random() * 0.9,
        );
      }
    }

    // ---- advance: foam rides the swell, drifts, fades ----
    for (let i = 0; i < POOL; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      const t = Math.max(0, this.life[i]! / this.maxLife[i]!);
      const x = (this.pos[i * 3]! += this.vel[i * 2]! * dt);
      const z = (this.pos[i * 3 + 2]! += this.vel[i * 2 + 1]! * dt);
      this.vel[i * 2]! *= 1 - 1.2 * dt;
      this.vel[i * 2 + 1]! *= 1 - 1.2 * dt;
      this.pos[i * 3 + 1] = waveHeight(x, z, elapsed) * WAVE_AMP + 0.55;
      // quick bloom, slow decay
      const a = Math.min(1, (1 - t) * 8) * t;
      this.col[i * 3] = a;
      this.col[i * 3 + 1] = a;
      this.col[i * 3 + 2] = a;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
