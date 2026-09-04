// =============================================================================
// arcade car physics + the visual side of the car model.
//
// The model is deliberately simple and forgiving (Alex's brief: arcade, fun):
//   forward = (-sin h, 0, -cos h)   right = (cos h, 0, -sin h)
// Throttle accelerates against a quadratic drag chosen so that the equilibrium
// speed is exactly the (possibly boosted / off-road) top speed. Steering is a
// direct yaw rate that ramps in from a standstill and eases off flat out.
// Cornering leaks sideways velocity ("lateral") which decays exponentially at a
// rate set by track grip × car grip — low grip = long slides (Ice Lake).
// =============================================================================
import * as THREE from 'three';
import type { CarModel, CarSpec } from './cars';
import type { CarState, InputState } from './types';
import { clamp, damp, wrapAngle } from './util';

/** Everything the world tells the car about this frame. */
export interface CarEnv {
  /** surface grip multiplier: track.grip, further reduced by oil / ice cracks */
  gripMul: number;
  /** true when the car is outside the road edge */
  offRoad: boolean;
  /** track.offRoad speed multiplier (only applied when offRoad) */
  offRoadMul: number;
  /** top-speed multiplier from pads / abilities (1 = none) */
  topMul: number;
  /** acceleration multiplier from pads / abilities (1 = none) */
  accelMul: number;
  /** road surface height under the car, or null when there is nothing to land on */
  groundY: number | null;
  gravity: number;
  /** true while the countdown runs or the car is crashing: no driver input */
  frozen: boolean;
}

export interface StepResult {
  /** longitudinal acceleration this frame (m/s²) — drives the body pitch */
  accel: number;
  /** yaw rate this frame (rad/s) — drives the body roll */
  yawRate: number;
  airborne: boolean;
  /** true on the frame the car touched down after being airborne */
  landed: boolean;
}

/** Every knob main / race may want to tweak lives here. */
export const CAR_TUNING = {
  /** how fast the smoothed steering input follows the raw input */
  steerSmooth: 12,
  /** peak yaw rate (rad/s) before spec.turn */
  yawBase: 1.75,
  /** speed (m/s) at which steering reaches full authority */
  steerRamp: 7,
  /** larger = steering stays sharp to higher speeds */
  steerEase: 34,
  /** how much of the turn leaks into a sideways slide */
  slip: 0.55,
  /** base lateral grip decay rate; multiplied by track.grip × spec.grip */
  gripDecay: 3.4,
  /** braking strength as a multiple of spec.accel */
  brake: 2.2,
  /** reverse acceleration as a multiple of spec.accel */
  reverseAccel: 0.5,
  reverseTop: 9,
  /** coasting drag (m/s²) */
  rollDrag: 3.5,
  /** hard ceiling as a multiple of the current effective top speed */
  speedCap: 1.25,
  /** steering authority retained while airborne */
  airSteer: 0.45,
  /** how much throttle still bites in the air */
  airThrottle: 0.2,
  /** random heading wobble off the road (rad/s at full speed) */
  offRoadJitter: 0.55,
  /** extra yaw while spun out by oil (rad/s) */
  spinRate: 5.0,
  /** grip multiplier while spinning */
  spinGrip: 0.18,
  /** wheel radius used for the rolling animation */
  wheelRadius: 0.44,
  maxSteerAngle: 0.52,
  maxRoll: 0.22,
  maxPitch: 0.11,
};

const T = CAR_TUNING;

/** Fresh car state parked at (x, y, z) facing `heading`. */
export function makeCarState(x: number, y: number, z: number, heading: number): CarState {
  return { x, y, z, heading, speed: 0, lateral: 0, vy: 0, steer: 0, surface: 'road', boosting: false, spinning: 0 };
}

/** Park the car: kills all motion but keeps the pose (used by respawn). */
export function resetCar(state: CarState, x: number, y: number, z: number, heading: number): void {
  state.x = x; state.y = y; state.z = z; state.heading = heading;
  state.speed = 0; state.lateral = 0; state.vy = 0; state.steer = 0;
  state.spinning = 0; state.boosting = false; state.surface = 'road';
}

