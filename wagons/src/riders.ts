// Riders and their Horses: spawning, circling AI, the Aim telegraph and
// shot, hitboxes for the player's raycasts, and the Fall (ragdoll hand-off).
// Works with real GLB horse/rider models when present, procedural otherwise.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HORSE_DOWN_TIME, LANE_MAX, LANE_MIN, PALETTE, SPAWN_RADIUS } from './constants';
import { ringPos, scene, yaw, yawAngle, camera } from './gfx';
import { dust, hitPuff, muzzleSmoke } from './particles';
import { spawnRagdoll, type Binder, type Segment, type SegmentPose, segmentQuat } from './ragdoll';
import { blockers } from './ring';
import { angDiff, clamp, lerp, pick, rand, TAU } from './util';

// ------------------------------------------------------------------ pose data
// Rider-local frame: origin at the saddle seat, +Z forward, +Y up.
type JointName = 'hips' | 'neck' | 'headTop' | 'shoulderL' | 'elbowL' | 'wristL' | 'shoulderR' | 'elbowR' | 'wristR'
  | 'hipL' | 'kneeL' | 'ankleL' | 'hipR' | 'kneeR' | 'ankleR' | 'hatTop';
type Joints = Record<JointName, THREE.Vector3>;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function ridingJoints(): Joints {
  return {
    hips: V(0, 0.02, 0), neck: V(0, 0.56, 0.03), headTop: V(0, 0.82, 0.04), hatTop: V(0, 0.95, 0.04),
    shoulderL: V(-0.2, 0.5, 0.03), elbowL: V(-0.23, 0.27, 0.18), wristL: V(-0.1, 0.3, 0.4),
    shoulderR: V(0.2, 0.5, 0.03), elbowR: V(0.23, 0.27, 0.18), wristR: V(0.1, 0.3, 0.4),
    hipL: V(-0.12, 0.0, 0), kneeL: V(-0.2, -0.26, 0.36), ankleL: V(-0.24, -0.68, 0.24),
    hipR: V(0.12, 0.0, 0), kneeR: V(0.2, -0.26, 0.36), ankleR: V(0.24, -0.68, 0.24),
  };
}
interface SegDef { key: string; parent: string | null; a: JointName; b: JointName; r: number; mass: number }
const SEGS: SegDef[] = [
  { key: 'torso', parent: null, a: 'hips', b: 'neck', r: 0.14, mass: 30 },
  { key: 'head', parent: 'torso', a: 'neck', b: 'headTop', r: 0.1, mass: 5 },
  { key: 'upperArmL', parent: 'torso', a: 'shoulderL', b: 'elbowL', r: 0.05, mass: 3 },
  { key: 'foreArmL', parent: 'upperArmL', a: 'elbowL', b: 'wristL', r: 0.045, mass: 2 },
  { key: 'upperArmR', parent: 'torso', a: 'shoulderR', b: 'elbowR', r: 0.05, mass: 3 },
  { key: 'foreArmR', parent: 'upperArmR', a: 'elbowR', b: 'wristR', r: 0.045, mass: 2 },
  { key: 'thighL', parent: 'torso', a: 'hipL', b: 'kneeL', r: 0.08, mass: 9 },
  { key: 'shinL', parent: 'thighL', a: 'kneeL', b: 'ankleL', r: 0.06, mass: 5 },
  { key: 'thighR', parent: 'torso', a: 'hipR', b: 'kneeR', r: 0.08, mass: 9 },
  { key: 'shinR', parent: 'thighR', a: 'kneeR', b: 'ankleR', r: 0.06, mass: 5 },
  { key: 'hat', parent: null, a: 'headTop', b: 'hatTop', r: 0.16, mass: 0.4 },
];
function posesFromJoints(j: Joints, out: Map<string, SegmentPose>) {
  for (const s of SEGS) {
    let p = out.get(s.key);
    if (!p) { p = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), len: 0 }; out.set(s.key, p); }
    p.pos.addVectors(j[s.a], j[s.b]).multiplyScalar(0.5);
    p.len = j[s.a].distanceTo(j[s.b]);
    segmentQuat(j[s.a], j[s.b], p.quat);
  }
}

// ------------------------------------------------------------- rider visuals
const skinMat = new THREE.MeshStandardMaterial({ color: PALETTE.skin, roughness: 0.85 });
const hatMat = new THREE.MeshStandardMaterial({ color: PALETTE.hat, roughness: 0.9 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.9 });
const bootMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.7 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x333438, roughness: 0.4, metalness: 0.8 });
const bandanaMat = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.9 });

function makeHat(): THREE.Group {
  const g = new THREE.Group();
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.015, 18), hatMat); brim.castShadow = true; g.add(brim);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.13, 14), hatMat); crown.position.y = 0.07; crown.castShadow = true; g.add(crown);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.025, 14), bandanaMat); band.position.y = 0.02; g.add(band);
  return g;
}

