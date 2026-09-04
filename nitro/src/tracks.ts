// =============================================================================
// track definitions (six themed loops) + road-ribbon geometry
// =============================================================================
import * as THREE from 'three';
import { mat } from './gfx';
import { roadTexture, TILE_M } from './roadsurface';

export type TrackId = 'speedway' | 'beach' | 'dirt' | 'ice' | 'volcano' | 'space';

export interface TrackDef {
  id: TrackId;
  name: string;
  type: string;         // one-line surface description shown on the menu
  width: number;
  points: [number, number, number?][];
  sky: [number, number, number];
  sunDir: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  hemi: [number, number];
  hemiIntensity?: number;
  ground: number | null;    // null = no ground (Space)
  road: number;
  curb: [number, number];
  fog: { color: number; near: number; far: number } | null;
  /** how much lateral grip the surface gives (1 = asphalt) */
  grip: number;
  /** speed multiplier when driving off the road */
  offRoad: number;
  /** falling off the road (Space) or into hazards sends you to a checkpoint */
  fallOff: boolean;
}

export const TRACKS: TrackDef[] = [
  {
    id: 'speedway', name: 'Speedway', type: 'smooth asphalt · fastest', width: 16,
    points: [[0, 0], [120, 0], [210, 12], [250, 60], [230, 120], [160, 150], [110, 125], [60, 145], [0, 170], [-70, 160], [-120, 110], [-125, 45], [-80, 5]],
    sky: [0x3f8fe6, 0x8fd0ff, 0xdff2ff], sunDir: [-0.4, 0.75, 0.5], sunColor: 0xfff4d6, sunIntensity: 2.2,
    hemi: [0xbfe4ff, 0x4f8f3a], ground: 0x5cb241, road: 0x4d5060, curb: [0xe83f3f, 0xf4f4f4],
    fog: { color: 0xbfe4ff, near: 260, far: 700 }, grip: 1, offRoad: 0.55, fallOff: false,
  },
  {
    id: 'beach', name: 'Beach', type: 'sunset sand · slow off the boardwalk', width: 14,
    points: [[0, 0], [90, -10], [160, 15], [205, 70], [180, 130], [120, 150], [60, 115], [0, 140], [-70, 165], [-135, 120], [-150, 55], [-105, 5], [-50, -12]],
    sky: [0x5b3fa0, 0xff8a5c, 0xffd27a], sunDir: [0.6, 0.18, -0.75], sunColor: 0xffc48a, sunIntensity: 2.0,
    hemi: [0xffc0a0, 0xd9b27c], ground: 0xf0d9a0, road: 0xa8896a, curb: [0x3aa6d8, 0xfff2cf],
    fog: { color: 0xffb083, near: 220, far: 620 }, grip: 0.85, offRoad: 0.35, fallOff: false,
  },
  {
    id: 'dirt', name: 'Dirt Rally', type: 'forest gravel · bumpy and slidey', width: 13,
    points: [[0, 0], [100, 0], [145, 30], [120, 75], [60, 65], [35, 100], [80, 140], [145, 150], [175, 200], [120, 240], [40, 225], [-40, 250], [-105, 205], [-90, 140], [-125, 90], [-90, 40], [-40, 18]],
    sky: [0x4a86c8, 0xa9d4f0, 0xe8f4e2], sunDir: [0.3, 0.7, 0.6], sunColor: 0xfff0d0, sunIntensity: 2.0,
    hemi: [0xcfe6ff, 0x3c6b2a], ground: 0x4f9138, road: 0x9a7448, curb: [0x6b4c2a, 0xd9b98a],
    fog: { color: 0xbcd9ea, near: 200, far: 600 }, grip: 0.7, offRoad: 0.5, fallOff: false,
  },
  {
    id: 'ice', name: 'Ice Lake', type: 'frozen lake · very slippery', width: 16,
    points: [[0, 0], [110, -20], [200, 20], [240, 100], [200, 180], [110, 200], [40, 160], [-40, 200], [-130, 190], [-190, 120], [-170, 40], [-100, -10]],
    sky: [0x2c5fa8, 0x9dcbf2, 0xf2f8ff], sunDir: [-0.5, 0.45, 0.7], sunColor: 0xeaf4ff, sunIntensity: 1.8,
    hemi: [0xdfefff, 0xa9c3d6], ground: 0xf3f8ff, road: 0xbfe3f5, curb: [0x2f6db5, 0xffffff],
    fog: { color: 0xdbeeff, near: 180, far: 560 }, grip: 0.35, offRoad: 0.6, fallOff: false,
  },
  {
    id: 'volcano', name: 'Volcano', type: 'night lava · dodge the pools', width: 14,
    points: [[0, 0], [110, 15], [170, 70], [150, 140], [90, 180], [20, 160], [-30, 200], [-110, 190], [-160, 120], [-140, 50], [-70, 10]],
    sky: [0x1c1038, 0x6a2a48, 0xd0552a], sunDir: [0.2, 0.3, -0.9], sunColor: 0xffa060, sunIntensity: 2.0,
    hemi: [0x9a5a6a, 0x5a3030], hemiIntensity: 1.6, ground: 0x3e3238, road: 0x3c3438, curb: [0xff7a1a, 0x2a1a1a],
    fog: { color: 0x4a1e26, near: 170, far: 560 }, grip: 0.9, offRoad: 0.45, fallOff: true,
  },
  {
    id: 'space', name: 'Space', type: 'floating track · no edges, don\'t fall!', width: 14,
    points: [[0, 0, 0], [110, 6, 0], [190, 18, 40], [210, 30, 120], [150, 22, 180], [70, 40, 170], [10, 55, 210], [-80, 45, 220], [-150, 20, 160], [-170, 8, 70], [-110, 0, 10]],
    sky: [0x03030c, 0x0a0a2a, 0x141040], sunDir: [-0.6, 0.5, 0.6], sunColor: 0xdde8ff, sunIntensity: 1.6,
    hemi: [0x4a3aa0, 0x120a30], ground: null, road: 0x2a2e5c, curb: [0x3df2ff, 0xb44dff],
    fog: null, grip: 0.95, offRoad: 1, fallOff: true,
  },
];