/**
 * Advance the car one step. Mutates `state`; allocation free.
 */
export function stepCar(state: CarState, spec: CarSpec, input: InputState, dt: number, env: CarEnv): StepResult {
  const frozen = env.frozen;
  const steerIn = frozen ? 0 : clamp(input.steer, -1, 1);
  state.steer = damp(state.steer, steerIn, T.steerSmooth, dt);

  // ---- vertical: ballistic while jumping / falling, glued to the road otherwise
  let airborne = false;
  let landed = false;
  if (env.groundY === null) {
    // nothing underneath (Space, off the edge) — just fall
    state.vy -= env.gravity * dt;
    state.y += state.vy * dt;
    airborne = true;
  } else if (state.y > env.groundY + 0.02 || state.vy > 0.01) {
    state.vy -= env.gravity * dt;
    state.y += state.vy * dt;
    if (state.y <= env.groundY) { state.y = env.groundY; state.vy = 0; landed = true; }
    else airborne = true;
  } else {
    // damp rather than snap so Space's hills don't jolt the camera
    state.y = damp(state.y, env.groundY, 22, dt);
    state.vy = 0;
  }

  // ---- longitudinal
  const offMul = env.offRoad ? env.offRoadMul : 1;
  const top = Math.max(1, spec.topSpeed * env.topMul * offMul);
  const acc = spec.accel * env.accelMul * offMul;
  const k = acc / (top * top); // quadratic drag → equilibrium speed == top
  const thr = frozen ? 0 : clamp(input.throttle, 0, 1);
  const brk = frozen ? 0 : clamp(input.brake, 0, 1);
  const v = state.speed;
  let a: number;
  if (airborne) {
    a = thr * acc * T.airThrottle - Math.sign(v) * T.rollDrag * 0.25;
  } else if (thr > 0) {
    a = thr * acc - k * v * Math.abs(v);
  } else if (brk > 0) {
    a = v > 0.3
      ? -brk * spec.accel * T.brake - k * v * v
      : -brk * spec.accel * T.reverseAccel; // rolls into a slow reverse
  } else {
    a = -Math.sign(v) * T.rollDrag - k * v * Math.abs(v);
    if (Math.abs(v) < T.rollDrag * dt) a = -v / dt; // settle exactly at 0
  }
  state.speed = v + a * dt;
  const cap = top * T.speedCap;
  if (state.speed > cap) state.speed = cap;
  if (state.speed < -T.reverseTop) state.speed = -T.reverseTop;

  // ---- steering
  const sp = Math.abs(state.speed);
  const ramp = clamp(sp / T.steerRamp, 0, 1);          // no turning while parked
  const ease = 1 / (1 + sp / T.steerEase);             // twitchy-free at top speed
  // +heading turns left, so steering right (+1) is a negative yaw rate
  let yaw = -state.steer * T.yawBase * spec.turn * ramp * ease * (state.speed < 0 ? -1 : 1);
  if (airborne) yaw *= T.airSteer;

  let gripMul = env.gripMul;
  if (state.spinning > 0) {
    state.spinning = Math.max(0, state.spinning - dt);
    // spin around the way the car is already sliding so it looks like a real loss of grip
    const dir = state.lateral >= 0 ? 1 : -1;
    yaw += dir * T.spinRate * clamp(state.spinning / 0.5, 0, 1);
    gripMul *= T.spinGrip;
  }
  state.heading = wrapAngle(state.heading + yaw * dt);
  if (env.offRoad && !airborne) {
    state.heading += (Math.random() - 0.5) * T.offRoadJitter * dt * clamp(sp / 10, 0, 1);
  }

  // ---- lateral slide: cornering pushes the car outward, grip pulls it back
  state.lateral += yaw * state.speed * T.slip * dt;
  const decay = T.gripDecay * gripMul * spec.grip * (airborne ? 0.15 : 1);
  state.lateral *= Math.exp(-decay * dt);
  state.lateral = clamp(state.lateral, -24, 24);

  // ---- integrate position
  const h = state.heading;
  const fx = -Math.sin(h), fz = -Math.cos(h);
  const rx = Math.cos(h), rz = -Math.sin(h);
  state.x += (fx * state.speed + rx * state.lateral) * dt;
  state.z += (fz * state.speed + rz * state.lateral) * dt;

  return { accel: a, yawRate: yaw, airborne, landed };
}