/** Abstract rider visual: something that can take segment poses. */
interface RiderVisual {
  frame: THREE.Group;              // rider-local frame (child of the saddle while riding)
  binder: Binder;
  hat: THREE.Object3D;
  gun: THREE.Object3D;             // the rider's pistol (for the Aim cue + flash)
  pose(j: Joints): void;           // riding pose in frame space
}

/** Procedural rider: boxes per segment, posed by the same Binder machinery. */
function proceduralRider(shirt: number): RiderVisual {
  const frame = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const parts = new Map<string, THREE.Object3D>();
  const mk = (key: string, w: number, d: number, m: THREE.Material, extra?: (g: THREE.Group) => void) => {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), m); // unit length along Y, scaled per pose
    mesh.castShadow = true; mesh.name = 'seg'; g.add(mesh);
    extra && extra(g);
    parts.set(key, g); frame.add(g);
  };
  mk('torso', 0.36, 0.24, shirtMat, g => {
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.26), bootMat); belt.position.y = -0.24; g.add(belt);
    const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.2), bandanaMat); scarf.position.y = 0.24; g.add(scarf);
  });
  mk('head', 0.2, 0.22, skinMat);
  mk('upperArmL', 0.11, 0.11, shirtMat); mk('foreArmL', 0.09, 0.09, shirtMat);
  mk('upperArmR', 0.11, 0.11, shirtMat); mk('foreArmR', 0.09, 0.09, shirtMat);
  mk('thighL', 0.15, 0.16, pantsMat); mk('shinL', 0.12, 0.13, bootMat);
  mk('thighR', 0.15, 0.16, pantsMat); mk('shinR', 0.12, 0.13, bootMat);
  const hat = makeHat(); parts.set('hat', hat); frame.add(hat);
  // pistol in the right hand
  const gun = new THREE.Group();
  gun.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.22), gunMat));
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.04), hatMat); grip.position.set(0, -0.05, 0.08); gun.add(grip);
  parts.get('foreArmR')!.add(gun); gun.position.set(0, 0.16, 0.05); gun.rotation.x = -Math.PI / 2;
  const mats = [shirtMat];
  const binder: Binder = {
    apply(poses) {
      for (const [k, p] of poses) {
        const g = parts.get(k); if (!g) continue;
        g.position.copy(p.pos); g.quaternion.copy(p.quat);
        if (k === 'hat') { g.position.y -= 0.06; continue; }
        const seg = g.getObjectByName('seg');
        if (seg) { seg.scale.y = p.len + (k === 'head' ? 0.06 : 0.04); }
      }
    },
    fade(o) {
      frame.traverse(obj => {
        const m = obj as THREE.Mesh;
        if (m.isMesh) {
          const mat = m.material as THREE.MeshStandardMaterial;
          if (!mat.transparent) { m.material = mat.clone(); (m.material as THREE.MeshStandardMaterial).transparent = true; }
          (m.material as THREE.MeshStandardMaterial).opacity = o;
        }
      });
    },
    dispose() { frame.removeFromParent(); mats.forEach(m => m.dispose()); },
  };
  const poses = new Map<string, SegmentPose>();
  return { frame, binder, hat, gun, pose(j) { posesFromJoints(j, poses); binder.apply(poses); } };
}

