// player.ts — the Character (boy/girl kid), the movement state machine
// (swinging / airborne / ground / climbing) and the camera rig.
//
// See CONTEXT.md for vocabulary and types.ts for the module contract.
// World conventions: the water is at -Z, the camera sits on the +Z side, a
// Swing's positive `angle` carries the seat toward the water.

import * as THREE from 'three';
import {
  type CharacterKind,
  FOG_FAR,
  FOG_NEAR,
  type GameCtx,
  type PlayerApi,
  type PlayerMode,
  type SwingInfo,
  type TreeInfo,
} from './types';
import { clamp, damp, lerp } from './util';

// --- body proportions (total height ~1.3m) ---------------------------------

const HIP_Y = 0.62;
const THIGH_LEN = 0.32;
const SHIN_LEN = 0.3;
const TORSO_H = 0.36;
const SHOULDER_Y = 0.94;
const HEAD_Y = 1.12;
const HEAD_R = 0.135;
const ARM_UP_LEN = 0.24;
const ARM_LO_LEN = 0.22;
const HIP_HALF = 0.09;
const SHOULDER_HALF = 0.16;

// --- tuning ----------------------------------------------------------------

const GRAVITY = 9.8;
const RUN_SPEED_X = 6;
const RUN_SPEED_Z = 4;
const CLIMB_SPEED = 2;
// world.ts scales pump impulses by 0.55 internally; 1.0 here means ~4-5
// presses take the swing from rest to the amplitude cap.
const PUMP_STRENGTH = 1.0;
const HOP_ON_RADIUS = 1.2;
const CLIMB_RADIUS = 1.5;
const HOP_COOLDOWN = 1.2;
const STUN_SECONDS = 0.6;
const BAIL_SIDE_IMPULSE = 3.6;
const BAIL_UP_IMPULSE = 1.8;
const SHAKE_DECAY = 6; // ~0.5s to fade out

// --- scratch (no per-frame allocations) ------------------------------------

const tmpA = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpSeat = new THREE.Vector3();
const tmpTop = new THREE.Vector3();
const camDesired = new THREE.Vector3();
const lookDesired = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Procedural character rig

interface Limb {
  upper: THREE.Object3D; // pivot at the joint (hip / shoulder)
  lower: THREE.Object3D; // pivot at the knee / elbow
  end: THREE.Object3D; // foot / hand
}

interface Rig {
  root: THREE.Group; // world transform; origin = feet (see `body`)
  body: THREE.Group; // shifted down when seated so the hips sit at the origin
  torso: THREE.Object3D;
  head: THREE.Object3D;
  legL: Limb;
  legR: Limb;
  armL: Limb;
  armR: Limb;
  disposables: Array<THREE.BufferGeometry | THREE.Material>;
}

function mat(color: number, rough = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true });
}

function makeLimb(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  upperLen: number,
  lowerLen: number,
  radius: number,
  upperMat: THREE.Material,
  lowerMat: THREE.Material,
  disposables: Rig['disposables'],
): Limb {
  const upper = new THREE.Group();
  upper.position.set(x, y, z);
  parent.add(upper);

  const upperGeo = new THREE.CapsuleGeometry(radius, upperLen - radius * 2, 2, 6);
  disposables.push(upperGeo);
  const upperMesh = new THREE.Mesh(upperGeo, upperMat);
  upperMesh.position.y = -upperLen / 2;
  upperMesh.castShadow = true;
  upper.add(upperMesh);

  const lower = new THREE.Group();
  lower.position.y = -upperLen;
  upper.add(lower);

  const lowerGeo = new THREE.CapsuleGeometry(radius * 0.88, lowerLen - radius * 1.7, 2, 6);
  disposables.push(lowerGeo);
  const lowerMesh = new THREE.Mesh(lowerGeo, lowerMat);
  lowerMesh.position.y = -lowerLen / 2;
  lowerMesh.castShadow = true;
  lower.add(lowerMesh);

  const end = new THREE.Object3D();
  end.position.y = -lowerLen;
  lower.add(end);

  return { upper, lower, end };
}

