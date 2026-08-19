// player.ts — the Character (boy/girl kid), the movement state machine
// (swinging / airborne / ground / climbing / zipline) and the camera rig.
//
// See CONTEXT.md for vocabulary and types.ts for the module contract.
// World conventions: the game plays in each island's frame — `frameF` points
// from the island toward the Ship's water at the archipelago centre, `frameR`
// to the player's screen-right, and the camera sits on the -frameF side. A
// Swing's positive `angle` carries the seat toward the Ship.

import * as THREE from 'three';
import {
  ARCHIPELAGO_CENTER,
  type CharacterKind,
  FOG_FAR,
  FOG_NEAR,
  type GameCtx,
  type PlayerApi,
  type PlayerMode,
  SWINGSET_POSITIONS,
  setYaw,
  type SwingInfo,
  towardCenter,
  type TreeInfo,
  ZIP_HANG,
  ZIP_SAG,
  ZIP_SPEED,
  ringNeighbors,
} from './types';
import { clamp, damp, lerp } from './util';
import { toonMat } from './toon';

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
const WADE_MIN = -0.35; // deepest the kid may wade below the waterline

// --- scratch (no per-frame allocations) ------------------------------------

const tmpA = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpSeat = new THREE.Vector3();
const tmpTop = new THREE.Vector3();
const tmpRopeTo = new THREE.Vector3();
const camDesired = new THREE.Vector3();
const lookDesired = new THREE.Vector3();
const zipOut = new THREE.Vector3();

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

