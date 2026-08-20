// First-person guns: the Rifle (lever-action) and the Six-shooter. Real GLB
// viewmodels when present, procedural ones otherwise. Handles timing
// (cycle / reload / swap), recoil + sway animation, muzzle smoke.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { camera, forward, scene } from './gfx';
import { muzzleSmoke } from './particles';
import { REVOLVER_FIRE_TIME, REVOLVER_RELOAD_TIME, REVOLVER_ROUNDS, REVOLVER_SPREAD, RIFLE_LEVER_TIME, RIFLE_SPREAD, SWAP_TIME, PALETTE } from './constants';
import { clamp, lerp, rand } from './util';

export type GunKind = 'rifle' | 'revolver';
export type GunState = 'ready' | 'cycling' | 'reloading' | 'swapping';

interface ViewModel {
  root: THREE.Group;        // positioned relative to the camera
  model: THREE.Object3D;    // the gun itself (animated parts inside)
  muzzle: THREE.Object3D;
  lever?: THREE.Object3D;   // rifle
  cylinder?: THREE.Object3D; // revolver
  hammer?: THREE.Object3D;
  restPos: THREE.Vector3;
  restRot: THREE.Euler;
}

export const gun = {
  kind: 'rifle' as GunKind,
  state: 'ready' as GunState,
  timer: 0,
  rounds: 1,          // rifle: 1 (chambered) ; revolver: 0..6
  pendingSwap: null as GunKind | null,
  swapPhase: 0,       // 0..1 lowering then raising
};

const rig = new THREE.Group();   // holds both viewmodels, child of camera
camera.add(rig);
// muzzle flash: a point light that lives at the muzzle for a few frames
const flash = new THREE.PointLight(0xffb870, 0, 14, 2);
flash.visible = false;
scene.add(flash);
let vm: Record<GunKind, ViewModel>;

const steel = new THREE.MeshStandardMaterial({ color: 0x5a5d63, roughness: 0.35, metalness: 0.9 });
const blued = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.85 });
const brass = new THREE.MeshStandardMaterial({ color: 0xb58a3c, roughness: 0.4, metalness: 0.9 });
const walnut = new THREE.MeshStandardMaterial({ color: 0x4b2d18, roughness: 0.55 });
const skin = new THREE.MeshStandardMaterial({ color: PALETTE.skin, roughness: 0.8 });
const sleeve = new THREE.MeshStandardMaterial({ color: 0x4a5a7a, roughness: 0.9 });

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, name?: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.castShadow = true; if (name) mesh.name = name;
  return mesh;
}
function cyl(r1: number, r2: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, rotX = Math.PI / 2, name?: string) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 16), m);
  mesh.position.set(x, y, z); mesh.rotation.x = rotX; mesh.castShadow = true; if (name) mesh.name = name;
  return mesh;
}
function hand(x: number, y: number, z: number, rotZ = 0) {
  const g = new THREE.Group();
  g.add(box(0.085, 0.05, 0.1, skin));
  g.add(box(0.09, 0.07, 0.12, sleeve, 0, 0.005, 0.11));
  g.position.set(x, y, z); g.rotation.z = rotZ;
  return g;
}