/** Skinned rider from a GLB: bones are driven by segment poses. */
interface BoneBind { bone: THREE.Bone; offset: THREE.Quaternion; scale: THREE.Vector3 }
function skinnedRider(src: GLTF): RiderVisual | null {
  const frame = new THREE.Group();
  const model = skeletonClone(src.scene);
  model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
  const bb = new THREE.Box3().setFromObject(model);
  const h = bb.getSize(new THREE.Vector3()).y || 1.8;
  const wrap = new THREE.Group(); wrap.add(model); wrap.scale.setScalar(1.8 / h);
  frame.add(wrap);
  frame.updateMatrixWorld(true);
  // find bones
  const bones: THREE.Bone[] = [];
  model.traverse(o => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
  const norm = (n: string) => n.toLowerCase().replace(/mixamorig[:_]?/g, '').replace(/[^a-z]/g, '');
  const side = (n: string): 'L' | 'R' | '' => {
    const raw = n.toLowerCase();
    if (/(^|[^a-z])l([^a-z]|$)|left|\.l$|_l$|^l_/.test(raw)) return 'L';
    if (/(^|[^a-z])r([^a-z]|$)|right|\.r$|_r$|^r_/.test(raw)) return 'R';
    return '';
  };
  const find = (pred: (n: string, s: string, raw: string) => boolean) => bones.find(b => pred(norm(b.name), side(b.name), b.name));
  const map: Record<string, THREE.Bone | undefined> = {
    torso: find(n => /hips|pelvis/.test(n)),
    head: find(n => /^head$|head$/.test(n) && !/top|end/.test(n)),
    upperArmL: find((n, s) => s === 'L' && /upperarm|^leftarm$|arm$/.test(n) && !/fore|lower|hand/.test(n)),
    foreArmL: find((n, s) => s === 'L' && /forearm|lowerarm|elbow/.test(n)),
    upperArmR: find((n, s) => s === 'R' && /upperarm|^rightarm$|arm$/.test(n) && !/fore|lower|hand/.test(n)),
    foreArmR: find((n, s) => s === 'R' && /forearm|lowerarm|elbow/.test(n)),
    thighL: find((n, s) => s === 'L' && /upleg|thigh|upperleg/.test(n)),
    shinL: find((n, s) => s === 'L' && /(^|[^p])leg$|shin|calf|lowerleg|knee/.test(n) && !/upleg|upperleg|thigh/.test(n)),
    thighR: find((n, s) => s === 'R' && /upleg|thigh|upperleg/.test(n)),
    shinR: find((n, s) => s === 'R' && /(^|[^p])leg$|shin|calf|lowerleg|knee/.test(n) && !/upleg|upperleg|thigh/.test(n)),
  };
  const essential = ['torso', 'head', 'upperArmL', 'upperArmR', 'thighL', 'thighR'];
  if (essential.some(k => !map[k])) {
    console.warn('rider model: bones not recognised, falling back to procedural rider', bones.map(b => b.name));
    return null;
  }
  // bind data: for each mapped bone, its frame-space quaternion and direction to its child
  const binds = new Map<string, BoneBind>();
  const childDir = (b: THREE.Bone, key: string): THREE.Vector3 => {
    // direction from this bone to its relevant child (next bone in the chain)
    const next: Record<string, string | undefined> = { torso: 'head', upperArmL: 'foreArmL', upperArmR: 'foreArmR', thighL: 'shinL', thighR: 'shinR' };
    const nk = next[key]; const nb = nk ? map[nk] : undefined;
    const from = b.getWorldPosition(new THREE.Vector3());
    let to: THREE.Vector3 | null = null;
    if (nb) to = nb.getWorldPosition(new THREE.Vector3());
    else { const c = b.children.find(x => (x as THREE.Bone).isBone); if (c) to = c.getWorldPosition(new THREE.Vector3()); }
    if (!to) to = from.clone().add(new THREE.Vector3(0, 1, 0));
    return to.sub(from).normalize();
  };
  const hatTarget = map.head!;
  for (const [k, b] of Object.entries(map)) {
    if (!b) continue;
    const dir = childDir(b, k);
    const bindQ = b.getWorldQuaternion(new THREE.Quaternion());
    const segQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    // offset such that segQ * offset == bindQ  (so a segment along `dir` reproduces the bind pose)
    const offset = segQ.clone().invert().multiply(bindQ);
    const sc = b.getWorldScale(new THREE.Vector3());
    binds.set(k, { bone: b, offset, scale: sc });
  }
  // hat on the head, pistol in the right hand (or forearm)
  const hat = makeHat();
  const handR = find((n, s) => s === 'R' && /hand$/.test(n)) ?? map.foreArmR!;
  const gun = new THREE.Group();
  gun.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.22), gunMat));
  frame.add(hat); frame.add(gun);
  const mInv = new THREE.Matrix4(), mWorld = new THREE.Matrix4(), pInv = new THREE.Matrix4(), local = new THREE.Matrix4();
  const tPos = new THREE.Vector3(), tQ = new THREE.Quaternion();
  // process bones top-down so parents are current before children
  const order = ['torso', 'head', 'upperArmL', 'foreArmL', 'upperArmR', 'foreArmR', 'thighL', 'shinL', 'thighR', 'shinR'];
  const binder: Binder = {
    apply(poses) {
      frame.updateWorldMatrix(true, true);
      for (const k of order) {
        const bd = binds.get(k); const p = poses.get(k); if (!bd || !p) continue;
        // bone origin = segment start = mid - quat*(0,len/2,0)
        tPos.set(0, -p.len / 2, 0).applyQuaternion(p.quat).add(p.pos);
        tQ.copy(p.quat).multiply(bd.offset);
        mWorld.compose(tPos, tQ, bd.scale);              // desired, in frame space
        mWorld.premultiply(frame.matrixWorld);            // -> world
        const parent = bd.bone.parent!;
        parent.updateWorldMatrix(true, false);
        pInv.copy(parent.matrixWorld).invert();
        local.multiplyMatrices(pInv, mWorld);
        local.decompose(bd.bone.position, bd.bone.quaternion, bd.bone.scale);
        bd.bone.updateMatrixWorld(false);
      }
      // hat follows the head segment; gun follows the right forearm
      const hp = poses.get('hat'); if (hp) { hat.position.copy(hp.pos); hat.quaternion.copy(hp.quat); hat.position.y -= 0.06; }
      const fp = poses.get('foreArmR');
      if (fp && gun.parent === frame) { gun.position.set(0, fp.len / 2, 0.08).applyQuaternion(fp.quat).add(fp.pos); gun.quaternion.copy(fp.quat); gun.rotateX(-Math.PI / 2); }
      void mInv; void hatTarget; void handR;
    },
    fade(o) {
      frame.traverse(obj => {
        const m = obj as THREE.Mesh;
        if (m.isMesh) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          m.material = mats.map(mat => { const c = (mat as THREE.Material).clone(); c.transparent = true; c.opacity = o; return c; }) as any;
          if (!Array.isArray(m.material) || m.material.length === 1) m.material = (m.material as any)[0];
        }
      });
    },
    dispose() { frame.removeFromParent(); },
  };
  const poses = new Map<string, SegmentPose>();
  return { frame, binder, hat, gun, pose(j) { posesFromJoints(j, poses); binder.apply(poses); } };
}

