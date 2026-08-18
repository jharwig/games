import * as THREE from 'three';
import type { Boat } from './boat';
import { clamp } from './util';

const POOL = 260;

/**
 * Bow spray: white droplets kicked sideways off every fast hull. One shared
 * THREE.Points pool; per-point alpha is faked through vertex color with
 * additive blending (black = invisible).
 */
export class Spray {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array; // xz per particle
  private life: Float32Array;
  private maxLife: Float32Array;
  private head = 0;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;

  constructor() {
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
      size: 0.55,
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
    this.pos[i * 3 + 1] = 0.55;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 2] = vx;
    this.vel[i * 2 + 1] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  /** kick spray off a boat's bow shoulders, scaled by speed */
  emitFromBoat(boat: Boat): void {
    const sp = boat.speed;
    if (sp < 3.5) return;
    const rate = clamp((sp - 3.5) / 6, 0, 1);
    if (Math.random() > rate * 0.85) return;
    const fx = Math.sin(boat.heading);
    const fz = Math.cos(boat.heading);
    const bowX = boat.pos.x + fx * boat.spec.length * 0.34;
    const bowZ = boat.pos.z + fz * boat.spec.length * 0.34;
    for (const side of [-1, 1]) {
      // lateral (starboard = (-fz, fx) here, sign covers both)
      const lx = -fz * side;
      const lz = fx * side;
      const speed = 1.6 + Math.random() * 2.2 + sp * 0.12;
      this.emit(
        bowX + lx * boat.spec.length * 0.1,
        bowZ + lz * boat.spec.length * 0.1,
        lx * speed + fx * sp * 0.35 + (Math.random() - 0.5),
        lz * speed + fz * sp * 0.35 + (Math.random() - 0.5),
        0.45 + Math.random() * 0.4,
      );
    }
  }

  update(dt: number): void {
    for (let i = 0; i < POOL; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      const t = Math.max(0, this.life[i]! / this.maxLife[i]!);
      this.pos[i * 3]! += this.vel[i * 2]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 2 + 1]! * dt;
      // drag on the droplets
      this.vel[i * 2]! *= 1 - 2.2 * dt;
      this.vel[i * 2 + 1]! *= 1 - 2.2 * dt;
      const a = t * 0.85;
      this.col[i * 3] = a;
      this.col[i * 3 + 1] = a;
      this.col[i * 3 + 2] = a;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