/** Shove the car out of something it drove into (used by obstacle collisions). */
export function pushOut(state: CarState, nx: number, nz: number, dist: number): void {
  state.x += nx * dist;
  state.z += nz * dist;
}

// ---- visual helpers --------------------------------------------------------

/** New wheel rotation (radians) after rolling `speed * dt` metres. */
export function advanceWheelSpin(spin: number, speed: number, dt: number, radius = T.wheelRadius): number {
  return spin + (speed * dt) / radius;
}

/** Front-wheel yaw for the smoothed steering value. */
export function frontWheelAngle(state: CarState, max = T.maxSteerAngle): number {
  return -state.steer * max;
}

/** Body roll (rotation.z) from the sideways slide — leans away from the corner. */
export function bodyRoll(state: CarState): number {
  return clamp(-state.lateral * 0.02, -T.maxRoll, T.maxRoll);
}

/** Body pitch (rotation.x) from longitudinal acceleration — squat and dive. */
export function bodyPitch(accel: number): number {
  return clamp(accel * 0.005, -T.maxPitch, T.maxPitch);
}

/**
 * Keeps the little bits of animation state (wheel spin, smoothed roll/pitch)
 * that don't belong in the physics CarState, and drives a CarModel from it.
 */
export class CarVisuals {
  spin = 0;
  roll = 0;
  pitch = 0;
  bob = 0;

  constructor(private model: CarModel) {}

  /**
   * @param slope road pitch under the car (radians, nose-up positive) — Space hills.
   */
  update(state: CarState, step: StepResult, dt: number, t: number, slope: number): void {
    const m = this.model;
    m.group.position.set(state.x, state.y, state.z);
    // YXZ: yaw first, then pitch along the slope, then roll — proper vehicle order
    m.group.rotation.order = 'YXZ';
    m.group.rotation.y = state.heading;
    m.group.rotation.x = damp(m.group.rotation.x, slope + (step.airborne ? clamp(state.vy * 0.012, -0.2, 0.2) : 0), 8, dt);
    m.group.rotation.z = 0;

    this.spin = advanceWheelSpin(this.spin, state.speed, dt);
    for (const w of m.wheels) w.rotation.x = this.spin;
    const ang = frontWheelAngle(state);
    for (const w of m.steerWheels) if (w.parent) w.parent.rotation.y = ang;

    this.roll = damp(this.roll, bodyRoll(state), 9, dt);
    this.pitch = damp(this.pitch, bodyPitch(step.accel), 7, dt);
    this.bob = Math.sin(t * 9) * 0.02 * clamp(Math.abs(state.speed) / 12, 0, 1);
    m.body.rotation.order = 'YXZ';
    m.body.rotation.z = this.roll;
    m.body.rotation.x = this.pitch;
    m.body.position.y = this.bob;
  }
}

/** Collected material state so a car can be made translucent (Ghost's phase). */
export interface MatSnapshot { m: THREE.Material; opacity: number; transparent: boolean }

export function snapshotMaterials(root: THREE.Object3D): MatSnapshot[] {
  const out: MatSnapshot[] = [];
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      out.push({ m, opacity: m.opacity, transparent: m.transparent });
    }
  });
  return out;
}

/** `f` = 1 restores the snapshot, < 1 scales every material's opacity. */
export function applyOpacity(snap: MatSnapshot[], f: number): void {
  for (const s of snap) {
    s.m.opacity = s.opacity * f;
    const tr = s.transparent || f < 1;
    // flipping `transparent` needs a shader rebuild; opacity alone does not
    if (s.m.transparent !== tr) { s.m.transparent = tr; s.m.needsUpdate = true; }
    s.m.depthWrite = s.m.opacity > 0.9;
  }
}