// ------------------------------------------------------------- horse visuals
interface HorseVisual {
  group: THREE.Group;          // +Z forward, origin under the hooves
  seat: THREE.Object3D;        // where the rider frame attaches
  update(dt: number, speed: number, phase: number): void;
  fade(o: number): void;
  dispose(): void;
  hooves(): THREE.Vector3[];   // world hoof positions (dust)
}
function proceduralHorse(): HorseVisual {
  const group = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: pick(PALETTE.horse), roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.8 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a2c14, roughness: 0.7 });
  const blanket = new THREE.MeshStandardMaterial({ color: pick([0x7a1f1f, 0x24406a, 0x3b5a2b]), roughness: 0.95 });
  const mk = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
  };
  const body = new THREE.Group(); group.add(body);
  body.add(mk(new THREE.CapsuleGeometry(0.32, 0.95, 6, 12).rotateX(Math.PI / 2), coat, 0, 1.2, 0));
  body.add(mk(new THREE.SphereGeometry(0.34, 12, 10), coat, 0, 1.22, -0.55)); // hindquarters
  body.add(mk(new THREE.SphereGeometry(0.3, 12, 10), coat, 0, 1.3, 0.55));   // chest/withers
  const neck = mk(new THREE.CapsuleGeometry(0.16, 0.55, 6, 10), coat, 0, 1.62, 0.85); neck.rotation.x = -0.85; body.add(neck);
  const head = new THREE.Group(); head.position.set(0, 2.0, 1.15); body.add(head);
  head.add(mk(new THREE.BoxGeometry(0.22, 0.26, 0.5), coat, 0, -0.05, 0.18));
  head.add(mk(new THREE.BoxGeometry(0.18, 0.16, 0.18), dark, 0, -0.1, 0.45));
  for (const x of [-0.08, 0.08]) { const ear = mk(new THREE.ConeGeometry(0.04, 0.14, 6), coat, x, 0.14, 0.05); head.add(ear); }
  // mane
  for (let i = 0; i < 5; i++) body.add(mk(new THREE.BoxGeometry(0.06, 0.22, 0.14), dark, 0, 1.82 + i * 0.06, 0.7 + i * 0.1 - 0.02));
  // tail
  const tail = mk(new THREE.CapsuleGeometry(0.06, 0.6, 4, 8), dark, 0, 1.1, -0.95); tail.rotation.x = 0.5; body.add(tail);
  // saddle + blanket
  body.add(mk(new THREE.BoxGeometry(0.66, 0.05, 0.8), blanket, 0, 1.5, -0.02));
  body.add(mk(new THREE.BoxGeometry(0.5, 0.12, 0.55), leather, 0, 1.56, -0.03));
  body.add(mk(new THREE.BoxGeometry(0.14, 0.14, 0.1), leather, 0, 1.66, 0.22));  // horn
  const seat = new THREE.Object3D(); seat.position.set(0, 1.62, -0.02); body.add(seat);
  // stirrups + reins hint
  for (const x of [-0.35, 0.35]) body.add(mk(new THREE.BoxGeometry(0.03, 0.45, 0.03), leather, x, 1.25, 0.0));
  // legs: pivot groups at shoulder/hip
  const legs: { pivot: THREE.Group; knee: THREE.Group; off: number; front: boolean; hoof: THREE.Object3D }[] = [];
  const legDef = [[-0.2, 0.5, true], [0.2, 0.5, true], [-0.2, -0.5, false], [0.2, -0.5, false]] as const;
  legDef.forEach(([x, z, front], i) => {
    const pivot = new THREE.Group(); pivot.position.set(x, 1.05, z); body.add(pivot);
    pivot.add(mk(new THREE.CapsuleGeometry(0.085, 0.4, 4, 8), coat, 0, -0.25, 0));
    const knee = new THREE.Group(); knee.position.set(0, -0.5, 0); pivot.add(knee);
    knee.add(mk(new THREE.CapsuleGeometry(0.055, 0.42, 4, 8), coat, 0, -0.25, 0));
    const hoof = mk(new THREE.CylinderGeometry(0.07, 0.08, 0.08, 10), dark, 0, -0.52, 0.01); knee.add(hoof);
    legs.push({ pivot, knee, off: front ? (i % 2) * 0.5 + 0.0 : (i % 2) * 0.5 + 1.3, front, hoof });
  });
  const mats = [coat, dark, leather, blanket];
  return {
    group, seat,
    update(_dt, _speed, phase) {
      // gallop: body bob + legs swing in a bounding rhythm
      const bob = Math.max(0, Math.sin(phase)) ** 2;
      body.position.y = bob * 0.14; body.rotation.x = Math.sin(phase + 0.6) * 0.07;
      for (const l of legs) {
        const p = phase + l.off;
        l.pivot.rotation.x = (l.front ? 0.9 : 0.8) * Math.sin(p);
        l.knee.rotation.x = -Math.max(0, Math.sin(p - 1.2)) * 1.4 * (l.front ? 1 : 0.7);
      }
      head.rotation.x = Math.sin(phase) * 0.12; tail.rotation.x = 0.5 + Math.sin(phase - 0.5) * 0.25;
    },
    fade(o) { mats.forEach(m => { m.transparent = true; m.opacity = o; }); },
    dispose() { group.removeFromParent(); mats.forEach(m => m.dispose()); },
    hooves() { return legs.map(l => l.hoof.getWorldPosition(new THREE.Vector3())); },
  };
}
function skinnedHorse(src: GLTF): HorseVisual {
  const group = new THREE.Group();
  const model = skeletonClone(src.scene);
  model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
  const bb = new THREE.Box3().setFromObject(model);
  const size = bb.getSize(new THREE.Vector3());
  const wrap = new THREE.Group(); wrap.add(model);
  const s = 1.95 / Math.max(size.y, 0.01);     // ~1.95 m to the top of the head
  wrap.scale.setScalar(s);
  const bb2 = new THREE.Box3().setFromObject(wrap);
  const c = bb2.getCenter(new THREE.Vector3());
  wrap.position.set(-c.x, -bb2.min.y, -c.z);
  group.add(wrap);
  // seat: on the back, slightly behind centre. Attach to a spine/back bone if we can find one.
  const seat = new THREE.Object3D();
  let spine: THREE.Object3D | undefined;
  model.traverse(o => { if (!spine && (o as THREE.Bone).isBone && /spine|back|saddle|chest|body/i.test(o.name) && !/head|neck|tail|leg/i.test(o.name)) spine = o; });
  group.updateMatrixWorld(true);
  const seatWorld = new THREE.Vector3(0, bb2.getSize(new THREE.Vector3()).y * 0.79, -0.1);
  if (spine) { spine.add(seat); seat.position.copy(spine.worldToLocal(seatWorld.clone())); seat.quaternion.copy(spine.getWorldQuaternion(new THREE.Quaternion()).invert()); }
  else { seat.position.copy(seatWorld); group.add(seat); }
  // animation
  const mixer = new THREE.AnimationMixer(model);
  const clips = src.animations;
  const clip = clips.find(cl => /gallop/i.test(cl.name)) ?? clips.find(cl => /run|canter/i.test(cl.name)) ?? clips[0];
  let action: THREE.AnimationAction | null = null;
  if (clip) { action = mixer.clipAction(clip); action.play(); action.time = Math.random() * clip.duration; }
  const matsSet = new Set<THREE.Material>();
  model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => matsSet.add(x)); });
  return {
    group, seat,
    update(dt, speed) { if (action) action.timeScale = clamp(speed / 11, 0.6, 1.6); mixer.update(dt); },
    fade(o) { matsSet.forEach(m => { m.transparent = true; m.opacity = o; }); },
    dispose() { group.removeFromParent(); },
    hooves() { const p = group.getWorldPosition(new THREE.Vector3()); return [p]; },
  };
}