/** Build a low-poly kid facing -Z (toward the water). */
function buildRig(kind: CharacterKind, carryAnchor: THREE.Object3D): Rig {
  const disposables: Rig['disposables'] = [];
  const skin = mat(kind === 'boy' ? 0xe0ac86 : 0xd9a074);
  const hair = mat(kind === 'boy' ? 0x5a3a22 : 0x704627);
  const shirt = mat(kind === 'boy' ? 0x4a7a55 : 0xc75c7a);
  const pants = mat(kind === 'boy' ? 0x4d5b78 : 0x6b5aa0);
  const shoe = mat(0x3b3630);
  disposables.push(skin, hair, shirt, pants, shoe);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // torso
  const torsoGeo = new THREE.BoxGeometry(0.3, TORSO_H, 0.19);
  disposables.push(torsoGeo);
  const torso = new THREE.Mesh(torsoGeo, shirt);
  torso.position.y = HIP_Y + TORSO_H / 2;
  torso.castShadow = true;
  body.add(torso);

  // hips / waistband
  const hipGeo = new THREE.BoxGeometry(0.28, 0.12, 0.18);
  disposables.push(hipGeo);
  const hipMesh = new THREE.Mesh(hipGeo, pants);
  hipMesh.position.y = HIP_Y - 0.01;
  hipMesh.castShadow = true;
  body.add(hipMesh);

  if (kind === 'girl') {
    // little skirt over the leggings
    const skirtGeo = new THREE.ConeGeometry(0.21, 0.18, 8, 1, true);
    disposables.push(skirtGeo);
    const skirt = new THREE.Mesh(skirtGeo, shirt);
    skirt.position.y = HIP_Y - 0.02;
    skirt.castShadow = true;
    body.add(skirt);
  }

  // neck + head
  const neckGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.07, 6);
  disposables.push(neckGeo);
  const neck = new THREE.Mesh(neckGeo, skin);
  neck.position.y = HIP_Y + TORSO_H + 0.03;
  body.add(neck);

  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  body.add(head);

  const headGeo = new THREE.SphereGeometry(HEAD_R, 10, 8);
  disposables.push(headGeo);
  const headMesh = new THREE.Mesh(headGeo, skin);
  headMesh.scale.set(1, 1.05, 0.95);
  headMesh.castShadow = true;
  head.add(headMesh);

  // eyes (a hint of a face, facing -Z)
  const eyeGeo = new THREE.SphereGeometry(0.018, 6, 5);
  disposables.push(eyeGeo);
  const eyeMat = mat(0x241c14, 0.5);
  disposables.push(eyeMat);
  for (const ex of [-0.05, 0.05]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(ex, 0.02, -HEAD_R * 0.92);
    head.add(eye);
  }

  // hair
  const capGeo = new THREE.SphereGeometry(HEAD_R * 1.06, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.58);
  disposables.push(capGeo);
  const cap = new THREE.Mesh(capGeo, hair);
  cap.position.y = 0.012;
  cap.castShadow = true;
  head.add(cap);

  if (kind === 'girl') {
    const tailGeo = new THREE.CapsuleGeometry(0.05, 0.18, 2, 6);
    disposables.push(tailGeo);
    const tail = new THREE.Mesh(tailGeo, hair);
    tail.position.set(0, -0.02, HEAD_R * 0.95);
    tail.rotation.x = -0.5;
    tail.castShadow = true;
    head.add(tail);
    const tieGeo = new THREE.TorusGeometry(0.045, 0.014, 5, 8);
    disposables.push(tieGeo);
    const tieMat = mat(0xe8d15a);
    disposables.push(tieMat);
    const tie = new THREE.Mesh(tieGeo, tieMat);
    tie.position.set(0, 0.06, HEAD_R * 0.85);
    tie.rotation.x = Math.PI / 2;
    head.add(tie);
  } else {
    // a bit of a fringe
    const fringeGeo = new THREE.BoxGeometry(0.2, 0.05, 0.06);
    disposables.push(fringeGeo);
    const fringe = new THREE.Mesh(fringeGeo, hair);
    fringe.position.set(0, 0.05, -HEAD_R * 0.85);
    head.add(fringe);
  }

  // legs: boy wears shorts (skin shins), girl wears leggings
  const shinMat = kind === 'boy' ? skin : pants;
  const legL = makeLimb(body, -HIP_HALF, HIP_Y, 0, THIGH_LEN, SHIN_LEN, 0.062, pants, shinMat, disposables);
  const legR = makeLimb(body, HIP_HALF, HIP_Y, 0, THIGH_LEN, SHIN_LEN, 0.062, pants, shinMat, disposables);
  const shoeGeo = new THREE.BoxGeometry(0.1, 0.06, 0.17);
  disposables.push(shoeGeo);
  for (const leg of [legL, legR]) {
    const foot = new THREE.Mesh(shoeGeo, shoe);
    foot.position.set(0, 0.02, -0.03);
    foot.castShadow = true;
    leg.end.add(foot);
  }

  // arms: sleeves on the upper arm, skin forearms
  const armL = makeLimb(body, -SHOULDER_HALF, SHOULDER_Y, 0, ARM_UP_LEN, ARM_LO_LEN, 0.05, shirt, skin, disposables);
  const armR = makeLimb(body, SHOULDER_HALF, SHOULDER_Y, 0, ARM_UP_LEN, ARM_LO_LEN, 0.05, shirt, skin, disposables);
  const handGeo = new THREE.SphereGeometry(0.05, 6, 5);
  disposables.push(handGeo);
  for (const arm of [armL, armR]) {
    const hand = new THREE.Mesh(handGeo, skin);
    hand.castShadow = true;
    arm.end.add(hand);
  }

  // held Tools / carried logs hang off the right hand
  armR.end.add(carryAnchor);

  return { root, body, torso, head, legL, legR, armL, armR, disposables };
}