/** Procedural lever-action rifle, barrel along -Z, origin at the grip. */
function proceduralRifle(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.05, 0.11, 0.34, walnut, 0, -0.035, 0.26));            // stock
  g.add(box(0.055, 0.095, 0.16, brass, 0, 0.0, 0.02));              // receiver (brass frame, 1873 style)
  g.add(cyl(0.016, 0.016, 0.62, blued, 0, 0.04, -0.37));            // barrel
  g.add(cyl(0.013, 0.013, 0.58, blued, 0, 0.005, -0.35));           // magazine tube
  g.add(box(0.045, 0.05, 0.34, walnut, 0, 0.02, -0.22));            // fore-end
  g.add(box(0.006, 0.03, 0.006, blued, 0, 0.072, -0.66));           // front sight
  const lever = new THREE.Group(); lever.name = 'lever'; lever.position.set(0, -0.045, 0.06);
  lever.add(box(0.014, 0.02, 0.14, steel, 0, -0.02, -0.02));
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 8, 16, Math.PI * 1.4), steel);
  loop.rotation.y = Math.PI / 2; loop.rotation.z = -Math.PI * 0.7; loop.position.set(0, -0.02, 0.02); lever.add(loop);
  g.add(lever);
  g.add(box(0.014, 0.03, 0.015, steel, 0, 0.06, 0.1, 'hammer'));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.04, -0.69); g.add(muzzle); muzzle.name = 'muzzle';
  return g;
}
/** Procedural single-action revolver, barrel along -Z, origin at the grip. */
function proceduralRevolver(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.03, 0.09, 0.04, walnut, 0, -0.045, 0.045));           // grip
  g.add(box(0.028, 0.055, 0.11, blued, 0, 0.012, -0.01));           // frame
  const cylinder = cyl(0.024, 0.024, 0.05, steel, 0, 0.022, -0.03, Math.PI / 2, 'cylinder');
  // flutes
  for (let i = 0; i < 6; i++) {
    const f = cyl(0.005, 0.005, 0.052, blued, Math.cos(i / 6 * Math.PI * 2) * 0.02, Math.sin(i / 6 * Math.PI * 2) * 0.02, 0, 0);
    f.rotation.set(0, 0, 0); cylinder.add(f);
  }
  g.add(cylinder);
  g.add(cyl(0.01, 0.01, 0.19, blued, 0, 0.03, -0.15));              // barrel
  g.add(box(0.004, 0.012, 0.004, blued, 0, 0.046, -0.235));         // front sight
  g.add(box(0.012, 0.03, 0.012, steel, 0, 0.045, 0.03, 'hammer'));   // hammer
  g.add(box(0.006, 0.03, 0.02, steel, 0, -0.02, -0.02));             // trigger guard-ish
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.03, -0.25); g.add(muzzle); muzzle.name = 'muzzle';
  return g;
}

function findNamed(root: THREE.Object3D, names: string[]): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse(o => { if (!found && names.some(n => o.name.toLowerCase().includes(n))) found = o; });
  return found;
}

/** Normalise a loaded gun model: barrel along -Z, length L, origin near the grip. */
function fitGun(gltf: GLTF, length: number): THREE.Object3D {
  const m = gltf.scene;
  m.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; (o as THREE.Mesh).frustumCulled = false; } });
  const bb = new THREE.Box3().setFromObject(m);
  const sz = bb.getSize(new THREE.Vector3());
  // longest axis becomes Z
  if (sz.x >= sz.y && sz.x >= sz.z) m.rotation.y = -Math.PI / 2;
  else if (sz.y >= sz.x && sz.y >= sz.z) m.rotation.x = Math.PI / 2;
  const wrap = new THREE.Group(); wrap.add(m);
  const bb2 = new THREE.Box3().setFromObject(wrap);
  const sz2 = bb2.getSize(new THREE.Vector3());
  wrap.scale.setScalar(length / Math.max(sz2.z, 0.001));
  const bb3 = new THREE.Box3().setFromObject(wrap);
  const c = bb3.getCenter(new THREE.Vector3());
  // put the centre slightly back of origin so the grip sits at the origin
  wrap.position.set(-c.x, -c.y, -c.z + length * 0.3);
  const out = new THREE.Group(); out.add(wrap);
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle';
  const bb4 = new THREE.Box3().setFromObject(out);
  muzzle.position.set(0, (bb4.min.y + bb4.max.y) / 2 + sz2.y * wrap.scale.x * 0.2, bb4.min.z);
  out.add(muzzle);
  return out;
}