// ----------------------------------------------------------------- riders
export type RiderState = 'arriving' | 'riding' | 'aiming' | 'fallen' | 'gone';
export interface RiderOpts { speed: number; reverse: boolean; hanger: boolean; aimTime: number; aimGap: number; behindChance: number }
export class Rider {
  state: RiderState = 'arriving';
  angle = rand(0, TAU);
  radius = SPAWN_RADIUS;
  laneRadius = rand(LANE_MIN, LANE_MAX);
  dir: 1 | -1;
  speed: number;
  phase = rand(0, TAU);
  aimTimer = 0; aimCooldown: number;
  hanger: boolean;
  horse: HorseVisual;
  rider: RiderVisual | null;
  joints = ridingJoints();
  hitRider: THREE.Mesh; hitHorse: THREE.Mesh; hitHead: THREE.Mesh;
  riderless = false;
  downT = 0;      // >0 while the Horse is down (shot), counting down
  downF = 0;      // 0..1 how far down the Horse is right now
  downDust = false;
  opts: RiderOpts;
  dustTimer = 0;
  fadeT = 0;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();

  constructor(opts: RiderOpts, horseSrc: GLTF | null, riderSrc: GLTF | null) {
    this.opts = opts;
    this.dir = opts.reverse ? -1 : 1;
    this.speed = opts.speed * rand(0.9, 1.12);
    this.hanger = opts.hanger;
    this.aimCooldown = rand(1.5, opts.aimGap);
    this.horse = horseSrc ? skinnedHorse(horseSrc) : proceduralHorse();
    let rv: RiderVisual | null = null;
    if (riderSrc) rv = skinnedRider(riderSrc);
    if (!rv) rv = proceduralRider(pick(PALETTE.shirt));
    this.rider = rv;
    this.horse.seat.add(rv.frame);
    rv.pose(this.joints);
    // hitboxes
    const invis = new THREE.MeshBasicMaterial({ visible: false });
    // generous on purpose: the targets are small, fast and far, and a near miss feels like a hit
    this.hitRider = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.15, 0.8), invis); this.hitRider.position.set(0, 0.28, 0.08);
    this.hitHead = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), invis); this.hitHead.position.set(0, 0.74, 0.05);
    this.hitRider.userData = { kind: 'rider', rider: this }; this.hitHead.userData = { kind: 'rider', rider: this, head: true };
    rv.frame.add(this.hitRider, this.hitHead);
    this.hitHorse = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.4, 2.5), invis); this.hitHorse.position.set(0, 1.0, 0.05);
    this.hitHorse.userData = { kind: 'horse', rider: this };
    this.horse.group.add(this.hitHorse);
    if (this.hanger) rv.frame.rotation.z = this.dir * 1.15;
    scene.add(this.horse.group);
    this.place();
  }

  /** world transform from angle/radius */
  place() {
    ringPos(this.angle, this.radius, this.pos);
    const dx = -Math.sin(this.angle) * this.dir, dz = -Math.cos(this.angle) * this.dir;
    this.vel.set(dx, 0, dz).multiplyScalar(this.speed);
    this.horse.group.position.copy(this.pos);
    this.horse.group.rotation.x = 0;
    this.horse.group.rotation.y = Math.atan2(dx, dz);
    // lean into the turn
    this.horse.group.rotation.z = -this.dir * 0.08 * (this.speed / 11) * (18 / Math.max(this.radius, 8));
  }

  get visibleToPlayer() {
    const a = angDiff(yawAngle(yaw.value), this.angle);
    return Math.abs(a) < camera.fov * Math.PI / 360 * camera.aspect * 0.9 + 0.15;
  }
}