export const trackById = (id: string): TrackDef => TRACKS.find((t) => t.id === id) ?? TRACKS[0];

export interface Sample { p: THREE.Vector3; t: THREE.Vector3; n: THREE.Vector3; dist: number }

export interface BuiltTrack {
  def: TrackDef;
  curve: THREE.CatmullRomCurve3;
  samples: Sample[];
  length: number;
  group: THREE.Group;
}

export const SAMPLES = 900;

/** Closed Catmull-Rom loop through the control points, sampled evenly. */
export function buildTrack(def: TrackDef): BuiltTrack {
  const pts = def.points.map(([x, z, y]) => new THREE.Vector3(x, y ?? 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const spaced = curve.getSpacedPoints(SAMPLES);
  spaced.pop(); // last == first on a closed curve
  const length = curve.getLength();
  const samples: Sample[] = spaced.map((p, i) => {
    const t = curve.getTangentAt(i / SAMPLES).normalize();
    const n = new THREE.Vector3(-t.z, 0, t.x).normalize();
    return { p, t, n, dist: (i / SAMPLES) * length };
  });
  const group = new THREE.Group();
  const tex = roadTexture(def.id);
  group.add(roadRibbon(samples, def.width, 0xffffff, 0.02, false, tex, length, def.id === 'space' ? 0x22224a : 0));
  // curbs: alternating colour blocks along both edges
  const cw = def.id === 'space' ? 0.9 : 1.6;
  group.add(curbRibbon(samples, def.width / 2, def.width / 2 + cw, def.curb, def.id === 'space'));
  group.add(curbRibbon(samples, -def.width / 2 - cw, -def.width / 2, def.curb, def.id === 'space'));
  if (def.id === 'space') group.add(roadRibbon(samples, def.width + 1.8, 0x12122e, -0.6, true));
  // start / finish line
  const s0 = samples[0];
  const line = new THREE.Mesh(new THREE.PlaneGeometry(def.width, 2.4), mat(0xffffff, { emissive: 0x444444 }));
  line.rotation.x = -Math.PI / 2;
  line.position.copy(s0.p).add(new THREE.Vector3(0, 0.05, 0));
  line.rotation.z = Math.atan2(s0.t.x, s0.t.z);
  line.receiveShadow = true;
  group.add(line);
  const checker = new THREE.Mesh(new THREE.PlaneGeometry(def.width, 2.4, Math.floor(def.width), 2), checkerMat());
  checker.rotation.copy(line.rotation);
  checker.position.copy(line.position).y += 0.01;
  group.add(checker);
  return { def, curve, samples, length, group };
}

function checkerMat(): THREE.Material {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 2;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    g.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  return new THREE.MeshBasicMaterial({ map: tex });
}

function roadRibbon(samples: Sample[], width: number, color: number, yOff: number, doubleSided: boolean,
  tex?: THREE.Texture, length = 0, emissive = 0): THREE.Mesh {
  const n = samples.length;
  // the ribbon is n+1 rings so the texture's v can run 0..tiles without a seam
  const rings = n + 1;
  const tiles = Math.max(1, Math.round(length / TILE_M));
  const pos = new Float32Array(rings * 2 * 3);
  const uv = new Float32Array(rings * 2 * 2);
  const idx: number[] = [];
  for (let i = 0; i < rings; i++) {
    const s = samples[i % n];
    const l = s.p.clone().addScaledVector(s.n, -width / 2);
    const r = s.p.clone().addScaledVector(s.n, width / 2);
    pos.set([l.x, l.y + yOff, l.z, r.x, r.y + yOff, r.z], i * 6);
    const v = (i / n) * tiles;
    uv.set([0, v, 1, v], i * 4);
    if (i < n) idx.push(i * 2, i * 2 + 1, (i + 1) * 2, i * 2 + 1, (i + 1) * 2 + 1, (i + 1) * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat(color, { side: doubleSided ? THREE.DoubleSide : THREE.FrontSide, map: tex, emissive }));
  m.receiveShadow = true;
  return m;
}

function curbRibbon(samples: Sample[], a: number, b: number, colors: [number, number], glow: boolean): THREE.Mesh {
  const n = samples.length;
  const pos = new Float32Array(n * 2 * 3);
  const col = new Float32Array(n * 2 * 3);
  const idx: number[] = [];
  const c0 = new THREE.Color(colors[0]), c1 = new THREE.Color(colors[1]);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const l = s.p.clone().addScaledVector(s.n, a);
    const r = s.p.clone().addScaledVector(s.n, b);
    pos.set([l.x, l.y + 0.03, l.z, r.x, r.y + 0.03, r.z], i * 6);
    const c = Math.floor(i / 8) % 2 ? c0 : c1;
    col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    const j = (i + 1) % n;
    idx.push(i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = glow
    ? new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }))
    : new THREE.Mesh(g, mat(0xffffff, { vertexColors: true }));
  m.receiveShadow = true;
  return m;
}

/** Index of the nearest sample to a world position (brute force, cheap at 900). */
export function nearestSample(samples: Sample[], x: number, z: number, hint = -1, window = 40): number {
  let best = -1, bd = Infinity;
  const n = samples.length;
  const scan = (i: number) => {
    const p = samples[i].p;
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bd) { bd = d; best = i; }
  };
  if (hint >= 0) for (let k = -window; k <= window; k++) scan(((hint + k) % n + n) % n);
  else for (let i = 0; i < n; i++) scan(i);
  return best;
}

/** Signed lateral offset (metres) of a point from the centreline sample. */
export function lateral(s: Sample, x: number, z: number): number {
  return (x - s.p.x) * s.n.x + (z - s.p.z) * s.n.z;
}
