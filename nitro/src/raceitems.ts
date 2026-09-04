// =============================================================================
// everything that gets sprinkled onto the road for a race: coins, obstacles,
// boost / slow pads and the checkpoint gates. Laid out from a seeded RNG so a
// track plays the same every single run.
// =============================================================================
import * as THREE from 'three';
import { box, cyl, mat } from './gfx';
import { buildCoin, type CoinKind } from './cars';
import { buildObstacle, buildPad, type ObstacleKind } from './scenery';
import type { BuiltTrack, TrackId } from './tracks';
import { CHECKPOINTS, type PadKind } from './types';

/** obstacle kinds each track may use (matches the design brief) */
export const TRACK_OBSTACLES: Record<TrackId, ObstacleKind[]> = {
  speedway: ['cone', 'oil', 'tyres'],
  beach: ['dune', 'rock'],
  dirt: ['rock', 'oil'],
  ice: ['crack', 'rock'],
  volcano: ['lava', 'rock'],
  space: ['asteroid'],
};

/** collision radius per obstacle kind, and whether it bounces you or not */
const OBSTACLE_INFO: Record<ObstacleKind, { radius: number; solid: boolean }> = {
  rock: { radius: 2.2, solid: true },
  cone: { radius: 1.1, solid: true },
  tyres: { radius: 2.8, solid: true },
  dune: { radius: 3.2, solid: true },
  asteroid: { radius: 2.4, solid: true },
  oil: { radius: 3.0, solid: false },
  lava: { radius: 3.4, solid: false },
  crack: { radius: 2.6, solid: false },
};

export interface CoinItem {
  mesh: THREE.Mesh;
  kind: CoinKind;
  /** home position — the magnet drags mesh.position away from it */
  hx: number; hy: number; hz: number;
  taken: boolean;
}

export interface ObstacleItem {
  obj: THREE.Object3D;
  kind: ObstacleKind;
  x: number; z: number;
  radius: number;
  solid: boolean;
  dead: boolean;
  /** seconds of immunity after a hit so one rock can't hit you twice */
  cool: number;
}

export interface PadItem {
  obj: THREE.Group;
  kind: PadKind;
  x: number; z: number;
  radius: number;
  cool: number;
}

export interface GateItem {
  obj: THREE.Group;
  /** checkpoint index (1..CHECKPOINTS-1; #0 is the existing start line) */
  index: number;
  /** road height the gate sits at — Space has hills, so bob relative to this */
  baseY: number;
}

export interface Layout {
  group: THREE.Group;
  coins: CoinItem[];
  obstacles: ObstacleItem[];
  pads: PadItem[];
  gates: GateItem[];
  /** sample index of each checkpoint, #0 = start line */
  checkpointSamples: number[];
}

/** Sample index of checkpoint `k`. */
export function checkpointSample(sampleCount: number, k: number): number {
  return Math.floor((k / CHECKPOINTS) * sampleCount) % sampleCount;
}

/** Two posts, a banner and a little flag — visible from a long way off. */
export function buildGate(track: BuiltTrack, index: number): THREE.Group {
  const def = track.def;
  const n = track.samples.length;
  const s = track.samples[checkpointSample(n, index)];
  const g = new THREE.Group();
  const half = def.width / 2 + 1.4;
  const h = 7;
  const postCol = 0xf4f4f8;
  const bannerCol = 0x2f7cf6;
  for (const side of [-1, 1]) {
    const post = cyl(0.32, 0.42, h, postCol, 8, { emissive: 0x333344, emissiveIntensity: 0.4 });
    post.position.set(side * half, h / 2, 0);
    g.add(post);
    const foot = cyl(0.7, 0.8, 0.4, 0x33333f, 8);
    foot.position.set(side * half, 0.2, 0);
    g.add(foot);
  }
  const banner = box(half * 2 + 0.8, 1.5, 0.25, bannerCol, { emissive: 0x0a2a66, emissiveIntensity: 0.7 });
  banner.position.y = h - 0.9;
  g.add(banner);
  const stripe = box(half * 2 + 0.9, 0.25, 0.3, 0xffd23f, { emissive: 0x6a5400, emissiveIntensity: 0.6 });
  stripe.position.y = h - 1.65;
  g.add(stripe);
  const flag = box(2.2, 1.2, 0.12, 0xffd23f, { emissive: 0x6a5400, emissiveIntensity: 0.6 });
  flag.position.set(0, h + 0.6, 0);
  g.add(flag);

  g.position.copy(s.p);
  g.rotation.y = Math.atan2(-s.t.x, -s.t.z);
  return g;
}

/**
 * Scatter the whole run of pickups and hazards along the road.
 * `rnd` must be a seeded PRNG so the layout is stable between runs.
 */