function disposeRig(rig: Rig, carryAnchor: THREE.Object3D): void {
  // The replacement rig has usually already re-parented the anchor to its own
  // hand; only detach it if it is still hanging off *this* rig.
  if (carryAnchor.parent === rig.armR.end) rig.armR.end.remove(carryAnchor);
  rig.root.removeFromParent();
  for (const d of rig.disposables) d.dispose();
}

// ---------------------------------------------------------------------------
// Pose targets — one set of joint angles, damped toward every frame.

interface Pose {
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  legSpread: number;
  shoulderL: number;
  shoulderR: number;
  shoulderSpread: number;
  elbowL: number;
  elbowR: number;
  lean: number;
  headPitch: number;
}

function freshPose(): Pose {
  return {
    hipL: 0,
    hipR: 0,
    kneeL: 0,
    kneeR: 0,
    legSpread: 0,
    shoulderL: 0,
    shoulderR: 0,
    shoulderSpread: 0.12,
    elbowL: 0,
    elbowR: 0,
    lean: 0,
    headPitch: 0,
  };
}

// ---------------------------------------------------------------------------

export function createPlayer(ctx: GameCtx): PlayerApi {
  const carryAnchor = new THREE.Object3D();
  carryAnchor.position.set(0, -0.02, -0.04);

  let character: CharacterKind = ctx.character ?? 'girl';
  let rig = buildRig(character, carryAnchor);
  ctx.scene.add(rig.root);

  const position = new THREE.Vector3(0, 0, 0);
  const vel = new THREE.Vector3();
  let mode: PlayerMode = 'ground';
  let ridingSwing: SwingInfo | null = null;
  let climbingTree: TreeInfo | null = null;
  let atLookout = false;
  let currentSetIndex = -1;
  let placed = false; // reset() has run at least once

  let facing = 0; // yaw; model forward is -Z
  let runPhase = 0;
  let climbHeight = 0;
  let climbPhase = 0;
  let lookoutEmitted = false;
  let hopCooldown = 0;
  let stunTimer = 0;
  let crouchTimer = 0;
  let pumpKick = 0; // visual kick right after a pump press
  let tumbling = false;
  const tumbleSpin = new THREE.Vector3();

  // seat velocity, differentiated from the seat position each frame
  const lastSeatPos = new THREE.Vector3();
  const seatVel = new THREE.Vector3();
  let haveLastSeat = false;

  let prevLeft = false;
  let prevRight = false;

  const pose = freshPose();
  const target = freshPose();

  // camera rig state
  const camPos = new THREE.Vector3(0, 3, 12);
  const camLook = new THREE.Vector3(0, 1, 0);
  const shakeOffset = new THREE.Vector3();
  let shakeAmp = 0;

  // -------------------------------------------------------------------------

  function groundY(x: number, z: number): number {
    return ctx.world ? ctx.world.groundHeightAt(x, z) : 0;
  }

  function setCharacter(kind: CharacterKind): void {
    if (kind === character && rig) return;
    character = kind;
    const old = rig;
    rig = buildRig(kind, carryAnchor);
    rig.root.position.copy(old.root.position);
    rig.root.rotation.copy(old.root.rotation);
    rig.body.position.copy(old.body.position);
    ctx.scene.add(rig.root);
    disposeRig(old, carryAnchor);
  }

  function firstIntactSwing(setIndex: number): SwingInfo | null {
    const set = ctx.world?.swingsets?.[setIndex];
    if (!set) return null;
    for (const s of set.swings) if (!s.broken) return s;
    return null;
  }

  function mount(swing: SwingInfo): void {
    ridingSwing = swing;
    climbingTree = null;
    atLookout = false;
    tumbling = false;
    mode = 'swinging';
    vel.set(0, 0, 0);
    haveLastSeat = false;
    facing = 0; // seated kids face the water
  }

  function reset(setIndex: number): void {
    placed = true;
    const set = ctx.world?.swingsets?.[setIndex];
    const swing = firstIntactSwing(setIndex);
    vel.set(0, 0, 0);
    tumbling = false;
    tumbleSpin.set(0, 0, 0);
    stunTimer = 0;
    crouchTimer = 0;
    hopCooldown = 0;
    climbHeight = 0;
    climbingTree = null;
    atLookout = false;
    lookoutEmitted = false;
    if (swing) {
      mount(swing);
      swing.seatWorldPos(tmpSeat);
      position.copy(tmpSeat);
    } else {
      mode = 'ground';
      ridingSwing = null;
      const base = set ? set.position : tmpA.set(0, 0, 0);
      position.set(base.x + 2.5, groundY(base.x + 2.5, base.z + 2), base.z + 2);
      facing = 0;
    }
    currentSetIndex = setIndex;
    syncRigTransform();
    // Snap the camera — reset() is the one place we do not ease.
    aimCamera();
    camPos.copy(camDesired);
    camLook.copy(lookDesired);
    shakeAmp = 0;
    applyCamera();
  }

  function bail(dir: number): void {
    if (!ridingSwing) return;
    if (!ridingSwing.broken) {
      ridingSwing.seatWorldPos(tmpSeat);
      position.copy(tmpSeat);
    }
    vel.copy(seatVel);
    vel.x += dir * BAIL_SIDE_IMPULSE;
    vel.y += BAIL_UP_IMPULSE;
    ridingSwing = null;
    mode = 'airborne';
    tumbling = false;
    hopCooldown = HOP_COOLDOWN;
    facing = Math.atan2(-dir, 0);
  }

  function tumbleOff(): void {
    if (!ridingSwing) return;
    // A Broken Swing has already dropped its seat to the ground: keep the kid
    // where they were riding instead of snapping down to it.
    if (!ridingSwing.broken) {
      ridingSwing.seatWorldPos(tmpSeat);
      position.copy(tmpSeat);
    }
    vel.copy(seatVel);
    vel.x += (Math.random() - 0.5) * 4;
    vel.y += 2.5 + Math.random() * 1.5;
    vel.z += (Math.random() - 0.5) * 3;
    ridingSwing = null;
    mode = 'airborne';
    tumbling = true;
    tumbleSpin.set(
      (Math.random() * 6 + 5) * (Math.random() < 0.5 ? -1 : 1),
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 6,
    );
    hopCooldown = HOP_COOLDOWN;
    cameraShake(0.5);
  }

  function land(): void {
    position.y = groundY(position.x, position.z);
    vel.set(0, 0, 0);
    mode = 'ground';
    crouchTimer = 0.25;
    if (tumbling) {
      stunTimer = STUN_SECONDS;
      tumbling = false;
    }
    tumbleSpin.set(0, 0, 0);
  }

  // --- per-mode simulation -------------------------------------------------

  function updateSwinging(dt: number, active: boolean): void {
    const swing = ridingSwing;
    if (!swing) {
      mode = 'ground';
      return;
    }
    if (swing.broken) {
      tumbleOff();
      return;
    }

    swing.seatWorldPos(tmpSeat);
    if (haveLastSeat && dt > 0) {
      seatVel.subVectors(tmpSeat, lastSeatPos).divideScalar(dt);
    } else {
      seatVel.set(0, 0, 0);
    }
    lastSeatPos.copy(tmpSeat);
    haveLastSeat = true;
    position.copy(tmpSeat);

    if (!active) return;

    if (ctx.input.pumpPressed) {
      swing.pump(PUMP_STRENGTH);
      pumpKick = 1;
    }

    // Bail on a fresh left/right press.
    if (ctx.input.left && !prevLeft) bail(-1);
    else if (ctx.input.right && !prevRight) bail(1);
  }

  function updateAirborne(dt: number): void {
    vel.y -= GRAVITY * dt;
    position.addScaledVector(vel, dt);
    if (tumbling) {
      rig.root.rotation.x += tumbleSpin.x * dt;
      rig.root.rotation.y += tumbleSpin.y * dt;
      rig.root.rotation.z += tumbleSpin.z * dt;
    }
    const gy = groundY(position.x, position.z);
    if (position.y <= gy && vel.y <= 0) land();
  }

  function nearestTree(): TreeInfo | null {
    const trees = ctx.world?.trees;
    if (!trees) return null;
    let best: TreeInfo | null = null;
    let bestD = CLIMB_RADIUS * CLIMB_RADIUS;
    for (const t of trees) {
      if (t.state !== 'alive') continue;
      const dx = t.position.x - position.x;
      const dz = t.position.z - position.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  function nearestSeat(): SwingInfo | null {
    const sets = ctx.world?.swingsets;
    if (!sets) return null;
    let best: SwingInfo | null = null;
    let bestD = HOP_ON_RADIUS * HOP_ON_RADIUS;
    for (const set of sets) {
      for (const s of set.swings) {
        if (s.broken) continue;
        const dx = s.restSeatPos.x - position.x;
        const dz = s.restSeatPos.z - position.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    return best;
  }

  function startClimb(tree: TreeInfo): void {
    climbingTree = tree;
    mode = 'climbing';
    climbHeight = 0;
    lookoutEmitted = false;
    atLookout = false;
    vel.set(0, 0, 0);
    facing = Math.PI; // hug the trunk, back to the camera
  }

  function updateGround(dt: number, active: boolean): void {
    position.y = groundY(position.x, position.z);
    if (stunTimer > 0) {
      stunTimer -= dt;
      vel.set(0, 0, 0);
      return;
    }
    if (!active) {
      vel.set(0, 0, 0);
      return;
    }

    const inp = ctx.input;
    const mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const mz = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);

    // Climbing beats walking away from the water.
    if (inp.up) {
      const tree = nearestTree();
      if (tree) {
        startClimb(tree);
        return;
      }
    }

    vel.set(mx * RUN_SPEED_X, 0, mz * RUN_SPEED_Z);
    position.x += vel.x * dt;
    position.z += vel.z * dt;
    position.y = groundY(position.x, position.z);

    if (mx !== 0 || mz !== 0) {
      const want = Math.atan2(-vel.x, -vel.z);
      facing = shortestTurn(facing, want, dt);
      runPhase += dt * (Math.hypot(vel.x, vel.z) / 0.55) * 2;
    } else {
      runPhase = damp(runPhase % (Math.PI * 2), 0, 6, dt);
    }

    // Auto hop-on: run into an intact seat and you are riding again.
    if (hopCooldown <= 0) {
      const seat = nearestSeat();
      if (seat) mount(seat);
    }
  }

  function updateClimbing(dt: number, active: boolean): void {
    const tree = climbingTree;
    if (!tree || tree.state !== 'alive') {
      climbingTree = null;
      atLookout = false;
      mode = 'airborne';
      vel.set(0, 0, 0);
      return;
    }
    tree.topPos(tmpTop);
    const baseY = tree.position.y;
    const maxClimb = Math.max(0.5, tmpTop.y - baseY - 0.45);

    if (active) {
      const inp = ctx.input;
      if (inp.up) climbHeight += CLIMB_SPEED * dt;
      else if (inp.down) climbHeight -= CLIMB_SPEED * dt;
      if (inp.up || inp.down) climbPhase += dt * 5;

      if (climbHeight <= 0 && inp.down) {
        // Back on solid ground.
        climbingTree = null;
        atLookout = false;
        climbHeight = 0;
        mode = 'ground';
        position.set(tree.position.x, groundY(tree.position.x, tree.position.z + 0.8), tree.position.z + 0.8);
        hopCooldown = Math.max(hopCooldown, 0.4);
        return;
      }
    }
    climbHeight = clamp(climbHeight, 0, maxClimb);

    // Cling to the camera-side face of the trunk.
    position.set(tree.position.x, baseY + climbHeight, tree.position.z + 0.34);

    const wasAt = atLookout;
    atLookout = climbHeight >= maxClimb - 0.05;
    if (atLookout && !wasAt && !lookoutEmitted) {
      lookoutEmitted = true;
      ctx.events.emit('lookoutReached', { tree });
    }
  }

  function shortestTurn(from: number, to: number, dt: number): number {
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return from + delta * (1 - Math.exp(-14 * dt));
  }

  // --- posing --------------------------------------------------------------

  function poseSwinging(): void {
    const swing = ridingSwing!;
    const a = swing.angle;
    const av = swing.angularVel;
    // Legs kick out toward the water on the forward push, tuck on the backswing.
    const kick = clamp(av * 0.9 + a * 0.35, -1, 1);
    const extend = (kick + 1) * 0.5; // 0 = tucked, 1 = straight out front
    const hip = lerp(-2.0, -1.15, extend); // thighs always forward off the seat
    const knee = lerp(1.5, 0.15, extend);
    target.hipL = hip;
    target.hipR = hip + 0.06;
    target.kneeL = knee;
    target.kneeR = knee;
    target.legSpread = 0.1;
    // Hands up on the chains.
    target.shoulderL = -2.5;
    target.shoulderR = -2.5;
    target.shoulderSpread = 0.16;
    target.elbowL = 0.55 - extend * 0.3;
    target.elbowR = 0.55 - extend * 0.3;
    target.lean = -0.25 + kick * 0.35 + pumpKick * 0.25;
    target.headPitch = -0.12 - kick * 0.12;
  }

  function poseAirborne(): void {
    const rising = vel.y > 0;
    target.hipL = rising ? -0.9 : -0.35;
    target.hipR = rising ? -0.5 : -0.7;
    target.kneeL = rising ? 1.2 : 0.5;
    target.kneeR = rising ? 0.7 : 0.9;
    target.legSpread = 0.18;
    target.shoulderL = -2.3;
    target.shoulderR = -2.0;
    target.shoulderSpread = 0.5;
    target.elbowL = 0.5;
    target.elbowR = 0.7;
    target.lean = tumbling ? 0.15 : -0.12;
    target.headPitch = 0.1;
  }

  function poseGround(): void {
    const speed = Math.hypot(vel.x, vel.z);
    const amp = clamp(speed / RUN_SPEED_X, 0, 1);
    const s = Math.sin(runPhase);
    const c = Math.cos(runPhase);
    const crouch = crouchTimer > 0 ? crouchTimer / 0.25 : 0;
    const stun = stunTimer > 0 ? 1 : 0;
    target.hipL = s * 0.85 * amp - crouch * 0.55 - stun * 0.2;
    target.hipR = -s * 0.85 * amp - crouch * 0.55 - stun * 0.2;
    target.kneeL = (0.35 + Math.max(0, -c) * 0.9) * amp + crouch * 1.1 + stun * 0.5;
    target.kneeR = (0.35 + Math.max(0, c) * 0.9) * amp + crouch * 1.1 + stun * 0.5;
    target.legSpread = 0.07;
    target.shoulderL = -s * 0.7 * amp - stun * 0.4;
    target.shoulderR = s * 0.7 * amp - stun * 0.4;
    target.shoulderSpread = 0.12 + amp * 0.05;
    target.elbowL = 0.45 + amp * 0.5;
    target.elbowR = 0.45 + amp * 0.5;
    target.lean = -amp * 0.18 - crouch * 0.25 + stun * 0.3;
    target.headPitch = -amp * 0.05;
  }

  function poseClimbing(): void {
    const s = Math.sin(climbPhase);
    target.hipL = -0.8 + s * 0.4;
    target.hipR = -0.8 - s * 0.4;
    target.kneeL = 1.3 - s * 0.4;
    target.kneeR = 1.3 + s * 0.4;
    target.legSpread = 0.45;
    target.shoulderL = -2.7 - s * 0.3;
    target.shoulderR = -2.7 + s * 0.3;
    target.shoulderSpread = 0.35;
    target.elbowL = 0.9;
    target.elbowR = 0.9;
    target.lean = 0.1;
    target.headPitch = atLookout ? -0.2 : 0.05;
  }

  function applyPose(dt: number): void {
    const k = 14;
    pose.hipL = damp(pose.hipL, target.hipL, k, dt);
    pose.hipR = damp(pose.hipR, target.hipR, k, dt);
    pose.kneeL = damp(pose.kneeL, target.kneeL, k, dt);
    pose.kneeR = damp(pose.kneeR, target.kneeR, k, dt);
    pose.legSpread = damp(pose.legSpread, target.legSpread, k, dt);
    pose.shoulderL = damp(pose.shoulderL, target.shoulderL, k, dt);
    pose.shoulderR = damp(pose.shoulderR, target.shoulderR, k, dt);
    pose.shoulderSpread = damp(pose.shoulderSpread, target.shoulderSpread, k, dt);
    pose.elbowL = damp(pose.elbowL, target.elbowL, k, dt);
    pose.elbowR = damp(pose.elbowR, target.elbowR, k, dt);
    pose.lean = damp(pose.lean, target.lean, k, dt);
    pose.headPitch = damp(pose.headPitch, target.headPitch, k, dt);

    rig.legL.upper.rotation.set(pose.hipL, 0, -pose.legSpread);
    rig.legR.upper.rotation.set(pose.hipR, 0, pose.legSpread);
    rig.legL.lower.rotation.x = pose.kneeL;
    rig.legR.lower.rotation.x = pose.kneeR;
    rig.armL.upper.rotation.set(pose.shoulderL, 0, -pose.shoulderSpread);
    rig.armR.upper.rotation.set(pose.shoulderR, 0, pose.shoulderSpread);
    rig.armL.lower.rotation.x = pose.elbowL;
    rig.armR.lower.rotation.x = pose.elbowR;
    rig.torso.rotation.x = pose.lean;
    rig.head.rotation.x = pose.headPitch - pose.lean;
  }

  function syncRigTransform(): void {
    if (mode === 'swinging' && ridingSwing) {
      // Sit on the seat: shift the body so the hips land on the origin, and
      // let the whole kid ride the rope's lean.
      rig.root.position.copy(position);
      rig.body.position.y = -HIP_Y;
      rig.root.rotation.set(ridingSwing.angle * 0.85, 0, 0);
    } else {
      rig.root.position.copy(position);
      rig.body.position.y = 0;
      if (!(mode === 'airborne' && tumbling)) {
        rig.root.rotation.set(0, facing, 0);
      }
    }
  }

  // --- camera --------------------------------------------------------------

  /** Fill camDesired / lookDesired for the current mode. */
  function aimCamera(): void {
    if (mode === 'swinging' && ridingSwing) {
      const rest = ridingSwing.restSeatPos;
      camDesired.set(rest.x, rest.y + 2.2, rest.z + 4.5);
      lookDesired.set(rest.x, rest.y + 0.9, rest.z - 4.0);
      // A touch of drift with the swing so the arc reads on screen.
      lookDesired.z -= ridingSwing.angle * 1.2;
    } else if (mode === 'climbing' && atLookout) {
      // Survey the Playground from the Lookout.
      camDesired.set(position.x, position.y + 25, position.z + 18);
      const other = nearestOtherSet();
      if (other) {
        lookDesired.set(
          lerp(position.x, other.x, 0.55),
          lerp(position.y, 1, 0.6),
          lerp(position.z, other.z, 0.55),
        );
      } else {
        lookDesired.set(position.x, 1, position.z - 30);
      }
    } else if (mode === 'climbing') {
      camDesired.set(position.x, position.y + 2.4, position.z + 7.5);
      lookDesired.set(position.x, position.y + 0.8, position.z - 2);
    } else {
      // Ground / airborne follow-cam, leading a little in the run direction.
      const leadX = clamp(vel.x, -RUN_SPEED_X, RUN_SPEED_X) * 0.28;
      const leadZ = clamp(vel.z, -RUN_SPEED_Z, RUN_SPEED_Z) * 0.28;
      camDesired.set(position.x + leadX * 0.5, position.y + 3.1, position.z + 6.8);
      lookDesired.set(position.x + leadX * 1.6, position.y + 1.1, position.z + leadZ * 1.6 - 2.2);
    }
  }

  /** XZ of the nearest OTHER swingset that still has an intact swing. */
  function nearestOtherSet(): THREE.Vector3 | null {
    const sets = ctx.world?.swingsets;
    if (!sets) return null;
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (const set of sets) {
      if (set.index === currentSetIndex) continue;
      if (!set.swings.some((s) => !s.broken)) continue;
      const dx = set.position.x - position.x;
      const dz = set.position.z - position.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = set.position;
      }
    }
    return best;
  }

  function applyCamera(): void {
    tmpC.copy(camPos).add(shakeOffset);
    ctx.camera.position.copy(tmpC);
    ctx.camera.lookAt(camLook);
  }

  /** A Lookout is the only way to see another Swingset: the fog opens up far
   *  enough to reveal the nearest one, and closes again on the way down. */
  function updateFog(dt: number): void {
    const fog = ctx.scene.fog;
    if (!fog || !(fog instanceof THREE.Fog)) return;
    let far = FOG_FAR;
    let near = FOG_NEAR;
    if (mode === 'climbing' && atLookout) {
      const other = nearestOtherSet();
      if (other) {
        const d = Math.hypot(other.x - position.x, other.z - position.z);
        far = Math.max(FOG_FAR, d + 30);
        near = Math.max(FOG_NEAR, d * 0.6);
      }
    }
    fog.near = damp(fog.near, near, 1.6, dt);
    fog.far = damp(fog.far, far, 1.6, dt);
  }

  function updateCamera(dt: number): void {
    aimCamera();
    updateFog(dt);
    const k = mode === 'climbing' && atLookout ? 2.2 : 4.5;
    camPos.x = damp(camPos.x, camDesired.x, k, dt);
    camPos.y = damp(camPos.y, camDesired.y, k, dt);
    camPos.z = damp(camPos.z, camDesired.z, k, dt);
    camLook.x = damp(camLook.x, lookDesired.x, k * 1.2, dt);
    camLook.y = damp(camLook.y, lookDesired.y, k * 1.2, dt);
    camLook.z = damp(camLook.z, lookDesired.z, k * 1.2, dt);

    if (shakeAmp > 0.0005) {
      shakeAmp *= Math.exp(-SHAKE_DECAY * dt);
      shakeOffset.set(
        (Math.random() - 0.5) * 2 * shakeAmp,
        (Math.random() - 0.5) * 2 * shakeAmp,
        (Math.random() - 0.5) * 2 * shakeAmp,
      );
    } else {
      shakeAmp = 0;
      shakeOffset.set(0, 0, 0);
    }
    applyCamera();
  }

  function cameraShake(intensity: number): void {
    shakeAmp = Math.max(shakeAmp, clamp(intensity, 0, 2) * 0.5);
  }

  // --- swingset tracking ---------------------------------------------------

  function updateSetIndex(active: boolean): void {
    const sets = ctx.world?.swingsets;
    if (!sets || sets.length === 0) return;
    let nearest = currentSetIndex;
    let bestD = Infinity;
    for (const set of sets) {
      const dx = set.position.x - position.x;
      const dz = set.position.z - position.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        nearest = set.index;
      }
    }
    if (nearest !== currentSetIndex) {
      const wasUnset = currentSetIndex < 0;
      currentSetIndex = nearest;
      const set = sets[nearest];
      // Only a real arrival during a Run counts: on the menus this would score
      // points and move the Ship before the Run has started.
      if (active && !wasUnset && set && set.swings.some((s) => !s.broken)) {
        ctx.events.emit('swingsetArrived', { index: nearest });
      }
    }
  }

  // --- frame ---------------------------------------------------------------

  function update(dt: number): void {
    const active = ctx.screen === 'playing';

    // The title screen runs before any Run: put the kid on a Swing the first
    // time the world is reachable, instead of leaving them at the origin.
    if (!placed) {
      placed = true;
      reset(0);
    }

    if (hopCooldown > 0) hopCooldown -= dt;
    if (crouchTimer > 0) crouchTimer -= dt;
    if (pumpKick > 0) pumpKick = Math.max(0, pumpKick - dt * 4);

    switch (mode) {
      case 'swinging':
        updateSwinging(dt, active);
        break;
      case 'airborne':
        updateAirborne(dt);
        break;
      case 'ground':
        updateGround(dt, active);
        break;
      case 'climbing':
        updateClimbing(dt, active);
        break;
    }

    if (active) {
      prevLeft = ctx.input.left;
      prevRight = ctx.input.right;
    } else {
      prevLeft = false;
      prevRight = false;
    }

    switch (mode) {
      case 'swinging':
        poseSwinging();
        break;
      case 'airborne':
        poseAirborne();
        break;
      case 'ground':
        poseGround();
        break;
      case 'climbing':
        poseClimbing();
        break;
    }
    applyPose(dt);
    syncRigTransform();
    updateSetIndex(active);
    updateCamera(dt);
  }

  // Keep an initial sane transform (world data may not exist yet).
  syncRigTransform();

  return {
    position,
    get mode() {
      return mode;
    },
    get ridingSwing() {
      return ridingSwing;
    },
    get climbingTree() {
      return climbingTree;
    },
    get atLookout() {
      return atLookout;
    },
    get currentSetIndex() {
      return currentSetIndex;
    },
    setCharacter,
    reset,
    tumbleOff,
    carryAnchor,
    cameraShake,
    update,
  };
}