export const riders: Rider[] = [];
let horseSrc: GLTF | null = null, riderSrc: GLTF | null = null;
export function initRiders(horse: GLTF | null, rider: GLTF | null) { horseSrc = horse; riderSrc = rider; }

export function spawnRider(opts: RiderOpts): Rider {
  const r = new Rider(opts, horseSrc, riderSrc);
  // don't spawn right on top of another rider
  for (let tries = 0; tries < 6; tries++) {
    if (riders.every(o => o.state === 'gone' || Math.abs(angDiff(o.angle, r.angle)) > 0.35)) break;
    r.angle = rand(0, TAU);
  }
  r.place();
  riders.push(r);
  return r;
}

export interface RiderEvents {
  onAimStart(r: Rider): void;
  onShot(r: Rider, from: THREE.Vector3): void;
}

const tmpV = new THREE.Vector3();
export function updateRiders(dt: number, ev: RiderEvents) {
  for (let i = riders.length - 1; i >= 0; i--) {
    const r = riders[i];
    if (r.state === 'gone') { riders.splice(i, 1); continue; }
    if (r.state === 'fallen') {
      if (r.downT > 0) {
        // a shot Horse: skids down, lies a moment, gets back up
        r.downT -= dt;
        const e = HORSE_DOWN_TIME - r.downT;
        const f = e < 0.35 ? e / 0.35 : e < 1.5 ? 1 : clamp(1 - (e - 1.5) / (HORSE_DOWN_TIME - 1.5), 0, 1);
        r.downF = f * f * (3 - 2 * f);
        r.speed = e < 1.5 ? lerp(r.speed, 0, 1 - Math.exp(-dt * 7)) : lerp(r.speed, 7, 1 - Math.exp(-dt * 2));
        if (e < 0.5) r.radius += dt * 3; // slides outward as it goes down
        if (!r.downDust && e >= 0.25) { r.downDust = true; dust(r.pos, 22, 2.6); }
      } else {
        // riderless horse: spiral out and away, then fade
        r.downF = 0;
        r.radius += dt * 6;
        r.speed = lerp(r.speed, 13, dt);
        if (r.radius > 70) { r.fadeT += dt; r.horse.fade(1 - r.fadeT); if (r.fadeT >= 1) { r.horse.dispose(); r.state = 'gone'; continue; } }
      }
    } else if (r.state === 'arriving') {
      r.radius = lerp(r.radius, r.laneRadius, 1 - Math.exp(-dt * 0.7));
      if (Math.abs(r.radius - r.laneRadius) < 1.5) { r.state = 'riding'; }
    } else {
      // gentle weave within the lane
      r.laneRadius += Math.sin(performance.now() / 1000 * 0.3 + r.phase) * dt * 0.8;
      r.laneRadius = clamp(r.laneRadius, LANE_MIN, LANE_MAX);
      r.radius = lerp(r.radius, r.laneRadius, 1 - Math.exp(-dt * 1.5));
    }
    // circle
    const w = r.dir * r.speed / Math.max(r.radius, 1);
    r.angle = (r.angle + w * dt + TAU) % TAU;
    r.phase += dt * (r.speed / 11) * 9.5;
    r.place();
    if (r.downF > 0) {
      // down on its side: nose dips, rolls toward the outside of the Ring, drops to the dirt
      r.horse.group.rotation.x = r.downF * 0.5;
      r.horse.group.rotation.z += r.dir * r.downF * 1.0;
      r.horse.group.position.y = -r.downF * 0.7;
    }
    r.horse.update(dt, r.speed, r.phase);
    // hoof dust
    r.dustTimer -= dt;
    if (r.dustTimer <= 0 && r.radius < 50 && r.speed > 2) {
      r.dustTimer = 0.14;
      const hs = r.horse.hooves();
      const hp = hs[(Math.random() * hs.length) | 0];
      tmpV.copy(hp); tmpV.y = 0.05; dust(tmpV, 2, 1.2);
    }
    // Aim / shoot
    if (r.state === 'riding') {
      r.aimCooldown -= dt;
      if (r.aimCooldown <= 0) {
        if (r.visibleToPlayer || Math.random() < r.opts.behindChance) {
          r.state = 'aiming'; r.aimTimer = r.opts.aimTime;
          aimPose(r, true);
          ev.onAimStart(r);
        } else r.aimCooldown = 0.8;
      }
    } else if (r.state === 'aiming') {
      r.aimTimer -= dt;
      aimPose(r, true);
      if (r.aimTimer <= 0) {
        // fire at the player
        const gp = r.rider!.gun.getWorldPosition(new THREE.Vector3());
        const toP = new THREE.Vector3(0, 1.6, 0).sub(gp).normalize();
        muzzleSmoke(gp, toP, 8);
        ev.onShot(r, gp);
        r.state = 'riding';
        r.aimCooldown = r.opts.aimGap * rand(0.8, 1.3);
        aimPose(r, false);
      }
    }
  }
}

