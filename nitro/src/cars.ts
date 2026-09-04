// =============================================================================
// the garage: five cars, each with one special ability, and their 3D models.
// Car local space: -Z is forward, +Y up, wheels at y=0.
// =============================================================================
import * as THREE from 'three';
import { box, cyl, sphere, mat } from './gfx';

export type CarId = 'f1' | 'frog' | 'ghost' | 'magnet' | 'tank';
export type AbilityId = 'boost' | 'jump' | 'phase' | 'magnet' | 'smash';

export interface CarSpec {
  id: CarId;
  name: string;
  cost: number;
  color: number;
  ability: AbilityId;
  abilityName: string;
  abilityBlurb: string;
  /** seconds the ability stays active */
  abilityTime: number;
  topSpeed: number;   // m/s
  accel: number;      // m/s^2
  grip: number;       // lateral grip multiplier
  turn: number;       // steering rate multiplier
  weight: number;     // how much obstacles slow it (lower = heavier)
}

export const CARS: CarSpec[] = [
  { id: 'f1', name: 'F1 Car', cost: 0, color: 0xe8262c, ability: 'boost', abilityName: 'Boost', abilityBlurb: 'Super speed for 3 seconds.', abilityTime: 3,
    topSpeed: 46, accel: 22, grip: 0.9, turn: 1.0, weight: 1.0 },
  { id: 'frog', name: 'Frog', cost: 30, color: 0x4fd14a, ability: 'jump', abilityName: 'Jump', abilityBlurb: 'Hop over obstacles, lava and gaps.', abilityTime: 1.5,
    topSpeed: 40, accel: 24, grip: 1.05, turn: 1.15, weight: 1.0 },
  { id: 'ghost', name: 'Ghost', cost: 60, color: 0xf2f4ff, ability: 'phase', abilityName: 'Phase', abilityBlurb: 'Pass straight through anything for 3 seconds.', abilityTime: 3,
    topSpeed: 42, accel: 26, grip: 0.8, turn: 1.25, weight: 1.1 },
  { id: 'magnet', name: 'Magnet', cost: 100, color: 0x2f7cf6, ability: 'magnet', abilityName: 'Magnet', abilityBlurb: 'Pulls in every nearby coin for 5 seconds.', abilityTime: 5,
    topSpeed: 41, accel: 20, grip: 1.0, turn: 1.0, weight: 0.9 },
  { id: 'tank', name: 'Tank', cost: 150, color: 0x6e7f3c, ability: 'smash', abilityName: 'Smash', abilityBlurb: 'Smash through obstacles for 5 seconds.', abilityTime: 5,
    topSpeed: 37, accel: 18, grip: 1.3, turn: 0.85, weight: 0.4 },
];

export const carById = (id: string): CarSpec => CARS.find((c) => c.id === id) ?? CARS[0];

export interface CarModel {
  group: THREE.Group;
  wheels: THREE.Mesh[];       // spin around local X
  steerWheels: THREE.Mesh[];  // front wheels (yaw with steering); wheel meshes are children of pivots
  body: THREE.Object3D;       // bobs / tilts
}

function wheel(r: number, w: number, dark = 0x1b1b22): THREE.Mesh {
  const m = cyl(r, r, w, dark, 14);
  m.rotation.z = Math.PI / 2;
  const hub = cyl(r * 0.55, r * 0.55, w + 0.02, 0xd8d8e0, 10);
  m.add(hub);
  return m;
}