function makeVM(kind: GunKind, gltf: GLTF | null): ViewModel {
  const root = new THREE.Group();
  let model: THREE.Object3D;
  if (gltf) model = fitGun(gltf, kind === 'rifle' ? 1.05 : 0.3);
  else model = kind === 'rifle' ? proceduralRifle() : proceduralRevolver();
  root.add(model);
  // hands
  if (kind === 'rifle') { root.add(hand(0.0, -0.06, 0.12)); root.add(hand(0.0, -0.02, -0.28, 0.3)); }
  else { root.add(hand(0.0, -0.08, 0.05)); }
  const muzzle = findNamed(model, ['muzzle']) ?? model;
  const restPos = kind === 'rifle' ? new THREE.Vector3(0.2, -0.22, -0.42) : new THREE.Vector3(0.17, -0.2, -0.38);
  const restRot = kind === 'rifle' ? new THREE.Euler(0.02, 0.08, 0) : new THREE.Euler(0.0, 0.05, 0);
  root.position.copy(restPos); root.rotation.copy(restRot);
  // viewmodel renders on top of the world: no depth fighting with coaches when leaning
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.renderOrder = 5; } });
  return {
    root, model, muzzle, restPos, restRot,
    lever: findNamed(model, ['lever']), cylinder: findNamed(model, ['cylinder', 'drum']), hammer: findNamed(model, ['hammer']),
  };
}

export function initGuns(rifle: GLTF | null, revolver: GLTF | null) {
  vm = { rifle: makeVM('rifle', rifle), revolver: makeVM('revolver', revolver) };
  rig.add(vm.rifle.root, vm.revolver.root);
  vm.revolver.root.visible = false;
  gun.kind = 'rifle'; gun.rounds = 1; gun.state = 'ready';
}

// ---- animation state ----
const recoil = { z: 0, rx: 0, vz: 0, vrx: 0 };
const sway = { x: 0, y: 0 };
let leverPhase = -1;   // -1 idle, else 0..1
let cylSpin = 0;

/** Called when the player turns; feeds the gun sway. */
export function feedSway(dYaw: number, dPitch: number) { sway.x += dYaw * 0.9; sway.y += dPitch * 0.9; }

export type FireResult = { ok: true; spread: number } | { ok: false; reason: 'busy' | 'dry' };

/** Attempt a shot. Caller performs the raycast using the returned spread. */
export function tryFire(): FireResult {
  if (gun.state !== 'ready') return { ok: false, reason: 'busy' };
  if (gun.rounds <= 0) {
    if (gun.kind === 'revolver') startReload();
    return { ok: false, reason: 'dry' };
  }
  gun.rounds--;
  const v = vm[gun.kind];
  const mpos = v.muzzle.getWorldPosition(new THREE.Vector3());
  muzzleSmoke(mpos, forward, gun.kind === 'rifle' ? 26 : 16);
  flash.position.copy(mpos).addScaledVector(forward, 0.25);
  flash.intensity = gun.kind === 'rifle' ? 60 : 40; flash.visible = true;
  if (gun.kind === 'rifle') {
    recoil.vz += 1.5; recoil.vrx += 3.4;
    gun.state = 'cycling'; gun.timer = RIFLE_LEVER_TIME; leverPhase = 0;
    return { ok: true, spread: RIFLE_SPREAD };
  } else {
    recoil.vz += 0.8; recoil.vrx += 3.6;
    gun.state = 'cycling'; gun.timer = REVOLVER_FIRE_TIME;
    return { ok: true, spread: REVOLVER_SPREAD };
  }
}

export function startReload(): boolean {
  if (gun.kind !== 'revolver' || gun.state !== 'ready' || gun.rounds === REVOLVER_ROUNDS) return false;
  gun.state = 'reloading'; gun.timer = REVOLVER_RELOAD_TIME; cylSpin = 0;
  return true;
}

export function swapGun(): boolean {
  if (gun.state !== 'ready' && gun.state !== 'cycling') return false;
  if (gun.state === 'cycling' && gun.kind === 'rifle') return false; // finish the lever first
  gun.pendingSwap = gun.kind === 'rifle' ? 'revolver' : 'rifle';
  gun.state = 'swapping'; gun.timer = SWAP_TIME; gun.swapPhase = 0;
  return true;
}

export const gunEvents = { leverClack: false, reloadDone: false, swapped: false };