/** Raise (or lower) the rider's gun arm toward the player. */
function aimPose(r: Rider, aiming: boolean) {
  const rv = r.rider!; const j = r.joints;
  if (!aiming) {
    const base = ridingJoints();
    j.shoulderR.copy(base.shoulderR); j.elbowR.copy(base.elbowR); j.wristR.copy(base.wristR); j.neck.copy(base.neck); j.headTop.copy(base.headTop); j.hatTop.copy(base.hatTop);
    rv.pose(j); return;
  }
  // direction to the player's head in rider-frame space
  rv.frame.updateWorldMatrix(true, false);
  const local = rv.frame.worldToLocal(new THREE.Vector3(0, 1.6, 0)).normalize();
  const base = ridingJoints();
  j.shoulderR.copy(base.shoulderR);
  j.elbowR.copy(base.shoulderR).addScaledVector(local, 0.26).add(new THREE.Vector3(0.03, 0.02, 0));
  j.wristR.copy(j.elbowR).addScaledVector(local, 0.25);
  // twist the upper body slightly toward the target
  j.neck.copy(base.neck).addScaledVector(local, 0.05); j.headTop.copy(base.headTop).addScaledVector(local, 0.08); j.hatTop.copy(base.hatTop).addScaledVector(local, 0.08);
  rv.pose(j);
}

/** The Fall: rider comes off as a ragdoll; horse keeps going riderless.
 *  `viaHorse`: the shot hit the Horse — it goes down and spills the Rider forward. */