function wheels(group: THREE.Group, r: number, w: number, halfW: number, front: number, rear: number): { all: THREE.Mesh[]; front: THREE.Mesh[] } {
  const all: THREE.Mesh[] = [], fr: THREE.Mesh[] = [];
  for (const [x, z] of [[-halfW, front], [halfW, front], [-halfW, rear], [halfW, rear]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const m = wheel(r, w);
    pivot.add(m);
    group.add(pivot);
    all.push(m);
    if (z === front) fr.push(m);
  }
  return { all, front: fr };
}

export function buildCar(spec: CarSpec): CarModel {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  let w: { all: THREE.Mesh[]; front: THREE.Mesh[] };
  const c = spec.color;
  switch (spec.id) {
    case 'f1': {
      const tub = box(1.1, 0.5, 3.6, c); tub.position.y = 0.55; body.add(tub);
      const nose = box(0.7, 0.32, 1.3, c); nose.position.set(0, 0.5, -2.2); body.add(nose);
      const fw = box(3.0, 0.12, 0.7, 0x2a2a33); fw.position.set(0, 0.32, -2.6); body.add(fw);
      const fwt = box(3.0, 0.1, 0.25, 0xffffff); fwt.position.set(0, 0.42, -2.9); body.add(fwt);
      const rw = box(2.6, 0.5, 0.3, 0x2a2a33); rw.position.set(0, 1.25, 1.75); body.add(rw);
      const rwS1 = box(0.1, 0.6, 0.8, 0x2a2a33); rwS1.position.set(-1.2, 1.0, 1.6); body.add(rwS1);
      const rwS2 = rwS1.clone(); rwS2.position.x = 1.2; body.add(rwS2);
      const air = box(0.5, 0.5, 1.0, c); air.position.set(0, 1.05, 0.4); body.add(air);
      const pod1 = box(0.6, 0.45, 2.0, c); pod1.position.set(-0.85, 0.5, 0.2); body.add(pod1);
      const pod2 = pod1.clone(); pod2.position.x = 0.85; body.add(pod2);
      const helmet = sphere(0.3, 0xffb400, 10); helmet.position.set(0, 0.95, -0.4); body.add(helmet);
      const stripe = box(0.3, 0.02, 3.4, 0xffffff); stripe.position.set(0, 0.81, 0); body.add(stripe);
      w = wheels(g, 0.42, 0.55, 1.25, -1.4, 1.35);
      break;
    }
    case 'frog': {
      const shell = sphere(1.2, c, 16); shell.scale.set(1.05, 0.7, 1.35); shell.position.y = 0.95; body.add(shell);
      const belly = sphere(1.0, 0xc8f5a4, 14); belly.scale.set(0.95, 0.45, 1.2); belly.position.y = 0.72; body.add(belly);
      for (const sx of [-0.55, 0.55]) {
        const eye = sphere(0.36, 0xffffff, 12); eye.position.set(sx, 1.75, -0.6); body.add(eye);
        const pupil = sphere(0.16, 0x111111, 8); pupil.position.set(sx, 1.8, -0.92); body.add(pupil);
        const lid = sphere(0.38, c, 12); lid.scale.set(1, 0.5, 1); lid.position.set(sx, 1.88, -0.6); body.add(lid);
      }
      const mouth = box(1.2, 0.08, 0.1, 0x2a4a1a); mouth.position.set(0, 1.0, -1.55); body.add(mouth);
      for (const sx of [-1.0, 1.0]) { const spot = sphere(0.22, 0x2f9a2a, 8); spot.scale.y = 0.4; spot.position.set(sx * 0.6, 1.72, 0.5); body.add(spot); }
      w = wheels(g, 0.45, 0.5, 1.15, -1.0, 1.0);
      break;
    }
    case 'ghost': {
      const opts = { opacity: 0.72 };
      const top = sphere(1.15, c, 16, opts); top.scale.set(1, 0.9, 1.3); top.position.y = 1.35; body.add(top);
      const mid = cyl(1.15, 1.2, 1.0, c, 16, opts); mid.position.y = 0.85; body.add(mid);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const b = sphere(0.36, c, 8, opts); b.position.set(Math.sin(a) * 1.0, 0.42, Math.cos(a) * 1.25); body.add(b);
      }
      for (const sx of [-0.4, 0.4]) { const eye = sphere(0.2, 0x1a1a3a, 10); eye.scale.set(0.7, 1.3, 0.5); eye.position.set(sx, 1.55, -1.4); body.add(eye); }
      const mouth = sphere(0.18, 0x1a1a3a, 8); mouth.scale.set(1.2, 1.4, 0.4); mouth.position.set(0, 1.05, -1.5); body.add(mouth);
      w = wheels(g, 0.4, 0.5, 1.1, -0.9, 0.9);
      for (const m of w.all) (m.material as THREE.Material).transparent = true, ((m.material as THREE.Material).opacity = 0.7);
      break;
    }
    case 'magnet': {
      const base = box(2.0, 0.6, 3.4, c); base.position.y = 0.7; body.add(base);
      const cab = box(1.7, 0.7, 1.7, 0x9dd0ff, { opacity: 0.9 }); cab.position.set(0, 1.35, 0.1); body.add(cab);
      const roof = box(1.8, 0.12, 1.8, c); roof.position.set(0, 1.75, 0.1); body.add(roof);
      const bumper = box(2.1, 0.3, 0.3, 0xdde3ee); bumper.position.set(0, 0.5, -1.7); body.add(bumper);
      const mag = new THREE.Group(); mag.position.set(0, 2.55, 0.1);
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.22, 10, 16, Math.PI), mat(0xe8262c));
      arc.castShadow = true; mag.add(arc);
      for (const sx of [-0.55, 0.55]) {
        const leg = cyl(0.22, 0.22, 0.55, 0xe8262c, 10); leg.position.set(sx, -0.27, 0); mag.add(leg);
        const tip = cyl(0.23, 0.23, 0.25, 0xf0f0f0, 10); tip.position.set(sx, -0.65, 0); mag.add(tip);
      }
      body.add(mag);
      const post = cyl(0.12, 0.12, 0.8, 0x333340, 8); post.position.set(0, 2.1, 0.1); body.add(post);
      w = wheels(g, 0.45, 0.5, 1.15, -1.1, 1.1);
      break;
    }
    case 'tank': {
      const hull = box(2.4, 0.8, 3.6, c); hull.position.y = 0.95; body.add(hull);
      const slope = box(2.4, 0.5, 0.9, c); slope.rotation.x = 0.55; slope.position.set(0, 1.0, -1.8); body.add(slope);
      const turret = cyl(0.9, 1.05, 0.6, 0x5f6e33, 12); turret.position.set(0, 1.65, 0.25); body.add(turret);
      const barrel = cyl(0.13, 0.13, 2.2, 0x3f4a24, 8); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.7, -1.4); body.add(barrel);
      const hatch = cyl(0.3, 0.3, 0.15, 0x3f4a24, 10); hatch.position.set(0.3, 1.98, 0.3); body.add(hatch);
      for (const sx of [-1.35, 1.35]) {
        const tread = box(0.6, 0.9, 4.0, 0x2a2a2a); tread.position.set(sx, 0.55, 0); body.add(tread);
        const trim = box(0.62, 0.1, 4.0, 0x5c5c5c); trim.position.set(sx, 0.55, 0); body.add(trim);
      }
      const star = box(0.4, 0.02, 0.4, 0xf4f4f4); star.rotation.y = Math.PI / 4; star.position.set(0, 1.36, -0.6); body.add(star);
      w = wheels(g, 0.35, 0.3, 1.35, -1.4, 1.4);
      for (const m of w.all) m.visible = false; // hidden inside the treads, still animated for bounce
      break;
    }
  }
  return { group: g, wheels: w.all, steerWheels: w.front, body };
}

// ---- pickups & obstacles shared by every track ----

export type CoinKind = 'bronze' | 'silver' | 'gold';
export const COIN_VALUE: Record<CoinKind, number> = { bronze: 1, silver: 5, gold: 10 };
const COIN_COLOR: Record<CoinKind, [number, number]> = {
  bronze: [0xc9772b, 0xffb066], silver: [0xc9d3dd, 0xffffff], gold: [0xf5c518, 0xfff2a0],
};

export function buildCoin(kind: CoinKind): THREE.Mesh {
  const [col, glow] = COIN_COLOR[kind];
  const r = kind === 'gold' ? 0.85 : kind === 'silver' ? 0.75 : 0.65;
  const m = cyl(r, r, 0.18, col, 18, { emissive: glow, emissiveIntensity: 0.25 });
  m.rotation.z = Math.PI / 2;
  const inner = cyl(r * 0.7, r * 0.7, 0.2, glow, 18, { emissive: col, emissiveIntensity: 0.2 });
  m.add(inner);
  return m;
}