export function buildLayout(track: BuiltTrack, rnd: () => number): Layout {
  const def = track.def;
  const n = track.samples.length;
  const group = new THREE.Group();
  const coins: CoinItem[] = [];
  const obstacles: ObstacleItem[] = [];
  const pads: PadItem[] = [];
  const gates: GateItem[] = [];
  const kinds = TRACK_OBSTACLES[def.id];

  const checkpointSamples: number[] = [];
  for (let k = 0; k < CHECKPOINTS; k++) checkpointSamples.push(checkpointSample(n, k));
  for (let k = 1; k < CHECKPOINTS; k++) {
    const obj = buildGate(track, k);
    group.add(obj);
    gates.push({ obj, index: k, baseY: obj.position.y });
  }

  /** keep the road clear right at the start line and around each gate */
  const nearGate = (i: number): boolean => {
    for (const c of checkpointSamples) {
      let d = Math.abs(i - c);
      d = Math.min(d, n - d);
      if (d < 14) return true;
    }
    return false;
  };

  const half = def.width / 2;
  for (let i = 6; i < n; i += 9) {
    if (nearGate(i)) continue;
    const s = track.samples[i];
    const roll = rnd();
    if (roll < 0.14) {
      // ---- obstacle
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const info = OBSTACLE_INFO[kind];
      const lat = (rnd() - 0.5) * (def.width - info.radius * 1.4);
      const obj = buildObstacle(kind, rnd);
      const p = s.p.clone().addScaledVector(s.n, lat);
      obj.position.x += p.x; obj.position.y += p.y; obj.position.z += p.z;
      // flat discs (oil / lava) are already laid down with rotation.x; adding a
      // yaw on top would tip them out of the road plane, and they're round anyway
      if (kind !== 'oil' && kind !== 'lava') obj.rotation.y += Math.atan2(-s.t.x, -s.t.z);
      group.add(obj);
      obstacles.push({ obj, kind, x: p.x, z: p.z, radius: info.radius, solid: info.solid, dead: false, cool: 0 });
      // gold coin tucked just past a hazard — risky but worth it
      if (rnd() < 0.35) addCoin(i + 2, 'gold', lat > 0 ? lat - info.radius - 1.6 : lat + info.radius + 1.6);
    } else if (roll < 0.24) {
      // ---- pad
      const kind: PadKind = rnd() < 0.62 ? 'boost' : 'slow';
      const obj = buildPad(kind);
      const lat = (rnd() - 0.5) * (def.width - 5);
      obj.position.copy(s.p).addScaledVector(s.n, lat);
      obj.rotation.y = Math.atan2(-s.t.x, -s.t.z);
      group.add(obj);
      pads.push({ obj, kind, x: obj.position.x, z: obj.position.z, radius: 3.0, cool: 0 });
    } else if (roll < 0.82) {
      // ---- coins, usually in a short run of 3
      const r = rnd();
      const kind: CoinKind = r < 0.72 ? 'bronze' : r < 0.92 ? 'silver' : 'gold';
      // gold lives out near the edge where it's easy to slide off
      const lat = kind === 'gold'
        ? (rnd() < 0.5 ? -1 : 1) * (half * (0.72 + rnd() * 0.2))
        : (rnd() - 0.5) * def.width * 0.7;
      const run = kind === 'gold' ? 1 : 1 + Math.floor(rnd() * 3);
      for (let c = 0; c < run; c++) addCoin(i + c * 3, kind, lat);
    }
  }

  function addCoin(idx: number, kind: CoinKind, lat: number): void {
    const s = track.samples[((idx % n) + n) % n];
    const l = Math.max(-half + 0.8, Math.min(half - 0.8, lat));
    const mesh = buildCoin(kind);
    mesh.position.copy(s.p).addScaledVector(s.n, l);
    mesh.position.y += 1.2;
    mesh.castShadow = false;
    group.add(mesh);
    coins.push({ mesh, kind, hx: mesh.position.x, hy: mesh.position.y, hz: mesh.position.z, taken: false });
  }

  return { group, coins, obstacles, pads, gates, checkpointSamples };
}

/**
 * Turn a normal car model into the grey translucent ghost: one shared material
 * for the whole car (readable on any track), no shadows. The originals are
 * disposed here because nothing else references them.
 * Returns the shared material so the caller can dispose it later.
 */
export function ghostifyMaterials(root: THREE.Object3D, opacity: number): THREE.Material {
  const ghostMat = mat(0xdfe6f2, { emissive: 0x8fa4c0, emissiveIntensity: 0.35, opacity });
  ghostMat.depthWrite = false;
  const dropped = new Set<THREE.Material>();
  root.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m && m !== ghostMat) dropped.add(m);
    mesh.material = ghostMat;
  });
  for (const m of dropped) m.dispose();
  return ghostMat;
}