export function updateGuns(dt: number) {
  gunEvents.leverClack = false; gunEvents.reloadDone = false; gunEvents.swapped = false;
  // timing
  if (gun.state !== 'ready') {
    gun.timer -= dt;
    if (gun.state === 'swapping') {
      const t = 1 - gun.timer / SWAP_TIME;
      if (t >= 0.5 && gun.pendingSwap) {
        vm[gun.kind].root.visible = false;
        gun.kind = gun.pendingSwap; gun.pendingSwap = null;
        vm[gun.kind].root.visible = true;
        if (gun.kind === 'rifle') gun.rounds = 1; // rifle is always chambered
        gunEvents.swapped = true;
      }
      gun.swapPhase = t;
    }
    if (gun.timer <= 0) {
      if (gun.state === 'cycling' && gun.kind === 'rifle') gun.rounds = 1;
      if (gun.state === 'reloading') { gun.rounds = REVOLVER_ROUNDS; gunEvents.reloadDone = true; }
      gun.state = 'ready'; gun.timer = 0;
    }
  }
  // muzzle flash dies in ~60 ms
  if (flash.visible) { flash.intensity *= Math.exp(-45 * dt); if (flash.intensity < 0.5) { flash.intensity = 0; flash.visible = false; } }
  // recoil spring
  const k = 120, c = 14;
  recoil.vz += (-recoil.z * k - recoil.vz * c) * dt; recoil.z += recoil.vz * dt;
  recoil.vrx += (-recoil.rx * k - recoil.vrx * c) * dt; recoil.rx += recoil.vrx * dt;
  sway.x *= Math.exp(-8 * dt); sway.y *= Math.exp(-8 * dt);

  const v = vm[gun.kind];
  const r = v.root;
  r.position.copy(v.restPos);
  r.rotation.copy(v.restRot);
  r.position.z += recoil.z * 0.06;
  r.position.y += recoil.z * 0.01;
  r.rotation.x += recoil.rx * 0.03 + sway.y * 0.2;
  r.rotation.y += -sway.x * 0.25;
  r.position.x += -sway.x * 0.05;

  // lever cycle: tilt the gun and swing the lever
  if (gun.kind === 'rifle' && gun.state === 'cycling') {
    const t = clamp(1 - gun.timer / RIFLE_LEVER_TIME, 0, 1);
    const s = Math.sin(t * Math.PI);
    r.rotation.z += s * 0.35; r.rotation.x += s * 0.25; r.position.y -= s * 0.05; r.position.x += s * 0.03;
    if (v.lever) v.lever.rotation.x = s * 1.2;
    if (leverPhase >= 0 && t > 0.45 && leverPhase < 0.45) gunEvents.leverClack = true;
    leverPhase = t;
  } else if (v.lever) { v.lever.rotation.x = lerp(v.lever.rotation.x, 0, 0.3); leverPhase = -1; }

  // revolver: cylinder index per shot, spin on reload
  if (gun.kind === 'revolver') {
    if (gun.state === 'reloading') {
      const t = clamp(1 - gun.timer / REVOLVER_RELOAD_TIME, 0, 1);
      const s = Math.sin(t * Math.PI);
      r.rotation.z += s * 0.9; r.rotation.x += s * 0.5; r.position.y -= s * 0.08;
      cylSpin += dt * (8 + 30 * s);
      if (v.cylinder) v.cylinder.rotation.z = cylSpin;
    } else if (v.cylinder) {
      v.cylinder.rotation.z = lerp(v.cylinder.rotation.z, (REVOLVER_ROUNDS - gun.rounds) * (Math.PI * 2 / 6), 0.35);
    }
    if (v.hammer) v.hammer.rotation.x = gun.state === 'cycling' ? -0.6 : lerp(v.hammer.rotation.x, 0, 0.3);
  }
  // swap: dip down and up
  if (gun.state === 'swapping') {
    const t = gun.swapPhase; const dip = Math.sin(t * Math.PI);
    r.position.y -= dip * 0.35; r.rotation.x -= dip * 0.6;
  }
  // light random idle breathing
  const now = performance.now() / 1000;
  r.position.y += Math.sin(now * 1.4) * 0.003; r.position.x += Math.cos(now * 0.9) * 0.002;
}

export const gunRandomSpread = (spread: number) => ({ x: rand(-spread, spread), y: rand(-spread, spread) });