function mat(color: number): THREE.MeshToonMaterial {
  return toonMat({ color, flatShading: true });
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
  const skin = mat(kind === 'boy' ? 0xf2c090 : 0xecb282);
  const hair = mat(kind === 'boy' ? 0x8a5228 : 0x9a5c2e);
  const shirt = mat(kind === 'boy' ? 0x4cc264 : 0xf06a92);
  const pants = mat(kind === 'boy' ? 0x4a6ad8 : 0x8a5cc8);
  const shoe = mat(0x3c4258);
  disposables.push(skin, hair, shirt, pants, shoe);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ'; // yaw to the island frame, then lean/tumble
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
  const eyeMat = mat(0x241c14);
  disposables.push(eyeMat);
  for (const ex of [-0.05, 0.05]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(ex, 0.02, -HEAD_R * 0.98);
    head.add(eye);
  }

  // hair — tilted back so the rim sits on the forehead and covers the nape,
  // leaving the face (and the eyes) clear.
  const capGeo = new THREE.SphereGeometry(HEAD_R * 1.06, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.52);
  disposables.push(capGeo);
  const cap = new THREE.Mesh(capGeo, hair);
  cap.position.y = 0.012;
  cap.rotation.x = 0.38;
  cap.castShadow = true;
  head.add(cap);

  if (kind === 'girl') {
    const fringeGeo = new THREE.BoxGeometry(0.18, 0.045, 0.05);
    disposables.push(fringeGeo);
    const fringe = new THREE.Mesh(fringeGeo, hair);
    fringe.position.set(0, 0.055, -HEAD_R * 0.85);
    head.add(fringe);
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
// Throw overlay — the projectile leaves the hand on the button press, so there
// is nothing to wind up: the animation starts AT the release frame and plays
// the whip over the top plus the follow-through. Keyed in continuous radians
// on the right shoulder (see the sign convention above applyPose's callers):
// -3.0 ~ overhead and a touch behind, -4.7 ~ straight out front, -5.9 ~ down
// across the body. It is applied after applyPose()'s damping so it stays
// snappy, and its blend weight fades to 0 to hand control back smoothly.

const THROW_TIME = 0.42;

interface ThrowKey {
  t: number;
  shoulder: number;
  elbow: number;
  lean: number;
}

const THROW_KEYS: ThrowKey[] = [
  { t: 0.0, shoulder: -3.0, elbow: 0.95, lean: 0.12 },
  { t: 0.1, shoulder: -4.7, elbow: 0.15, lean: -0.28 },
  { t: 0.22, shoulder: -5.5, elbow: 0.35, lean: -0.34 },
  { t: THROW_TIME, shoulder: -5.9, elbow: 0.6, lean: -0.1 },
];

/** Ease in over 3 frames so the arm snaps without popping, out over the tail. */
function throwWeight(t: number): number {
  const rise = clamp(t / 0.05, 0, 1);
  const fall = clamp((THROW_TIME - t) / (THROW_TIME - 0.28), 0, 1);
  const w = Math.min(rise, fall * fall * (3 - 2 * fall));
  return clamp(w, 0, 1);
}

function sampleThrow(t: number, out: ThrowKey): void {
  let i = 0;
  while (i < THROW_KEYS.length - 2 && t > THROW_KEYS[i + 1].t) i++;
  const a = THROW_KEYS[i];
  const b = THROW_KEYS[i + 1];
  const k = clamp((t - a.t) / (b.t - a.t), 0, 1);
  out.t = t;
  out.shoulder = lerp(a.shoulder, b.shoulder, k);
  out.elbow = lerp(a.elbow, b.elbow, k);
  out.lean = lerp(a.lean, b.lean, k);
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

  // Throw overlay: seconds since the release, or -1 when idle.
  let throwTimer = -1;
  const throwKey: ThrowKey = { t: 0, shoulder: 0, elbow: 0, lean: 0 };
  // Any throw restarts the overlay from the release frame.
  ctx.events.on('itemThrown', () => {
    throwTimer = 0;
  });

  // camera rig state
  const camPos = new THREE.Vector3(0, 3, 12);
  const camLook = new THREE.Vector3(0, 1, 0);
  const shakeOffset = new THREE.Vector3();
  let shakeAmp = 0;

  // Island frame: frameF points from the player's island toward the Ship's
  // water at the centre; frameR is screen-right; frameYaw faces the Ship.
  const frameF = new THREE.Vector3(0, 0, -1);
  const frameR = new THREE.Vector3(1, 0, 0);
  let frameYaw = 0;

  // Zip-line ride state.
  const zipFrom = new THREE.Vector3();
  const zipTo = new THREE.Vector3();
  const zipDir = new THREE.Vector3(); // horizontal ride direction
  let zipLen = 1;
  let zipP = 0;
  let zipToSet = -1;
  let zipShot = -1; // committed cinematic shot; -1 forces a snap cut
  let zipShotNow = 0; // shot aimCamera wants this frame

  // Zip cables: two ink lines (one per ring neighbour) that fade in at a
  // Lookout; the chosen one stays up for the whole ride.
  const ROPE_PTS = 24;
  interface Rope {
    line: THREE.Line;
    geo: THREE.BufferGeometry;
    mat: THREE.LineBasicMaterial;
    opacity: number;
    target: number;
    toSet: number;
  }
  const ropes: Rope[] = [];
  for (let i = 0; i < 2; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ROPE_PTS * 3), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x2b2318, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.visible = false;
    ctx.scene.add(line);
    ropes.push({ line, geo, mat, opacity: 0, target: 0, toSet: -1 });
  }

  /** A point along the cable, drooping ZIP_SAG at most mid-span. */
  function cablePoint(
    from: THREE.Vector3,
    to: THREE.Vector3,
    t: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    out.lerpVectors(from, to, t);
    const sag = Math.min(ZIP_SAG, from.distanceTo(to) * 0.03);
    out.y -= sag * 4 * t * (1 - t);
    return out;
  }

  function fillRope(rope: Rope, from: THREE.Vector3, to: THREE.Vector3): void {
    const attr = rope.geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ROPE_PTS; i++) {
      cablePoint(from, to, i / (ROPE_PTS - 1), tmpA);
      attr.setXYZ(i, tmpA.x, tmpA.y, tmpA.z);
    }
    attr.needsUpdate = true;
  }

  // -------------------------------------------------------------------------

  function groundY(x: number, z: number): number {
    return ctx.world ? ctx.world.groundHeightAt(x, z) : 0;
  }

  /** Recompute the island frame the player is currently playing in. */
  function updateFrame(): void {
    let idx = currentSetIndex;
    if (mode === 'climbing' && climbingTree) idx = climbingTree.setIndex;
    else if (mode === 'swinging' && ridingSwing) idx = ridingSwing.setIndex;
    const f = towardCenter(idx >= 0 ? idx : 0);
    frameF.set(f.x, 0, f.z);
    frameR.set(-f.z, 0, f.x);
    frameYaw = Math.atan2(-f.x, -f.z);
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
    facing = setYaw(swing.setIndex); // seated kids face the Ship's water
    updateFrame();
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
    throwTimer = -1;
    zipToSet = -1;
    zipP = 0;
    currentSetIndex = setIndex;
    updateFrame();
    if (swing) {
      mount(swing);
      swing.seatWorldPos(tmpSeat);
      position.copy(tmpSeat);
    } else {
      mode = 'ground';
      ridingSwing = null;
      const base = set ? set.position : tmpA.set(0, 0, 0);
      position.set(
        base.x + frameR.x * 2.5 - frameF.x * 2,
        0,
        base.z + frameR.z * 2.5 - frameF.z * 2,
      );
      position.y = groundY(position.x, position.z);
      facing = frameYaw;
    }
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
    vel.x += frameR.x * dir * BAIL_SIDE_IMPULSE;
    vel.z += frameR.z * dir * BAIL_SIDE_IMPULSE;
    vel.y += BAIL_UP_IMPULSE;
    ridingSwing = null;
    mode = 'airborne';
    tumbling = false;
    hopCooldown = HOP_COOLDOWN;
    facing = Math.atan2(-frameR.x * dir, -frameR.z * dir);
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
    position.y = Math.max(groundY(position.x, position.z), WADE_MIN);
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
    // The kid clings to the camera-side face of the trunk, so facing the
    // trunk (toward the Ship) puts their back to the camera.
    facing = setYaw(tree.setIndex);
    updateFrame();
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

    // mx runs along the island's screen-right axis, mz away from the Ship.
    vel.set(
      frameR.x * mx * RUN_SPEED_X - frameF.x * mz * RUN_SPEED_Z,
      0,
      frameR.z * mx * RUN_SPEED_X - frameF.z * mz * RUN_SPEED_Z,
    );
    // Soft shoreline: the kid can wade a step or two but never deeper —
    // each axis moves only toward ground above the wade line (or uphill,
    // so a splashdown in the shallows can always walk back out).
    const curH = groundY(position.x, position.z);
    const nx = position.x + vel.x * dt;
    const nz = position.z + vel.z * dt;
    const nxH = groundY(nx, position.z);
    if (nxH > WADE_MIN || nxH > curH) position.x = nx;
    else vel.x = 0;
    const nzH = groundY(position.x, nz);
    if (nzH > WADE_MIN || nzH > curH) position.z = nz;
    else vel.z = 0;
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
        position.set(
          tree.position.x - frameF.x * 0.8,
          0,
          tree.position.z - frameF.z * 0.8,
        );
        position.y = groundY(position.x, position.z);
        hopCooldown = Math.max(hopCooldown, 0.4);
        return;
      }
    }
    climbHeight = clamp(climbHeight, 0, maxClimb);

    // Cling to the camera-side face of the trunk.
    position.set(
      tree.position.x - frameF.x * 0.34,
      baseY + climbHeight,
      tree.position.z - frameF.z * 0.34,
    );

    const wasAt = atLookout;
    atLookout = climbHeight >= maxClimb - 0.05;
    if (atLookout) layoutLookoutRopes(tree);
    if (atLookout && !wasAt && !lookoutEmitted) {
      lookoutEmitted = true;
      ctx.events.emit('lookoutReached', { tree });
    }
    // Grab a zip line: left/right at the treetop rides to that neighbour.
    if (atLookout && active) {
      if (ctx.input.right && !prevRight) startZip(ropes[0].toSet);
      else if (ctx.input.left && !prevLeft) startZip(ropes[1].toSet);
    }
  }

  /** Lay both cables out from the climbed treetop and map them to screen
   *  sides: ropes[0] rides on a Right press, ropes[1] on Left. */
  function layoutLookoutRopes(tree: TreeInfo): void {
    tree.topPos(tmpTop);
    tmpTop.y += 0.35;
    const [a, b] = ringNeighbors(tree.setIndex);
    // Screen-right from the current camera: (look - cam) × up, flattened.
    tmpC.subVectors(camLook, camPos).setY(0).normalize();
    const rx = -tmpC.z;
    const rz = tmpC.x;
    const pa = SWINGSET_POSITIONS[a];
    const pb = SWINGSET_POSITIONS[b];
    const dotA = (pa.x - position.x) * rx + (pa.z - position.z) * rz;
    const dotB = (pb.x - position.x) * rx + (pb.z - position.z) * rz;
    const rightSet = dotA >= dotB ? a : b;
    const leftSet = dotA >= dotB ? b : a;
    ropes[0].toSet = rightSet;
    tmpRopeTo.copy(ctx.world.zipPostTop(rightSet, tree.setIndex));
    fillRope(ropes[0], tmpTop, tmpRopeTo);
    ropes[1].toSet = leftSet;
    tmpRopeTo.copy(ctx.world.zipPostTop(leftSet, tree.setIndex));
    fillRope(ropes[1], tmpTop, tmpRopeTo);
  }

  function startZip(toSet: number): void {
    const tree = climbingTree;
    if (!tree || toSet < 0) return;
    const fromSet = tree.setIndex;
    tree.topPos(zipFrom);
    zipFrom.y += 0.35;
    zipTo.copy(ctx.world.zipPostTop(toSet, fromSet));
    zipDir.subVectors(zipTo, zipFrom).setY(0).normalize();
    zipLen = zipFrom.distanceTo(zipTo);
    zipP = 0;
    zipShot = -1;
    zipToSet = toSet;
    climbingTree = null;
    atLookout = false;
    ridingSwing = null;
    tumbling = false;
    vel.set(0, 0, 0);
    mode = 'zipline';
    facing = Math.atan2(-zipDir.x, -zipDir.z);
    // The ride is locked on: a Heart lost to a mid-ride hit fells a Tree on
    // the DESTINATION island, so the index moves at launch.
    currentSetIndex = toSet;
    updateFrame();
    ctx.events.emit('zipStarted', { fromSet, toSet });
  }

  function updateZipline(dt: number): void {
    zipP += (dt * ZIP_SPEED) / Math.max(zipLen, 1);
    const p = Math.min(zipP, 1);
    cablePoint(zipFrom, zipTo, p, tmpA);
    position.set(tmpA.x, tmpA.y - ZIP_HANG, tmpA.z);
    facing = Math.atan2(-zipDir.x, -zipDir.z);
    if (zipP >= 1) {
      // Step off past the post, onto the island.
      position.x = zipTo.x + zipDir.x * 1.6;
      position.z = zipTo.z + zipDir.z * 1.6;
      position.y = groundY(position.x, position.z);
      mode = 'ground';
      crouchTimer = 0.25;
      hopCooldown = 0.8;
      // Only a real arrival during a Run counts (matches updateSetIndex).
      const set = ctx.world?.swingsets?.[zipToSet];
      if (ctx.screen === 'playing' && set && set.swings.some((s) => !s.broken)) {
        ctx.events.emit('swingsetArrived', { index: zipToSet });
      }
      zipToSet = -1;
    }
  }

  function shortestTurn(from: number, to: number, dt: number): number {
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return from + delta * (1 - Math.exp(-14 * dt));
  }

  // --- posing --------------------------------------------------------------
  //
  // Joint sign convention (model faces -Z): positive hip/shoulder rotation.x
  // swings the limb FORWARD (toward -Z). A natural knee only flexes BACKWARD,
  // so knee values must be <= 0; a natural elbow flexes forward, so elbow
  // values are >= 0. Positive torso lean / head pitch tips BACKWARD.

  function poseSwinging(): void {
    const swing = ridingSwing!;
    const a = swing.angle;
    const av = swing.angularVel;
    // Legs kick out toward the water on the forward push, tuck on the backswing.
    const kick = clamp(av * 0.9 + a * 0.35, -1, 1);
    const extend = (kick + 1) * 0.5; // 0 = tucked, 1 = straight out front
    const hip = lerp(0.6, 1.45, extend); // thighs always forward over the seat
    const knee = lerp(-1.9, -0.2, extend); // shins tuck under, then swing out
    target.hipL = hip;
    target.hipR = hip + 0.06;
    target.kneeL = knee;
    target.kneeR = knee;
    target.legSpread = 0.08;
    // Hands up on the chains (they run from the seat edges, slightly outside
    // the shoulders, up to the bar).
    target.shoulderL = 2.75;
    target.shoulderR = 2.75;
    target.shoulderSpread = 0.3;
    target.elbowL = 0.35;
    target.elbowR = 0.35;
    // Lean back on the forward kick, curl forward on the tuck.
    target.lean = -0.05 + kick * 0.35 + pumpKick * 0.2;
    target.headPitch = -0.05 - kick * 0.1;
  }

  function poseAirborne(): void {
    const rising = vel.y > 0;
    target.hipL = rising ? 0.9 : 0.35;
    target.hipR = rising ? 0.5 : 0.7;
    target.kneeL = rising ? -1.2 : -0.5;
    target.kneeR = rising ? -0.7 : -0.9;
    target.legSpread = 0.18;
    target.shoulderL = 2.3;
    target.shoulderR = 2.0;
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
    // Hips scissor; each knee folds while its leg swings through (hip moving
    // forward, cos > 0 for the left leg) and is straight during stance.
    target.hipL = s * 0.85 * amp + crouch * 0.5 + stun * 0.2;
    target.hipR = -s * 0.85 * amp + crouch * 0.5 + stun * 0.2;
    target.kneeL = -(0.12 + Math.max(0, c) * 0.95) * amp - crouch * 1.0 - stun * 0.5;
    target.kneeR = -(0.12 + Math.max(0, -c) * 0.95) * amp - crouch * 1.0 - stun * 0.5;
    target.legSpread = 0.07;
    target.shoulderL = -s * 0.7 * amp - stun * 0.4;
    target.shoulderR = s * 0.7 * amp - stun * 0.4;
    target.shoulderSpread = 0.12 + amp * 0.05;
    target.elbowL = 0.45 + amp * 0.5;
    target.elbowR = 0.45 + amp * 0.5;
    if (ctx.tools?.heldInHand) {
      // Carry arm: hold the Tool up in front instead of pumping it. Skipped
      // while the Hammer is out on its boomerang flight — the hand is empty.
      target.shoulderR = 0.55;
      target.elbowR = 1.0;
    }
    target.lean = -amp * 0.18 - crouch * 0.25 + stun * 0.3;
    target.headPitch = -amp * 0.05;
  }

  function poseClimbing(): void {
    const s = Math.sin(climbPhase);
    // Knees lift toward the trunk, heels tucked; arms reach up hand over hand.
    target.hipL = 0.9 + s * 0.35;
    target.hipR = 0.9 - s * 0.35;
    target.kneeL = -1.5 + s * 0.3;
    target.kneeR = -1.5 - s * 0.3;
    target.legSpread = 0.3;
    target.shoulderL = 2.6 + s * 0.25;
    target.shoulderR = 2.6 - s * 0.25;
    target.shoulderSpread = 0.35;
    target.elbowL = 0.5;
    target.elbowR = 0.5;
    target.lean = -0.15;
    target.headPitch = atLookout ? -0.1 : 0.3;
  }

  function poseZipline(): void {
    // Hanging from the handle: arms overhead, knees tucked, toes trailing.
    target.hipL = 0.55;
    target.hipR = 0.75;
    target.kneeL = -1.05;
    target.kneeR = -1.35;
    target.legSpread = 0.12;
    target.shoulderL = 2.95;
    target.shoulderR = 2.95;
    target.shoulderSpread = 0.18;
    target.elbowL = 0.45;
    target.elbowR = 0.45;
    target.lean = -0.08;
    target.headPitch = -0.12;
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

    applyThrowOverlay(dt);
  }

  /** Whip + follow-through laid straight over the damped pose (no damping). */
  function applyThrowOverlay(dt: number): void {
    if (throwTimer < 0) return;
    throwTimer += dt;
    if (throwTimer >= THROW_TIME) {
      throwTimer = -1;
      return;
    }
    sampleThrow(throwTimer, throwKey);
    const w = throwWeight(throwTimer);

    rig.armR.upper.rotation.x = lerp(pose.shoulderR, throwKey.shoulder, w);
    rig.armR.upper.rotation.z = lerp(pose.shoulderSpread, 0.42, w);
    rig.armR.lower.rotation.x = lerp(pose.elbowR, throwKey.elbow, w);
    // The off arm swings back as a counterweight.
    rig.armL.upper.rotation.x = lerp(pose.shoulderL, -0.5, w * 0.6);
    const lean = lerp(pose.lean, throwKey.lean, w);
    rig.torso.rotation.x = lean;
    rig.head.rotation.x = pose.headPitch - lean;
  }

  function syncRigTransform(): void {
    if (mode === 'swinging' && ridingSwing) {
      // Sit on the seat: shift the body so the hips land on the origin, and
      // let the whole kid ride the rope's lean (yaw first — order 'YXZ' —
      // so the lean pitches along the island's swing arc).
      rig.root.position.copy(position);
      rig.body.position.y = -HIP_Y;
      rig.root.rotation.set(ridingSwing.angle * 0.85, facing, 0);
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
      camDesired.set(
        rest.x - frameF.x * 4.5,
        rest.y + 2.2,
        rest.z - frameF.z * 4.5,
      );
      lookDesired.set(
        rest.x + frameF.x * 4.0,
        rest.y + 0.9,
        rest.z + frameF.z * 4.0,
      );
      // A touch of drift with the swing so the arc reads on screen.
      lookDesired.x += frameF.x * ridingSwing.angle * 1.2;
      lookDesired.z += frameF.z * ridingSwing.angle * 1.2;
    } else if (mode === 'zipline') {
      // Cinematic cut sequence: launch → wide pass by the Ship → landing.
      const p = Math.min(zipP, 1);
      zipShotNow = p < 0.22 ? 0 : p < 0.72 ? 1 : 2;
      if (zipShotNow === 0) {
        // Over the shoulder, looking down the cable.
        camDesired.set(
          position.x - zipDir.x * 5.5,
          position.y + 2.8,
          position.z - zipDir.z * 5.5,
        );
        lookDesired.copy(zipTo);
      } else if (zipShotNow === 1) {
        // Wide side shot from out over the water — the Ship wheels in frame
        // beyond the rider (the camera sits away from the centre).
        zipOut
          .set(position.x - ARCHIPELAGO_CENTER.x, 0, position.z - ARCHIPELAGO_CENTER.z)
          .normalize();
        camDesired.set(
          position.x + zipOut.x * 15,
          position.y + 3.5,
          position.z + zipOut.z * 15,
        );
        lookDesired.set(
          position.x + zipDir.x * 2,
          position.y,
          position.z + zipDir.z * 2,
        );
      } else {
        // Landing: from beyond the post, watching the rider glide in.
        camDesired.set(zipTo.x + zipDir.x * 9, zipTo.y + 2.0, zipTo.z + zipDir.z * 9);
        lookDesired.set(position.x, position.y + 0.8, position.z);
      }
    } else if (mode === 'climbing' && atLookout) {
      // Survey the archipelago from the Lookout.
      camDesired.set(
        position.x - frameF.x * 18,
        position.y + 25,
        position.z - frameF.z * 18,
      );
      const other = nearestOtherSet();
      if (other) {
        lookDesired.set(
          lerp(position.x, other.x, 0.55),
          lerp(position.y, 1, 0.6),
          lerp(position.z, other.z, 0.55),
        );
      } else {
        lookDesired.set(
          position.x + frameF.x * 30,
          1,
          position.z + frameF.z * 30,
        );
      }
    } else if (mode === 'climbing') {
      camDesired.set(
        position.x - frameF.x * 7.5,
        position.y + 2.4,
        position.z - frameF.z * 7.5,
      );
      lookDesired.set(
        position.x + frameF.x * 2,
        position.y + 0.8,
        position.z + frameF.z * 2,
      );
    } else {
      // Ground / airborne follow-cam, leading a little in the run direction
      // (va: along screen-right, vb: toward the Ship).
      const va = clamp(vel.x * frameR.x + vel.z * frameR.z, -RUN_SPEED_X, RUN_SPEED_X) * 0.28;
      const vb = clamp(vel.x * frameF.x + vel.z * frameF.z, -RUN_SPEED_Z, RUN_SPEED_Z) * 0.28;
      camDesired.set(
        position.x + frameR.x * va * 0.5 - frameF.x * 6.8,
        position.y + 3.1,
        position.z + frameR.z * va * 0.5 - frameF.z * 6.8,
      );
      lookDesired.set(
        position.x + frameR.x * va * 1.6 + frameF.x * (vb * 1.6 + 2.2),
        position.y + 1.1,
        position.z + frameR.z * va * 1.6 + frameF.z * (vb * 1.6 + 2.2),
      );
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

  /** From the ground the neighbour islands are misty silhouettes; a Lookout
   *  opens the fog right up to survey the ring, and a zip ride keeps the
   *  destination island visible ahead. It closes again afterwards. */
  function updateFog(dt: number): void {
    const fog = ctx.scene.fog;
    if (!fog || !(fog instanceof THREE.Fog)) return;
    let far = FOG_FAR;
    let near = FOG_NEAR;
    if (mode === 'climbing' && atLookout) {
      const other = nearestOtherSet();
      if (other) {
        const d = Math.hypot(other.x - position.x, other.z - position.z);
        far = Math.max(FOG_FAR, d + 120);
        near = Math.max(FOG_NEAR, d * 0.9);
      }
    } else if (mode === 'zipline') {
      const remaining = (1 - Math.min(zipP, 1)) * zipLen;
      far = Math.max(FOG_FAR, remaining + 60);
    }
    fog.near = damp(fog.near, near, 1.6, dt);
    fog.far = damp(fog.far, far, 1.6, dt);
  }

  function updateCamera(dt: number): void {
    aimCamera();
    updateFog(dt);
    // Cinematic cuts: a new zip shot snaps instead of easing across the sea.
    if (mode === 'zipline' && zipShotNow !== zipShot) {
      zipShot = zipShotNow;
      camPos.copy(camDesired);
      camLook.copy(lookDesired);
    }
    const k = mode === 'zipline' ? 6 : mode === 'climbing' && atLookout ? 2.2 : 4.5;
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

  /** Fade the zip cables: both in view at a Lookout (geometry laid out by
   *  updateClimbing), only the ridden one during a ride, gone otherwise. */
  function updateRopes(dt: number): void {
    for (const rope of ropes) rope.target = 0;
    if (mode === 'climbing' && atLookout) {
      ropes[0].target = 0.85;
      ropes[1].target = 0.85;
    } else if (mode === 'zipline') {
      fillRope(ropes[0], zipFrom, zipTo);
      ropes[0].toSet = zipToSet;
      ropes[0].target = 0.9;
    }
    for (const rope of ropes) {
      rope.opacity = damp(rope.opacity, rope.target, 6, dt);
      rope.mat.opacity = rope.opacity;
      rope.line.visible = rope.opacity > 0.02;
    }
  }

  // --- swingset tracking ---------------------------------------------------

  function updateSetIndex(active: boolean): void {
    // Mid-ride the index already points at the destination (set at launch);
    // the landing emits its own arrival.
    if (mode === 'zipline') return;
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

    updateFrame();

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
      case 'zipline':
        updateZipline(dt);
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
      case 'zipline':
        poseZipline();
        break;
    }
    applyPose(dt);
    syncRigTransform();
    updateSetIndex(active);
    updateRopes(dt);
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
