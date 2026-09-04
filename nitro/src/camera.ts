// =============================================================================
// third-person chase camera. Matches the framing used by the style preview in
// mockup.ts: ~10m behind the car, ~4.2m up, looking ~8m ahead and 1.2m up —
// with damping so it lags on turns, swings wide in a drift, widens its FOV on
// boost, pulls back at speed, shakes on impact and orbits after the finish.
// =============================================================================
import * as THREE from 'three';
import { clamp, damp } from './util';
import type { CarState } from './types';

const BACK = 10;          // metres behind the car
const HEIGHT = 4.2;       // metres above the car
const AHEAD = 8;          // look-at distance in front
const LOOK_UP = 1.2;      // look-at height above the car
const FOV_BASE = 60;
const FOV_BOOST = 72;
const REF_SPEED = 46;     // ~fastest car's top speed, for the speed blend

export interface ChaseOpts {
  boosting: boolean;
  airborne: boolean;
  finished: boolean;
}

export class ChaseCamera {
  private readonly camera: THREE.PerspectiveCamera;

  // smoothed state
  private fov = FOV_BASE;
  private shakeAmount = 0;
  private orbit = 0;
  private lateralSmooth = 0;
  private speedSmooth = 0;
  private readonly look = new THREE.Vector3();

  // scratch vectors — reused, never allocated per frame
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly carPos = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.fov = FOV_BASE;
    this.camera.updateProjectionMatrix();
  }

  /** Car forward / right basis + world position, into the scratch vectors. */
  private basis(car: CarState): void {
    const s = Math.sin(car.heading), c = Math.cos(car.heading);
    this.fwd.set(-s, 0, -c);
    this.right.set(c, 0, -s);        // fwd × up
    this.carPos.set(car.x, car.y, car.z);
  }

  /** Where the camera wants to be for this car state, into `desired`. */
  private frame(car: CarState, opts: ChaseOpts): void {
    const spd = Math.abs(car.speed);
    const fast = clamp(spd / REF_SPEED, 0, 1);
    const back = BACK + fast * 1.8 + (opts.boosting ? 1.2 : 0);
    const up = HEIGHT + fast * 0.7 + (opts.airborne ? 1.2 : 0);
    this.desired.copy(this.carPos)
      .addScaledVector(this.fwd, -back)
      .addScaledVector(this.right, -this.lateralSmooth * 0.16);
    this.desired.y += up;

    // look ahead of the car, offset sideways by the drift so the camera reads
    // the slide instead of staring straight down the nose
    this.desiredLook.copy(this.carPos)
      .addScaledVector(this.fwd, AHEAD)
      .addScaledVector(this.right, this.lateralSmooth * 0.28);
    this.desiredLook.y += LOOK_UP;
  }

  /** Jump straight to the ideal framing (race start, respawn, track change). */
  snapTo(car: CarState): void {
    this.basis(car);
    this.lateralSmooth = car.lateral;
    this.speedSmooth = Math.abs(car.speed);
    this.frame(car, { boosting: false, airborne: false, finished: false });
    this.camera.position.copy(this.desired);
    this.look.copy(this.desiredLook);
    this.camera.lookAt(this.look);
    this.fov = FOV_BASE;
    this.camera.fov = FOV_BASE;
    this.camera.updateProjectionMatrix();
    this.shakeAmount = 0;
    this.orbit = 0;
  }

  /** Kick the camera — 0..1-ish; bumps add, they don't replace. */
  shake(strength: number): void {
    this.shakeAmount = Math.min(1.5, this.shakeAmount + Math.max(0, strength));
  }

  update(car: CarState, dt: number, opts: ChaseOpts): void {
    const step = Math.min(dt, 0.05);
    this.basis(car);
    this.lateralSmooth = damp(this.lateralSmooth, car.lateral, 6, step);
    this.speedSmooth = damp(this.speedSmooth, Math.abs(car.speed), 3, step);

    if (opts.finished) {
      // slow orbit around the car for the results screen
      this.orbit += step * 0.35;
      const r = BACK * 0.85;
      this.desired.set(
        car.x + Math.sin(car.heading + Math.PI + this.orbit) * -r,
        car.y + HEIGHT * 0.9,
        car.z + Math.cos(car.heading + Math.PI + this.orbit) * -r,
      );
      this.desiredLook.set(car.x, car.y + LOOK_UP, car.z);
    } else {
      this.frame(car, opts);
    }

    // positional damping — softer in the air so jumps read smoothly
    const posK = opts.finished ? 2.4 : opts.airborne ? 4 : 6.5;
    this.camera.position.lerp(this.desired, 1 - Math.exp(-posK * step));

    const lookK = opts.finished ? 3 : 8;
    this.look.lerp(this.desiredLook, 1 - Math.exp(-lookK * step));

    // FOV: widen on boost, plus a touch of speed
    const fovTarget = opts.finished
      ? FOV_BASE
      : (opts.boosting ? FOV_BOOST : FOV_BASE) + clamp(this.speedSmooth / REF_SPEED, 0, 1) * 3;
    const nextFov = damp(this.fov, fovTarget, opts.boosting ? 7 : 4, step);
    if (Math.abs(nextFov - this.fov) > 0.001) {
      this.fov = nextFov;
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    // shake: exponential decay, applied to both eye and target
    if (this.shakeAmount > 0.0005) {
      this.shakeAmount *= Math.exp(-4.5 * step);
      const a = this.shakeAmount * 0.55;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.camera.position.z += (Math.random() - 0.5) * a;
      this.look.x += (Math.random() - 0.5) * a * 0.6;
      this.look.y += (Math.random() - 0.5) * a * 0.6;
    } else {
      this.shakeAmount = 0;
    }

    // never let the camera sink below the car (hills / jumps / Space dips)
    const floor = car.y + 1.2;
    if (this.camera.position.y < floor) this.camera.position.y = floor;

    this.camera.lookAt(this.look);
  }
}
