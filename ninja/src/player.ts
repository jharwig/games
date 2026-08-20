// =============================================================================
// player state (1-D physics along the course) + the air tricks
// =============================================================================
import type * as THREE from "three";
import { GRAVITY, TRICK_MIN, TRICK_SPIN } from "./constants";

// ---------------- grabs: the things the hands can hold ----------------
export interface PendGrab {
  kind: "pend"; pz: number; py: number; ropeLen: number; len: number;
  node: THREE.Group | null; swing: boolean; theta: number;
}
export interface RailGrab { kind: "rail"; z0: number; z1: number; y: number }
export interface ClimbGrab { kind: "climb"; z: number; y0: number; y1: number }
export interface ZipGrab {
  kind: "zip"; zA: number; yA: number; zB: number; yB: number;
  hang: number; wireLen: number; t: number; speed: number; node: THREE.Group;
}
export type Grab = PendGrab | RailGrab | ClimbGrab | ZipGrab;

// ---------------- tricks ----------------
// flips  = whole turns around X (negative goes backwards)
// twists = whole turns around Y
// arms / legs = held pose, armZ / legZ = how far the limbs spread sideways
// turns are always whole, so the body lands upright and facing forward
export interface TrickDef {
  name: string; flips: number; twists: number;
  arms: [number, number]; legs: [number, number]; armZ: number; legZ: number; head: number;
}
export interface Trick { def: TrickDef; t: number; dur: number; flips: number; twists: number; x0: number; y0: number }

export const TRICKS: TrickDef[] = [
  { name: "front tuck",     flips:  1, twists: 0, arms: [-2.30, -2.30], legs: [-1.15, -0.85], armZ: 0.15, legZ: 0.12, head:  0.25 },
  { name: "front layout",   flips:  1, twists: 0, arms: [-3.00, -3.00], legs: [ 0.12, -0.12], armZ: 0.10, legZ: 0.05, head:  0.10 },
  { name: "back tuck",      flips: -1, twists: 0, arms: [-2.10, -2.10], legs: [-1.20, -0.90], armZ: 0.20, legZ: 0.15, head: -0.20 },
  { name: "back layout",    flips: -1, twists: 0, arms: [-2.90, -2.90], legs: [ 0.10, -0.10], armZ: 0.50, legZ: 0.08, head: -0.25 },
  { name: "360 spin",       flips:  0, twists: 1, arms: [-1.90, -1.90], legs: [-0.50, -0.30], armZ: 0.35, legZ: 0.10, head:  0.00 },
  { name: "720 spin",       flips:  0, twists: 2, arms: [-1.50, -1.50], legs: [-0.35, -0.20], armZ: 0.20, legZ: 0.05, head:  0.00 },
  { name: "star",           flips:  0, twists: 0, arms: [-1.20, -1.20], legs: [ 0.10, -0.10], armZ: 1.35, legZ: 0.50, head: -0.15 },
  { name: "straddle",       flips:  0, twists: 0, arms: [-1.70, -1.70], legs: [-0.20, -0.20], armZ: 0.90, legZ: 0.80, head:  0.05 },
  { name: "flip + spin",    flips:  1, twists: 1, arms: [-2.40, -2.40], legs: [-1.20, -0.95], armZ: 0.10, legZ: 0.10, head:  0.20 },
  { name: "spin + arms out",flips:  0, twists: 1, arms: [-1.35, -1.35], legs: [ 0.15, -0.15], armZ: 1.30, legZ: 0.35, head:  0.00 },
  { name: "back tuck spin", flips: -1, twists: 1, arms: [-2.20, -2.20], legs: [-1.25, -0.95], armZ: 0.15, legZ: 0.10, head: -0.15 }
];

// the pose the body passes through on the way in and on the way out of a trick
export const PREP = { arms: [-0.55, -0.55] as [number, number], legs: [0.30, -0.25] as [number, number], head: 0.05 };

let lastTrick = -1;

function pickTrick(): TrickDef {
  let i = (Math.random() * TRICKS.length) | 0;
  if (i === lastTrick) i = (i + 1 + ((Math.random() * (TRICKS.length - 1)) | 0)) % TRICKS.length;
  lastTrick = i;
  return TRICKS[i];
}

// keep only the whole turns that still fit in the time left in the air
function fitTrick(remaining: number): void {
  const tr = player.trick;
  if (!tr) return;
  const want = Math.abs(tr.def.flips) + Math.abs(tr.def.twists);
  const budget = remaining * TRICK_SPIN / (Math.PI * 2);
  let s = (want > 0 && budget < want) ? budget / want : 1;
  if (remaining < TRICK_MIN) s = 0;
  // + 0.12 so a jump that is only just too short still keeps its turn
  tr.flips  = Math.sign(tr.def.flips)  * Math.floor(Math.abs(tr.def.flips)  * s + 0.12);
  tr.twists = Math.sign(tr.def.twists) * Math.floor(Math.abs(tr.def.twists) * s + 0.12);
}

export function startTrick(vy: number): void {
  const dur = Math.max(TRICK_MIN, 2 * vy / GRAVITY);   // rise + fall back to the take off height
  player.trick = { def: pickTrick(), t: 0, dur: dur, flips: 0, twists: 0, x0: player.flip, y0: player.twist };
  fitTrick(dur);
}

// the jump was cut short, so re-time the trick against the airtime that is left
export function trimTrick(vy: number): void {
  const tr = player.trick;
  if (!tr) return;
  const remaining = Math.max(0.12, 2 * vy / GRAVITY);
  tr.dur = Math.max(TRICK_MIN, tr.t + remaining);
  // turns are only dropped early on, or the body would snap backwards mid air
  if (tr.t / tr.dur < 0.3) fitTrick(tr.dur);
}

export function endTrick(): void { player.trick = null; }

// ---------------- the player ----------------
export const player = {
  z: 0, y: 0, vz: 0, vy: 0,
  visOffZ: 0, visOffY: 0,   // visual-only offset that eases out a grab snap
  onGround: false, coyote: 0, jumpBuf: 0,
  jumpCut: false, jumpHold: 0,   // variable jump height: armed while the rise can still be cut
  flip: 0, runPhase: 0, stepT: 0, moveAnim: 0,
  twist: 0,                 // yaw held by a spin trick
  trick: null as Trick | null,   // active air trick, see startTrick()
  armSpread: 0, legSpread: 0,    // sideways limb spread for star / straddle poses
  hang: null as Grab | null,     // active grab object
  hangT: 0,
  theta: 0, omega: 0,       // pendulum state
  releaseLock: 0,
  air: 0,
  lastGroundY: 0            // the last solid surface, used to detect a fall
};
