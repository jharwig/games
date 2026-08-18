import * as THREE from 'three';
import { wrapAngle } from './util';

/**
 * Global wind field. Direction/speed wander slowly so races have shifts,
 * plus small spatial gusts sampled per-position for the cloth and wind lines.
 */
export class Wind {
  /** Direction the wind blows TOWARD, radians (world XZ plane, 0 = +Z). */
  baseDirection = Math.PI; // blowing toward -Z at start (i.e. from "north")
  baseSpeed = 8.0;

  private t = 0;

  update(dt: number): void {
    this.t += dt;
  }

  /** Current direction (toward), with slow oscillating shift. */
  get direction(): number {
    const t = this.t;
    return wrapAngle(
      this.baseDirection +
        Math.sin(t * 0.031) * 0.22 +
        Math.sin(t * 0.011 + 2.1) * 0.14,
    );
  }

  /** Direction the wind comes FROM. */
  get from(): number {
    return wrapAngle(this.direction + Math.PI);
  }

  get speed(): number {
    const t = this.t;
    return this.baseSpeed * (1 + Math.sin(t * 0.05) * 0.12 + Math.sin(t * 0.17 + 4.0) * 0.06);
  }

  /** Wind velocity vector (XZ) at a world position, including local gusts. */
  velocityAt(pos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const dir = this.direction;
    const gust =
      1 +
      0.16 * Math.sin(pos.x * 0.021 + this.t * 0.6) * Math.sin(pos.z * 0.017 - this.t * 0.45) +
      0.08 * Math.sin(pos.x * 0.09 - pos.z * 0.07 + this.t * 1.3);
    const s = this.speed * gust;
    out.set(Math.sin(dir) * s, 0, Math.cos(dir) * s);
    return out;
  }

  /** Uniform velocity vector (no gust) — used by the boat force model. */
  velocity(out: THREE.Vector3): THREE.Vector3 {
    const dir = this.direction;
    out.set(Math.sin(dir) * this.speed, 0, Math.cos(dir) * this.speed);
    return out;
  }
}
