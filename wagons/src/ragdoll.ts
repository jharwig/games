// Rapier physics: static ground + coach colliders, and ragdolls for Falls.
// A ragdoll is built from abstract Segments (joint -> joint capsules) so the
// same code drives both the procedural part-rig rider and a skinned rider's
// bones. The caller supplies a Binder that applies per-segment transforms.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BODY_FADE_TIME } from './constants';
import { blockers } from './ring';

export interface Segment {
  key: string;
  parentKey: string | null;
  start: THREE.Vector3;   // world position of the joint at the parent end
  end: THREE.Vector3;     // world position of the far end
  radius: number;
  mass: number;
}
export interface SegmentPose { pos: THREE.Vector3; quat: THREE.Quaternion; len: number }
export interface Binder {
  /** apply segment poses (world space). Called once per physics step. */
  apply(poses: Map<string, SegmentPose>): void;
  /** 0..1 opacity during fade-out */
  fade(opacity: number): void;
  /** final cleanup */
  dispose(): void;
}

let world: RAPIER.World;
let ready = false;
const GROUP_STATIC = (0x0001 << 16) | 0x0003;
const GROUP_RAGDOLL = (0x0002 << 16) | 0x0001;

export async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  // ground
  const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(300, 0.5, 300).setFriction(0.9).setCollisionGroups(GROUP_STATIC), g);
  // coaches
  for (const b of blockers) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, b.rotY, 0));
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(b.center.x, b.center.y, b.center.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    world.createCollider(RAPIER.ColliderDesc.cuboid(b.size.x / 2, b.size.y / 2, b.size.z / 2).setFriction(0.6).setCollisionGroups(GROUP_STATIC), body);
  }
  ready = true;
}
export const physicsReady = () => ready;

interface Doll {
  bodies: Map<string, { body: RAPIER.RigidBody; len: number }>;
  binder: Binder;
  age: number;
  poses: Map<string, SegmentPose>;
  dead: boolean;
}
const dolls: Doll[] = [];
export const activeRagdolls = () => dolls.length;

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpMid = new THREE.Vector3();

/**
 * Spawn a ragdoll from segments. `vel` is the initial linear velocity of
 * every part (the horse's speed); `impulse` an extra kick applied at the
 * segment named `hitKey` (the shot).
 */
export function spawnRagdoll(segments: Segment[], binder: Binder, vel: THREE.Vector3, impulse: THREE.Vector3, hitKey: string | null, spin = 0): Doll | null {
  if (!ready) return null;
  const bodies = new Map<string, { body: RAPIER.RigidBody; len: number }>();
  const poses = new Map<string, SegmentPose>();
  for (const s of segments) {
    tmpDir.subVectors(s.end, s.start);
    const len = Math.max(tmpDir.length(), 0.05);
    tmpDir.normalize();
    tmpQ.setFromUnitVectors(UP, tmpDir);
    tmpMid.addVectors(s.start, s.end).multiplyScalar(0.5);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(tmpMid.x, tmpMid.y, tmpMid.z)
      .setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w })
      .setLinvel(vel.x, vel.y, vel.z)
      .setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin })
      .setLinearDamping(0.25).setAngularDamping(2.5).setCcdEnabled(true);
    const body = world.createRigidBody(desc);
    const halfH = Math.max(0.01, len / 2 - s.radius);
    world.createCollider(
      RAPIER.ColliderDesc.capsule(halfH, s.radius).setMass(s.mass).setFriction(0.8).setRestitution(0.05).setCollisionGroups(GROUP_RAGDOLL),
      body,
    );
    bodies.set(s.key, { body, len });
    poses.set(s.key, { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), len });
  }
  // joints: child's start anchored to parent's body
  for (const s of segments) {
    if (!s.parentKey) continue;
    const parent = bodies.get(s.parentKey); const child = bodies.get(s.key);
    if (!parent || !child) continue;
    const a1 = worldToLocal(parent.body, s.start);
    const a2 = worldToLocal(child.body, s.start);
    const jd = RAPIER.JointData.spherical(a1, a2);
    const j = world.createImpulseJoint(jd, parent.body, child.body, true) as any;
    if (j && typeof j.setContactsEnabled === 'function') j.setContactsEnabled(false);
  }
  if (hitKey) {
    const hb = bodies.get(hitKey) ?? bodies.values().next().value;
    hb?.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
  }
  const doll: Doll = { bodies, binder, age: 0, poses, dead: false };
  dolls.push(doll);
  syncDoll(doll);
  return doll;
}

function worldToLocal(body: RAPIER.RigidBody, p: THREE.Vector3) {
  const t = body.translation(); const r = body.rotation();
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
  const v = new THREE.Vector3(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(q);
  return { x: v.x, y: v.y, z: v.z };
}

function syncDoll(d: Doll) {
  for (const [k, b] of d.bodies) {
    const t = b.body.translation(); const r = b.body.rotation();
    const p = d.poses.get(k)!;
    p.pos.set(t.x, t.y, t.z); p.quat.set(r.x, r.y, r.z, r.w);
  }
  d.binder.apply(d.poses);
}

let acc = 0;
export function stepPhysics(dt: number) {
  if (!ready) return;
  acc += dt;
  let steps = 0;
  while (acc >= 1 / 60 && steps < 4) { world.step(); acc -= 1 / 60; steps++; }
  if (steps === 0) return;
  for (let i = dolls.length - 1; i >= 0; i--) {
    const d = dolls[i];
    d.age += steps / 60;
    syncDoll(d);
    if (d.age > BODY_FADE_TIME) {
      const o = 1 - (d.age - BODY_FADE_TIME) / 1.5;
      d.binder.fade(Math.max(0, o));
      if (o <= 0) {
        for (const b of d.bodies.values()) world.removeRigidBody(b.body);
        d.binder.dispose();
        d.dead = true;
        dolls.splice(i, 1);
      }
    }
  }
}

/** A one-off convenience: the segment quaternion for a start->end direction. */
export function segmentQuat(start: THREE.Vector3, end: THREE.Vector3, out = new THREE.Quaternion()) {
  tmpDir.subVectors(end, start).normalize();
  return out.setFromUnitVectors(UP, tmpDir);
}