export function fellRider(r: Rider, hitPoint: THREE.Vector3, shotDir: THREE.Vector3, head: boolean, viaHorse = false) {
  if (r.state === 'fallen' || r.state === 'gone' || !r.rider) return;
  const rv = r.rider;
  rv.frame.updateWorldMatrix(true, true);
  const m = rv.frame.matrixWorld.clone();
  const segs: Segment[] = SEGS.map(s => ({
    key: s.key, parentKey: s.parent,
    start: r.joints[s.a].clone().applyMatrix4(m), end: r.joints[s.b].clone().applyMatrix4(m),
    radius: s.r, mass: s.mass,
  }));
  // hand the frame to the scene at identity; poses are world-space from now on
  rv.frame.removeFromParent();
  rv.frame.position.set(0, 0, 0); rv.frame.quaternion.identity(); rv.frame.scale.set(1, 1, 1);
  scene.add(rv.frame);
  rv.frame.updateMatrixWorld(true);
  this_hitboxesOff(r);
  // which segment was hit? nearest start/end midpoint
  let hitKey = head ? 'head' : 'torso'; let best = Infinity;
  for (const s of segs) { const d = s.start.clone().add(s.end).multiplyScalar(0.5).distanceTo(hitPoint); if (d < best) { best = d; hitKey = s.key; } }
  let vel: THREE.Vector3, impulse: THREE.Vector3;
  if (viaHorse) {
    // pitched over the horse's head: carries his momentum, small kick from the shot
    vel = r.vel.clone().multiplyScalar(1.1).add(new THREE.Vector3(0, 2.2, 0));
    impulse = shotDir.clone().multiplyScalar(25).add(new THREE.Vector3(0, 30, 0));
    hitKey = 'torso';
    r.downT = HORSE_DOWN_TIME; r.downDust = false;
  } else {
    vel = r.vel.clone().multiplyScalar(0.75).add(new THREE.Vector3(0, 1.2, 0));
    impulse = shotDir.clone().multiplyScalar(head ? 70 : 120).add(new THREE.Vector3(0, 40, 0));
  }
  spawnRagdoll(segs, rv.binder, vel, impulse, hitKey, viaHorse ? 3 : 5);
  hitPuff(hitPoint);
  r.state = 'fallen';
  r.riderless = true;
  r.rider = null;
}
function this_hitboxesOff(r: Rider) {
  r.hitRider.removeFromParent(); r.hitHead.removeFromParent(); r.hitHorse.userData.kind = 'horse';
}

export interface HitResult { kind: 'rider' | 'horse' | 'coach' | 'none'; rider?: Rider; point?: THREE.Vector3; head?: boolean }
const raycaster = new THREE.Raycaster();
export function shootRay(origin: THREE.Vector3, dir: THREE.Vector3): HitResult {
  raycaster.set(origin, dir); raycaster.far = 200;
  const targets: THREE.Object3D[] = blockers.map(b => b.mesh);
  for (const r of riders) {
    if (r.state === 'gone') continue;
    targets.push(r.hitHorse);
    if (r.rider && r.state !== 'fallen') targets.push(r.hitRider, r.hitHead);
  }
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) return { kind: 'none' };
  const h = hits[0];
  const ud = h.object.userData;
  if (ud.kind === 'rider') return { kind: 'rider', rider: ud.rider, point: h.point, head: !!ud.head };
  if (ud.kind === 'horse') return { kind: 'horse', rider: ud.rider, point: h.point };
  return { kind: 'coach', point: h.point };
}

/** Aim assist: the nearest live Rider within `maxAngle` of the shot and not
 *  hidden behind a Stagecoach — a near miss still counts. */
const toRider = new THREE.Vector3(), riderCtr = new THREE.Vector3();
export function assistTarget(origin: THREE.Vector3, dir: THREE.Vector3, maxAngle: number): HitResult {
  let best: Rider | null = null, bestAng = maxAngle, bestPt: THREE.Vector3 | null = null;
  const coaches = blockers.map(b => b.mesh);
  for (const r of riders) {
    if (!r.rider || r.state === 'fallen' || r.state === 'gone') continue;
    r.hitRider.getWorldPosition(riderCtr);
    toRider.subVectors(riderCtr, origin);
    const d = toRider.length(); toRider.divideScalar(d);
    const ang = Math.acos(clamp(toRider.dot(dir), -1, 1));
    if (ang >= bestAng) continue;
    raycaster.set(origin, toRider); raycaster.far = d;
    if (raycaster.intersectObjects(coaches, false).length) continue;
    best = r; bestAng = ang; bestPt = riderCtr.clone();
  }
  return best ? { kind: 'rider', rider: best, point: bestPt!, head: false } : { kind: 'none' };
}

export function clearRiders() {
  for (const r of riders) { r.horse.dispose(); r.rider?.binder.dispose(); }
  riders.length = 0;
}
export const activeRiderCount = () => riders.filter(r => r.state !== 'fallen' && r.state !== 'gone').length;
