// world.ts — the Playground: an archipelago of four themed Islands around
// the Ship's water, plus terrain, sea, sky, Swingsets, Trees and the
// zip-line landing posts. Owns swing pendulum integration and tree
// fall / regrow animation.
//
// Conventions (see types.ts): Y-up, open water at WATER_Y everywhere the
// land dips below it. Each island's Swingset group is yawed by setYaw() so
// its local -Z faces the centre; a swing pivot rotated by +angle about X
// sends its seat toward the Ship, so `pivot.rotation.x = angle` still
// matches the contract directly.

import * as THREE from 'three';
import {
  ARCHIPELAGO_CENTER,
  type GameCtx,
  ISLAND_FLAT_R,
  ISLAND_SEA_R,
  ISLAND_THEMES,
  ISLAND_TOP,
  SEABED_Y,
  SHIP_ORBIT,
  STUMP_REGROW_SECONDS,
  SWINGS_PER_SET,
  SWINGSET_POSITIONS,
  SWING_BAR_HEIGHT,
  SWING_MAX_ANGLE,
  SWING_ROPE_LENGTH,
  setYaw,
  type SwingInfo,
  type SwingsetInfo,
  TREES_PER_SET,
  type TreeInfo,
  WATER_Y,
  type WorldApi,
  ZIP_POST_R,
  ringNeighbors,
  towardCenter,
} from './types';
import { clamp, damp } from './util';
import {
  canvasTexture,
  grassPatchTexture,
  inkWeight,
  noOutline,
  seaSplotchTexture,
  skyTexture,
  toonMat,
  woodGrainTexture,
  wornDirtTexture,
} from './toon';

// --- tuning ----------------------------------------------------------------

const G = 9.81;
const SWING_DAMPING = 0.22;
const PUMP_GAIN = 0.55;
const BAR_SPAN = 7; // metres of top bar along X
const SEAT_OFFSETS = [-2.55, -0.85, 0.85, 2.55]; // SWINGS_PER_SET along the bar

// Terrain covers the whole ring of islands (plus shore margin).
const TERRAIN_HALF = 130;
const TERRAIN_SEG = 4; // metres per quad

const FALL_SECONDS = 1;
const STAND_SECONDS = 0.7;

const WORN_W = 9.6; // worn grass/dirt patch under a swingset's seat row
const WORN_D = 4.8;

const TUFTS_PER_SET = 2200; // grass tufts clustered on each island
const TUFT_SET_RADIUS = 24;
const GRASS_MIN_H = 0.5; // no tufts on the sand ring / underwater

const ZIP_POST_H = 2.5; // cable anchor height on a landing post

// --- scratch (no per-frame allocation) -------------------------------------

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

// --- deterministic helpers -------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Cheap deterministic value noise — used only to vary terrain colour. */
function hillNoise(x: number, z: number): number {
  return (
    Math.sin(x * 0.037 + 1.3) * Math.cos(z * 0.041 - 0.7) +
    0.5 * Math.sin(x * 0.093 - 2.1) * Math.cos(z * 0.077 + 1.9)
  );
}

/** The exact surface used to build the terrain mesh: each island is a flat
 *  plateau whose beach slopes under the sea; between islands lies seabed. */
function landHeight(x: number, z: number): number {
  let h = SEABED_Y;
  for (const s of SWINGSET_POSITIONS) {
    const d = Math.hypot(x - s.x, z - s.z);
    const ih = ISLAND_TOP - (ISLAND_TOP - SEABED_Y) * smoothstep(ISLAND_FLAT_R, ISLAND_SEA_R, d);
    if (ih > h) h = ih;
  }
  return h;
}

/** Index of the island whose centre is nearest (x, z) — for theming. */
function nearestIsland(x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < SWINGSET_POSITIONS.length; i++) {
    const s = SWINGSET_POSITIONS[i];
    const d = (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// --- shared geometry / materials -------------------------------------------

const grainTex = woodGrainTexture();
const barkMat = toonMat({ color: 0x8a5a30, map: grainTex });
const chainMat = toonMat({ color: 0x3a4560 });
// Per-island theme materials, index-aligned with SWINGSET_POSITIONS.
const woodMats = ISLAND_THEMES.map((t) => toonMat({ color: t.wood, map: grainTex }));
const metalMats = ISLAND_THEMES.map((t) => toonMat({ color: t.metal }));
const seatMats = ISLAND_THEMES.map((t) => toonMat({ color: t.seat }));
const leafMats = ISLAND_THEMES.map((t) => toonMat({ color: t.leaf, flatShading: true }));
const leafWiltMats = ISLAND_THEMES.map((t) => toonMat({ color: t.leafWilt, flatShading: true }));
const cloudMat = inkWeight(
  new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }),
  0.007,
);

const unitCylGeo = new THREE.CylinderGeometry(1, 1, 1, 8); // scaled per use
const chainGeo = new THREE.CylinderGeometry(0.026, 0.026, 1, 5);
const seatGeo = new THREE.BoxGeometry(0.52, 0.07, 0.26);
const barGeo = new THREE.CylinderGeometry(0.09, 0.09, BAR_SPAN + 0.4, 8);
const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1, 7); // scaled by height
const foliageGeo = new THREE.IcosahedronGeometry(1, 0);
const stumpGeo = new THREE.CylinderGeometry(0.3, 0.38, 0.5, 8);
const cloudGeo = new THREE.IcosahedronGeometry(1, 1);

/** Stretch a unit cylinder (height 1, centred) so it spans `from` → `to`. */
function spanCylinder(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, r: number): void {
  tmpDir.subVectors(to, from);
  const len = tmpDir.length();
  mesh.position.addVectors(from, to).multiplyScalar(0.5);
  tmpQuat.setFromUnitVectors(UP, tmpDir.normalize());
  mesh.quaternion.copy(tmpQuat);
  mesh.scale.set(r, len, r);
}

// --- internal shapes -------------------------------------------------------

interface Swing extends SwingInfo {
  chainA: THREE.Mesh;
  chainB: THREE.Mesh;
  seat: THREE.Mesh;
  setGroup: THREE.Group;
  offsetX: number;
  phase: number;
  sway: number;
}

type TreeAnim = 'none' | 'falling' | 'standing' | 'regrow';

interface Tree extends TreeInfo {
  root: THREE.Object3D;
  tilt: THREE.Object3D;
  stump: THREE.Mesh;
  topAnchor: THREE.Object3D;
  foliage: THREE.Mesh[];
  fadeMeshes: THREE.Mesh[];
  fadeOp: number;
  anim: TreeAnim;
  animT: number;
  fallAngle: number;
  fromScale: number;
}

// ---------------------------------------------------------------------------

export function createWorld(ctx: GameCtx): WorldApi {
  const scene = ctx.scene;

  // --- lighting ------------------------------------------------------------

  // Cel lighting: a strong warm key against a modest cool fill, so the toon
  // ramp lands on a crisp light/shadow boundary instead of a mushy midtone.
  const hemi = new THREE.HemisphereLight(0xd8f0fc, 0x5a7a3c, 0.5);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d0, 2.0);
  sun.position.set(-42, 66, 38);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 190;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);
  const sunOffset = new THREE.Vector3(-42, 66, 38);

  // --- sky dome ------------------------------------------------------------

  // Gradient dome that follows the camera (kept inside the far plane).
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(470, 24, 12),
    noOutline(
      new THREE.MeshBasicMaterial({
        map: skyTexture(),
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    ),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // --- terrain -------------------------------------------------------------

  const tw = TERRAIN_HALF * 2;
  const td = TERRAIN_HALF * 2;
  const groundGeo = new THREE.PlaneGeometry(
    tw,
    td,
    Math.round(tw / TERRAIN_SEG),
    Math.round(td / TERRAIN_SEG),
  );
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(ARCHIPELAGO_CENTER.x, 0, ARCHIPELAGO_CENTER.z);

  {
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color();
    const sand = new THREE.Color();
    const wet = new THREE.Color();
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = landHeight(x, z);
      pos.setY(i, h);

      const theme = ISLAND_THEMES[nearestIsland(x, z)];
      const v = hillNoise(x * 2.3, z * 2.1);
      grass.setHSL(
        theme.grass[0] + v * 0.01,
        theme.grass[1] + v * 0.05,
        theme.grass[2] + v * 0.03,
      );
      sand.setHex(theme.sand);
      wet.setHex(theme.wetSand);
      // Colour bands follow height: grass plateau, dry sand ring, wet shore.
      const sandT = 1 - smoothstep(0.55, 0.95, h);
      const wetT = 1 - smoothstep(-0.1, 0.35, h);
      c.copy(grass).lerp(sand, sandT).lerp(wet, wetT);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    pos.needsUpdate = true;
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
  }

  const grassTex = grassPatchTexture();
  grassTex.repeat.set(tw / 24, td / 24); // one patch tile per ~24 m
  const ground = new THREE.Mesh(
    groundGeo,
    noOutline(toonMat({ vertexColors: true, map: grassTex })),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // --- water ---------------------------------------------------------------

  // One shared clock uniform drives the water swell and the grass wind.
  const animTime = { value: 0 };
  const seaTex = seaSplotchTexture();
  seaTex.repeat.set(52, 30); // splotch tiles ~28 m across the water plane
  const waterMat = noOutline(
    toonMat({
      color: 0xffffff, // the splotch texture carries the blues
      map: seaTex,
      transparent: true,
      opacity: 0.95,
    }),
  );
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = animTime;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uTime;\nvarying float vWave;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float w = sin(transformed.x * 0.11 + uTime * 1.05)
                + sin(transformed.z * 0.17 - uTime * 0.75)
                + 0.8 * sin((transformed.x + transformed.z) * 0.062 + uTime * 0.45);
        transformed.y += w * 0.075;
        vWave = w;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vWave;\nvoid main() {')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float foam = smoothstep(0.55, 1.6, vWave);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.96, 0.99, 1.0), foam * 0.75);`,
      );
  };

  const waterW = 1100;
  const waterGeo = new THREE.PlaneGeometry(waterW, waterW, 110, 110);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate(ARCHIPELAGO_CENTER.x, 0, ARCHIPELAGO_CENTER.z);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WATER_Y;
  water.renderOrder = 1;
  scene.add(water);

  // White scallop foam ring hugging each island's shoreline.
  const foamRingTex = canvasTexture(256, 256, (c) => {
    c.clearRect(0, 0, 256, 256);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.beginPath();
    c.arc(128, 128, 100, 0, Math.PI * 2);
    c.arc(128, 128, 89, 0, Math.PI * 2, true);
    c.fill('evenodd');
    // scallops bulging outward, a fainter rank lapping inward
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.beginPath();
      c.arc(128 + Math.cos(a) * 102, 128 + Math.sin(a) * 102, 8, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.beginPath();
      c.arc(128 + Math.cos(a + 0.1) * 84, 128 + Math.sin(a + 0.1) * 84, 6, 0, Math.PI * 2);
      c.fill();
    }
  });
  foamRingTex.wrapS = THREE.ClampToEdgeWrapping;
  foamRingTex.wrapT = THREE.ClampToEdgeWrapping;
  // Texture ring radius (100/128 of the half-size) lands on the shoreline.
  const FOAM_HALF = 24.8 * (128 / 100);
  const foamGeo = new THREE.PlaneGeometry(FOAM_HALF * 2, FOAM_HALF * 2);
  foamGeo.rotateX(-Math.PI / 2);
  const foamMat = noOutline(
    new THREE.MeshBasicMaterial({
      map: foamRingTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    }),
  );
  const foamRings: THREE.Mesh[] = [];
  for (const s of SWINGSET_POSITIONS) {
    const foam = new THREE.Mesh(foamGeo, foamMat);
    foam.position.set(s.x, WATER_Y + 0.12, s.z);
    foam.renderOrder = 2;
    scene.add(foam);
    foamRings.push(foam);
  }

  // --- clouds --------------------------------------------------------------

  const clouds: THREE.Object3D[] = [];
  {
    const cr = rng(9181);
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const puffs = 3 + Math.floor(cr() * 2);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(cloudGeo, cloudMat);
        m.position.set((cr() - 0.5) * 22, (cr() - 0.5) * 4, (cr() - 0.5) * 12);
        m.scale.setScalar(4 + cr() * 5);
        g.add(m);
      }
      g.position.set(-350 + cr() * 700, 52 + cr() * 26, -320 + cr() * 640);
      scene.add(g);
      clouds.push(g);
    }
  }

  // --- grass ---------------------------------------------------------------
  // Wind-blown tufts as InstancedMeshes: the sway runs entirely in the vertex
  // shader off the shared clock uniform, so animation costs zero per-frame JS.
  // One mesh per swingset cluster (each frustum-culled on its own bounding
  // sphere) plus one sparse mesh along the trek band.

  const bladeGeo = (() => {
    const r = rng(31337);
    const verts: number[] = [];
    const tints: number[] = [];
    const BLADES = 6;
    for (let b = 0; b < BLADES; b++) {
      const a = (b / BLADES) * Math.PI * 2 + r() * 1.1;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const bx = dx * (0.04 + r() * 0.09);
      const bz = dz * (0.04 + r() * 0.09);
      const h = 0.26 + r() * 0.44;
      const w = 0.028 + r() * 0.022;
      const lean = 0.1 + r() * 0.18;
      // Each blade is a tapered strip with a knee: wide base quad, then a
      // narrower tip triangle bent further outward — reads as a curved blade.
      const midY = h * 0.55;
      const midW = w * 0.55;
      const midL = lean * 0.4;
      const p = [
        [bx - dz * w, 0, bz + dx * w],
        [bx + dz * w, 0, bz - dx * w],
        [bx + dx * midL + dz * midW, midY, bz + dz * midL - dx * midW],
        [bx + dx * midL - dz * midW, midY, bz + dz * midL + dx * midW],
        [bx + dx * lean, h, bz + dz * lean],
      ];
      // dark rooted base up to a bright, slightly yellowed tip
      const t = [
        [0.55, 0.55, 0.55],
        [0.55, 0.55, 0.55],
        [0.88, 0.88, 0.82],
        [0.88, 0.88, 0.82],
        [1.18, 1.22, 0.95],
      ];
      for (const tri of [[0, 1, 2], [0, 2, 3], [3, 2, 4]]) {
        for (const vi of tri) {
          verts.push(p[vi][0], p[vi][1], p[vi][2]);
          tints.push(t[vi][0], t[vi][1], t[vi][2]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(tints, 3));
    // all normals point straight up so blades shade like the lawn under them
    const normals = new Float32Array(verts.length);
    for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return geo;
  })();

  /** Toon grass material with GPU wind. `nearFade` additionally shrinks tufts
   *  to nothing past ~12 m from the camera (for the dense carpet, whose window
   *  edge must dissolve into the baked far field instead of ending in a line). */
  function makeGrassMat(nearFade: boolean): THREE.MeshToonMaterial {
    const mat = noOutline(toonMat({ side: THREE.DoubleSide, vertexColors: true }));
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = animTime;
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'uniform float uTime;\nvoid main() {')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          // Phase from the tuft's translation keeps gusts spatially coherent;
          // the bend is pre-instance-rotation, so its direction varies per tuft.
          vec3 tuft = instanceMatrix[3].xyz;
          float wp = uTime * 1.8 + tuft.x * 0.24 + tuft.z * 0.19;
          float wind = sin(wp) + 0.45 * sin(wp * 2.17 + 1.4);
          transformed.xz += wind * vec2(0.14, 0.06) * position.y;` +
            (nearFade
              ? `
          transformed *= 1.0 - smoothstep(9.0, 12.5, distance(tuft, cameraPosition));`
              : ''),
        );
    };
    // wind-only and wind+fade variants must not share a compiled program
    mat.customProgramCacheKey = () => `grass-wind-${nearFade ? 'fade' : 'far'}`;
    return mat;
  }
  const grassMat = makeGrassMat(false);

  // Each island's frame: its swingset group is yawed to face the centre.
  const islandYaw = SWINGSET_POSITIONS.map((_, i) => setYaw(i));
  const islandCos = islandYaw.map(Math.cos);
  const islandSin = islandYaw.map(Math.sin);

  /** Tufts never grow on the worn dirt under a swingset's seats. The patch
   *  rectangle lives in the swingset group's yawed frame. */
  function onWornPatch(x: number, z: number): boolean {
    for (let i = 0; i < SWINGSET_POSITIONS.length; i++) {
      const s = SWINGSET_POSITIONS[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const lx = dx * islandCos[i] - dz * islandSin[i];
      const lz = dx * islandSin[i] + dz * islandCos[i];
      if (Math.abs(lx) < WORN_W / 2 + 0.8 && Math.abs(lz) < WORN_D / 2 + 0.8) {
        return true;
      }
    }
    return false;
  }

  interface TuftField {
    mesh: THREE.InstancedMesh;
    points: Array<{ x: number; z: number }>;
    seed: number;
    theme: number; // island theme index for tuft colour
  }
  const tuftFields: TuftField[] = [];

  /** (Re)compute every instance of a tuft field from its seed — used at
   *  planting time and to regrow scorched patches on a new Run. */
  function fillTuftField(f: TuftField): void {
    const r = rng(f.seed);
    const mat4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    const tint = ISLAND_THEMES[f.theme].tuft;
    for (let i = 0; i < f.points.length; i++) {
      const pt = f.points[i];
      pos.set(pt.x, landHeight(pt.x, pt.z), pt.z);
      quat.setFromAxisAngle(UP, r() * Math.PI * 2);
      const s = 0.7 + r() * 0.6;
      // squared draw: lots of short tufts, a scattering of knee-high ones
      const tall = r();
      scl.set(s, s * (0.5 + 1.5 * tall * tall), s);
      f.mesh.setMatrixAt(i, mat4.compose(pos, quat, scl));
      col.setHSL(
        tint[0] + (r() - 0.5) * 0.04,
        clamp(tint[1] - 0.05 + r() * 0.2, 0, 1),
        clamp(tint[2] - 0.04 + r() * 0.12, 0, 1),
      );
      f.mesh.setColorAt(i, col);
    }
    f.mesh.instanceMatrix.needsUpdate = true;
    if (f.mesh.instanceColor) f.mesh.instanceColor.needsUpdate = true;
  }

  function plantTufts(
    points: Array<{ x: number; z: number }>,
    seed: number,
    theme: number,
  ): void {
    const mesh = new THREE.InstancedMesh(bladeGeo, grassMat, points.length);
    const f: TuftField = { mesh, points, seed, theme };
    fillTuftField(f);
    tuftFields.push(f);
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  for (let si = 0; si < SWINGSET_POSITIONS.length; si++) {
    const spot = SWINGSET_POSITIONS[si];
    const r = rng(6203 + si * 131);
    const pts: Array<{ x: number; z: number }> = [];
    while (pts.length < TUFTS_PER_SET) {
      const a = r() * Math.PI * 2;
      const rad = Math.pow(r(), 0.7) * TUFT_SET_RADIUS; // denser near the set
      const x = spot.x + Math.cos(a) * rad;
      const z = spot.z + Math.sin(a) * rad;
      if (landHeight(x, z) < GRASS_MIN_H || onWornPatch(x, z)) continue;
      pts.push({ x, z });
    }
    plantTufts(pts, 811 + si, si);
  }

  // Dense carpet that follows the player: a grid-snapped window of instances.
  // Each grid cell hashes to a stable tuft (jitter, size, colour), so
  // recentring the window never makes the grass swim — tufts simply appear
  // at fixed world spots. Rebuilt only when the player crosses a few cells,
  // and the shader fades tufts out before the window edge so the carpet
  // dissolves into the baked far field.
  const DENSE_CELL = 0.5; // metres per tuft cell
  const DENSE_N = 24; // cells each side of centre → ~12 m radius
  const DENSE_RESNAP = 3; // rebuild after crossing this many cells

  const denseMesh = new THREE.InstancedMesh(bladeGeo, makeGrassMat(true), (2 * DENSE_N + 1) ** 2);
  denseMesh.frustumCulled = false; // always wrapped around the camera anyway
  denseMesh.receiveShadow = true;
  scene.add(denseMesh);
  let denseCX = Infinity;
  let denseCZ = Infinity;

  const denseMat4 = new THREE.Matrix4();
  const denseQuat = new THREE.Quaternion();
  const densePos = new THREE.Vector3();
  const denseScl = new THREE.Vector3();
  const denseCol = new THREE.Color();

  // Cannonball blasts bare the turf. Both grass systems consult this list;
  // it is cleared (and the tufts regrown) on a new Run.
  const scorches: Array<{ x: number; z: number; r: number }> = [];
  const MAX_SCORCHES = 64;

  function inScorched(x: number, z: number): boolean {
    for (const s of scorches) {
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz < s.r * s.r) return true;
    }
    return false;
  }

  function updateDenseGrass(px: number, pz: number): void {
    const cx = Math.round(px / DENSE_CELL);
    const cz = Math.round(pz / DENSE_CELL);
    if (Math.abs(cx - denseCX) < DENSE_RESNAP && Math.abs(cz - denseCZ) < DENSE_RESNAP) return;
    denseCX = cx;
    denseCZ = cz;
    let n = 0;
    for (let ix = cx - DENSE_N; ix <= cx + DENSE_N; ix++) {
      for (let iz = cz - DENSE_N; iz <= cz + DENSE_N; iz++) {
        const r = rng((Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) >>> 0);
        const x = (ix + (r() - 0.5) * 0.9) * DENSE_CELL;
        const z = (iz + (r() - 0.5) * 0.9) * DENSE_CELL;
        const h = landHeight(x, z);
        if (h < GRASS_MIN_H || onWornPatch(x, z) || inScorched(x, z)) continue;
        densePos.set(x, h, z);
        denseQuat.setFromAxisAngle(UP, r() * Math.PI * 2);
        const s = 0.55 + r() * 0.5; // finer undergrowth than the field accents
        const tall = r();
        denseScl.set(s, s * (0.55 + 1.3 * tall * tall), s);
        denseMesh.setMatrixAt(n, denseMat4.compose(densePos, denseQuat, denseScl));
        const tint = ISLAND_THEMES[nearestIsland(x, z)].tuft;
        denseCol.setHSL(
          tint[0] + (r() - 0.5) * 0.04,
          clamp(tint[1] - 0.05 + r() * 0.2, 0, 1),
          clamp(tint[2] - 0.04 + r() * 0.12, 0, 1),
        );
        denseMesh.setColorAt(n, denseCol);
        n++;
      }
    }
    denseMesh.count = n;
    denseMesh.instanceMatrix.needsUpdate = true;
    if (denseMesh.instanceColor) denseMesh.instanceColor.needsUpdate = true;
  }

  const scorchedTuft = new THREE.Matrix4().makeScale(0, 0, 0);

  function scorchGrassAt(x: number, z: number, radius: number): void {
    scorches.push({ x, z, r: radius });
    if (scorches.length > MAX_SCORCHES) scorches.shift();
    const r2 = radius * radius;
    for (const f of tuftFields) {
      let touched = false;
      for (let i = 0; i < f.points.length; i++) {
        const dx = f.points[i].x - x;
        const dz = f.points[i].z - z;
        if (dx * dx + dz * dz > r2) continue;
        f.mesh.setMatrixAt(i, scorchedTuft);
        touched = true;
      }
      if (touched) f.mesh.instanceMatrix.needsUpdate = true;
    }
    denseCX = Infinity; // rebuild the carpet window without the bared cells
  }

  function regrowGrass(): void {
    if (scorches.length === 0) return;
    scorches.length = 0;
    for (const f of tuftFields) fillTuftField(f);
    denseCX = Infinity;
  }

  // --- swingsets -----------------------------------------------------------

  const swingsets: SwingsetInfo[] = [];
  const allSwings: Swing[] = [];

  // Worn grass/dirt decal where feet drag under the swings.
  const wornTex = wornDirtTexture(SEAT_OFFSETS.map((o) => 0.5 + o / WORN_W));
  const wornGeo = new THREE.PlaneGeometry(WORN_W, WORN_D);
  wornGeo.rotateX(-Math.PI / 2);
  const wornMat = noOutline(toonMat({ map: wornTex, transparent: true, depthWrite: false }));

  for (let si = 0; si < SWINGSET_POSITIONS.length; si++) {
    const spot = SWINGSET_POSITIONS[si];
    const baseY = landHeight(spot.x, spot.z);
    const group = new THREE.Group();
    group.position.set(spot.x, baseY, spot.z);
    group.rotation.y = islandYaw[si]; // local -Z faces the Ship's water
    scene.add(group);

    const worn = new THREE.Mesh(wornGeo, wornMat);
    worn.position.y = 0.03;
    worn.receiveShadow = true;
    group.add(worn);

    // Wooden A-frame legs at each end, splayed along Z.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(unitCylGeo, woodMats[si]);
        tmpA.set(sx * 3.85, 0, sz * 1.75);
        tmpB.set(sx * 3.4, SWING_BAR_HEIGHT, 0);
        spanCylinder(leg, tmpA, tmpB, 0.11);
        leg.castShadow = true;
        group.add(leg);
      }
      // Cross-brace near the top of each A.
      const brace = new THREE.Mesh(unitCylGeo, woodMats[si]);
      tmpA.set(sx * 3.6, SWING_BAR_HEIGHT * 0.55, -0.85);
      tmpB.set(sx * 3.6, SWING_BAR_HEIGHT * 0.55, 0.85);
      spanCylinder(brace, tmpA, tmpB, 0.07);
      brace.castShadow = true;
      group.add(brace);
    }

    const bar = new THREE.Mesh(barGeo, metalMats[si]);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = SWING_BAR_HEIGHT;
    bar.castShadow = true;
    group.add(bar);

    const swings: SwingInfo[] = [];
    for (let k = 0; k < SWINGS_PER_SET; k++) {
      const offsetX = SEAT_OFFSETS[k % SEAT_OFFSETS.length];
      const pivot = new THREE.Object3D();
      pivot.position.set(offsetX, SWING_BAR_HEIGHT, 0);
      group.add(pivot);

      const chainA = new THREE.Mesh(chainGeo, chainMat);
      const chainB = new THREE.Mesh(chainGeo, chainMat);
      for (const [ch, side] of [
        [chainA, -1],
        [chainB, 1],
      ] as Array<[THREE.Mesh, number]>) {
        ch.position.set(side * 0.22, -SWING_ROPE_LENGTH / 2, 0);
        ch.scale.y = SWING_ROPE_LENGTH;
        ch.castShadow = true;
        pivot.add(ch);
      }

      const seat = new THREE.Mesh(seatGeo, seatMats[si]);
      seat.position.set(0, -SWING_ROPE_LENGTH, 0);
      seat.castShadow = true;
      pivot.add(seat);

      const swing: Swing = {
        setIndex: si,
        swingIndex: k,
        broken: false,
        angle: 0,
        angularVel: 0,
        pivot,
        chainA,
        chainB,
        seat,
        setGroup: group,
        offsetX,
        phase: si * 1.7 + k * 2.3,
        sway: 0,
        // Seat row runs along the group's local X — rotate into world space.
        restSeatPos: new THREE.Vector3(
          spot.x + offsetX * islandCos[si],
          baseY + SWING_BAR_HEIGHT - SWING_ROPE_LENGTH,
          spot.z - offsetX * islandSin[si],
        ),
        pump(strength: number) {
          if (swing.broken) return; // a Broken Swing never simulates
          const dir =
            Math.abs(swing.angularVel) > 0.03
              ? Math.sign(swing.angularVel)
              : Math.abs(swing.angle) > 0.03
                ? -Math.sign(swing.angle)
                : 1;
          swing.angularVel += dir * strength * PUMP_GAIN;
          clampAmplitude(swing);
        },
        seatWorldPos(out: THREE.Vector3): THREE.Vector3 {
          seat.updateWorldMatrix(true, false);
          return out.setFromMatrixPosition(seat.matrixWorld);
        },
      };
      swings.push(swing);
      allSwings.push(swing);
    }

    swingsets.push({
      index: si,
      position: new THREE.Vector3(spot.x, baseY, spot.z),
      swings,
      wrecked: () => swings.every((s) => s.broken),
    });
  }

  /** Cap the pendulum amplitude implied by (angle, angularVel). */
  function clampAmplitude(s: Swing): void {
    const cosAngle = Math.cos(s.angle);
    const cosAmp = cosAngle - (s.angularVel * s.angularVel * SWING_ROPE_LENGTH) / (2 * G);
    const cosMax = Math.cos(SWING_MAX_ANGLE);
    if (cosAmp < cosMax) {
      const v2 = ((2 * G) / SWING_ROPE_LENGTH) * (cosAngle - cosMax);
      const sign = s.angularVel >= 0 ? 1 : -1;
      s.angularVel = sign * Math.sqrt(Math.max(0, v2));
    }
  }

  // --- trees ---------------------------------------------------------------

  const trees: Tree[] = [];
  let treeId = 0;

  for (let si = 0; si < SWINGSET_POSITIONS.length; si++) {
    const spot = SWINGSET_POSITIONS[si];
    const r = rng(4711 + si * 977);
    for (let i = 0; i < TREES_PER_SET; i++) {
      // Loose arc behind / beside the swingset — never between it and the
      // water. Laid out in the island's local frame, then yawed into place.
      const a = -1.15 + (2.3 * i) / (TREES_PER_SET - 1) + (r() - 0.5) * 0.22;
      const rad = 9.5 + r() * 5.5;
      const lx = Math.sin(a) * rad;
      const lz = Math.cos(a) * rad;
      const x = spot.x + lx * islandCos[si] + lz * islandSin[si];
      const z = spot.z - lx * islandSin[si] + lz * islandCos[si];
      const y = landHeight(x, z);
      const height = 6 + r() * 2;

      const root = new THREE.Object3D();
      root.position.set(x, y, z);
      root.rotation.y = r() * Math.PI * 2;
      scene.add(root);

      const tilt = new THREE.Object3D();
      tilt.rotation.order = 'YXZ';
      tilt.rotation.y = r() * Math.PI * 2;
      root.add(tilt);

      const trunkH = height * 0.66;
      const trunk = new THREE.Mesh(trunkGeo, barkMat);
      trunk.scale.set(1, trunkH, 1);
      trunk.position.y = trunkH / 2;
      trunk.castShadow = true;
      tilt.add(trunk);

      const foliage: THREE.Mesh[] = [];
      const blobs = 2 + Math.floor(r() * 3);
      for (let b = 0; b < blobs; b++) {
        const m = new THREE.Mesh(foliageGeo, leafMats[si]);
        const t = blobs === 1 ? 0.5 : b / (blobs - 1);
        const rr = (1.5 + r() * 0.9) * (1 - t * 0.3);
        m.scale.set(rr, rr * 0.82, rr);
        m.position.set(
          (r() - 0.5) * 1.5,
          trunkH * 0.82 + t * height * 0.32 + r() * 0.3,
          (r() - 0.5) * 1.5,
        );
        m.castShadow = true;
        tilt.add(m);
        foliage.push(m);
      }

      const topAnchor = new THREE.Object3D();
      topAnchor.position.set(0, height * 0.72, 0);
      tilt.add(topAnchor);

      const stump = new THREE.Mesh(stumpGeo, barkMat);
      stump.position.y = 0.25;
      stump.castShadow = true;
      stump.visible = false;
      root.add(stump);

      const tree: Tree = {
        id: treeId++,
        setIndex: si,
        position: new THREE.Vector3(x, y, z),
        height,
        state: 'alive',
        root,
        tilt,
        stump,
        topAnchor,
        foliage,
        fadeMeshes: [trunk, ...foliage, stump],
        fadeOp: 1,
        anim: 'none',
        animT: 0,
        fallAngle: 0,
        fromScale: 1,
        topPos(out: THREE.Vector3): THREE.Vector3 {
          topAnchor.updateWorldMatrix(true, false);
          return out.setFromMatrixPosition(topAnchor.matrixWorld);
        },
      };
      trees.push(tree);
    }
  }

  // --- zip-line landing posts ------------------------------------------------
  // One post on each island facing each ring neighbour; the cable from a
  // neighbour's Lookout treetop ties off on its crossarm.

  const zipPostTops = new Map<string, THREE.Vector3>();
  const zipScratch = new THREE.Vector3();

  for (let si = 0; si < SWINGSET_POSITIONS.length; si++) {
    const spot = SWINGSET_POSITIONS[si];
    for (const nb of ringNeighbors(si)) {
      const n = SWINGSET_POSITIONS[nb];
      const dx = n.x - spot.x;
      const dz = n.z - spot.z;
      const d = Math.hypot(dx, dz) || 1;
      const px = spot.x + (dx / d) * ZIP_POST_R;
      const pz = spot.z + (dz / d) * ZIP_POST_R;
      const py = landHeight(px, pz);

      const post = new THREE.Group();
      post.position.set(px, py, pz);
      post.rotation.y = Math.atan2(dx / d, dz / d); // crossarm square to the cable
      scene.add(post);

      const pole = new THREE.Mesh(unitCylGeo, barkMat);
      pole.position.y = ZIP_POST_H / 2;
      pole.scale.set(0.14, ZIP_POST_H, 0.14);
      pole.castShadow = true;
      post.add(pole);

      const arm = new THREE.Mesh(unitCylGeo, woodMats[si]);
      arm.rotation.z = Math.PI / 2;
      arm.position.y = ZIP_POST_H - 0.1;
      arm.scale.set(0.09, 1.1, 0.09);
      arm.castShadow = true;
      post.add(arm);

      zipPostTops.set(`${si}:${nb}`, new THREE.Vector3(px, py + ZIP_POST_H, pz));
    }
  }

  function setFoliage(tree: Tree, mat: THREE.Material): void {
    for (const m of tree.foliage) m.material = mat;
  }

  function fellTree(info: TreeInfo, cause: 'chainsaw' | 'heart'): void {
    const tree = info as Tree;
    if (tree.state !== 'alive') return;
    tree.state = 'fallen';
    tree.fallCause = cause;
    tree.anim = 'falling';
    tree.animT = 0;
    tree.fallAngle = tree.tilt.rotation.x;
    tree.tilt.visible = true;
    tree.tilt.scale.setScalar(1);
    tree.stump.visible = cause === 'chainsaw';
    setFoliage(tree, leafWiltMats[tree.setIndex]);
    ctx.events.emit('treeFelled', { tree, cause });
  }

  function removeFallenTree(info: TreeInfo): void {
    const tree = info as Tree;
    if (tree.state !== 'fallen') return;
    tree.tilt.visible = false;
    tree.tilt.rotation.x = 0;
    if (tree.fallCause === 'chainsaw') {
      tree.state = 'stump';
      tree.anim = 'regrow';
      tree.animT = 0;
      tree.stump.visible = true;
      tree.tilt.scale.setScalar(0.05);
      tree.tilt.visible = true;
      setFoliage(tree, leafMats[tree.setIndex]);
    } else {
      tree.state = 'gone';
      tree.anim = 'none';
      tree.stump.visible = false;
    }
  }

  function reviveTree(tree: Tree): void {
    tree.state = 'alive';
    tree.fallCause = undefined;
    tree.anim = 'standing';
    tree.animT = 0;
    tree.fallAngle = tree.tilt.rotation.x;
    tree.tilt.visible = true;
    tree.stump.visible = false;
    setFoliage(tree, leafMats[tree.setIndex]);
    tree.fromScale = Math.max(0.2, tree.tilt.scale.x);
    tree.tilt.scale.setScalar(tree.fromScale);
  }

  /** Squared distance from the Ship's water at the archipelago centre. */
  function centerDist2(t: Tree): number {
    const dx = t.position.x - ARCHIPELAGO_CENTER.x;
    const dz = t.position.z - ARCHIPELAGO_CENTER.z;
    return dx * dx + dz * dz;
  }

  function syncHeartTrees(setIndex: number, hearts: number): void {
    const mine = trees.filter((t) => t.setIndex === setIndex);
    const want = clamp(Math.round(hearts), 0, mine.length);

    const alive = mine.filter((t) => t.state === 'alive');
    // Too many living Trees: the farthest-from-the-Ship ones fall first.
    if (alive.length > want) {
      alive.sort((a, b) => centerDist2(b) - centerDist2(a));
      for (let i = 0; i < alive.length - want; i++) fellTree(alive[i], 'heart');
    } else if (alive.length < want) {
      // Hearts refilled: heart-felled Trees stand back up (nearest the Ship first).
      const dead = mine
        .filter((t) => t.fallCause === 'heart' && (t.state === 'fallen' || t.state === 'gone'))
        .sort((a, b) => centerDist2(a) - centerDist2(b));
      let need = want - alive.length;
      for (const t of dead) {
        if (need <= 0) break;
        reviveTree(t);
        need--;
      }
      // Still short (chainsawed stumps): let those finish growing now.
      if (need > 0) {
        for (const t of mine) {
          if (need <= 0) break;
          if (t.state === 'stump') {
            reviveTree(t);
            need--;
          }
        }
      }
    }
  }

  // --- swing damage --------------------------------------------------------

  function breakSwing(info: SwingInfo): void {
    const s = info as Swing;
    if (s.broken) return;
    s.broken = true;
    s.angularVel = 0;
    s.angle = 0;
    s.sway = 0.09;
    // One chain snaps short and keeps dangling, the other is gone.
    s.chainB.visible = false;
    s.chainA.scale.y = SWING_ROPE_LENGTH * 0.55;
    s.chainA.position.y = (-SWING_ROPE_LENGTH * 0.55) / 2;
    // The seat drops to the ground under the swing.
    s.pivot.remove(s.seat);
    s.setGroup.add(s.seat);
    s.seat.position.set(s.offsetX + 0.15, 0.06, 0.55);
    s.seat.rotation.set(0.12, 0.6, 1.35);
  }

  function repairAllSwings(): void {
    regrowGrass(); // a new Run also heals the battle-scarred turf
    for (const s of allSwings) {
      s.broken = false;
      s.angle = 0;
      s.angularVel = 0;
      s.sway = 0;
      s.chainB.visible = true;
      s.chainA.scale.y = SWING_ROPE_LENGTH;
      s.chainA.position.y = -SWING_ROPE_LENGTH / 2;
      if (s.seat.parent !== s.pivot) {
        s.setGroup.remove(s.seat);
        s.pivot.add(s.seat);
      }
      s.seat.position.set(0, -SWING_ROPE_LENGTH, 0);
      s.seat.rotation.set(0, 0, 0);
      s.pivot.rotation.x = 0;
    }
  }

  // --- update --------------------------------------------------------------

  let time = 0;

  function updateSwings(dt: number): void {
    const ridden = ctx.player ? ctx.player.ridingSwing : null;
    for (const s of allSwings) {
      if (s.broken) {
        // A lone dangling chain, still swaying.
        s.sway = damp(s.sway, 0.055, 0.4, dt);
        s.pivot.rotation.x = Math.sin(time * 0.9 + s.phase) * s.sway;
        continue;
      }
      // Breeze on unoccupied swings.
      if (s !== ridden) {
        s.angularVel += Math.sin(time * 1.15 + s.phase) * 0.075 * dt;
      }
      const acc =
        -(G / SWING_ROPE_LENGTH) * Math.sin(s.angle) - SWING_DAMPING * s.angularVel;
      s.angularVel += acc * dt;
      s.angle += s.angularVel * dt;
      clampAmplitude(s);
      // Positive angle sends the seat toward -Z, i.e. toward the water.
      s.pivot.rotation.x = s.angle;
    }
  }

  function updateTrees(dt: number): void {
    for (const t of trees) {
      switch (t.anim) {
        case 'falling': {
          t.animT += dt / FALL_SECONDS;
          const p = clamp(t.animT, 0, 1);
          const eased = p * p; // tips slowly, then thumps down
          t.tilt.rotation.x = t.fallAngle + (Math.PI / 2 - t.fallAngle) * eased;
          if (p >= 1) {
            t.tilt.rotation.x = Math.PI / 2;
            t.anim = 'none';
          }
          break;
        }
        case 'standing': {
          t.animT += dt / STAND_SECONDS;
          const p = clamp(t.animT, 0, 1);
          const eased = p * p * (3 - 2 * p);
          t.tilt.rotation.x = t.fallAngle * (1 - eased);
          t.tilt.scale.setScalar(t.fromScale + (1 - t.fromScale) * eased);
          if (p >= 1) {
            t.tilt.rotation.x = 0;
            t.tilt.scale.setScalar(1);
            t.anim = 'none';
          }
          break;
        }
        case 'regrow': {
          t.animT += dt / STUMP_REGROW_SECONDS;
          const p = clamp(t.animT, 0, 1);
          t.tilt.scale.setScalar(0.05 + 0.95 * p);
          if (p >= 1) {
            t.tilt.scale.setScalar(1);
            t.stump.visible = false;
            t.state = 'alive';
            t.fallCause = undefined;
            t.anim = 'none';
          }
          break;
        }
        case 'none':
          break;
      }
    }
  }

  // --- near-camera fade ------------------------------------------------------
  // Trees the camera backs into turn see-through instead of clipping the lens
  // (repo convention — same behaviour as ninja's updateNearFade).

  const NEAR_FADE_START = 4.5; // lens-to-trunk distance where the fade begins
  const NEAR_FADE_END = 1.2; // fully faded by here
  const NEAR_FADE_MIN = 0.12; // faded trees stay faintly visible
  const NEAR_FADE_MARGIN = 1.5; // approximate canopy / trunk radius

  const fadeBase = new THREE.Vector3();
  const fadeDir = new THREE.Vector3();
  const fadeRel = new THREE.Vector3();

  /** Distance from the camera to the trunk line (base → top anchor), so a
   *  fallen trunk fades along its length too. */
  function treeCameraDistance(t: Tree, cam: THREE.Vector3): number {
    fadeBase.copy(t.position);
    t.topPos(fadeDir).sub(fadeBase);
    fadeRel.copy(cam).sub(fadeBase);
    const len2 = fadeDir.lengthSq();
    const u = len2 > 0 ? clamp(fadeRel.dot(fadeDir) / len2, 0, 1) : 0;
    return fadeBase.addScaledVector(fadeDir, u).distanceTo(cam);
  }

  function applyMeshFade(m: THREE.Mesh, op: number): void {
    const ud = m.userData as { baseMat?: THREE.Material; fadeMat?: THREE.Material };
    if (op > 0.995) {
      if (ud.baseMat && m.material === ud.fadeMat) m.material = ud.baseMat;
      return;
    }
    // Foliage swaps between the shared leaf materials at runtime — rebuild
    // the clone when the material it was made from is no longer current.
    if (m.material !== ud.fadeMat && m.material !== ud.baseMat) {
      ud.fadeMat?.dispose();
      ud.fadeMat = undefined;
      ud.baseMat = m.material as THREE.Material;
    }
    if (!ud.fadeMat) {
      ud.fadeMat = ud.baseMat!.clone();
      ud.fadeMat.transparent = true;
    }
    ud.fadeMat.opacity = op;
    m.material = ud.fadeMat;
  }

  function updateNearFade(dt: number): void {
    const cam = ctx.camera.position;
    for (const t of trees) {
      let target = 1;
      if (t.tilt.visible) {
        const d = treeCameraDistance(t, cam) - NEAR_FADE_MARGIN;
        target = clamp((d - NEAR_FADE_END) / (NEAR_FADE_START - NEAR_FADE_END), 0, 1);
        target = NEAR_FADE_MIN + (1 - NEAR_FADE_MIN) * target;
      }
      t.fadeOp = damp(t.fadeOp, target, 12, dt);
      for (const m of t.fadeMeshes) applyMeshFade(m, t.fadeOp);
    }
  }

  function update(dt: number): void {
    time += dt;
    animTime.value = time;
    // Splotch pattern drifts slowly; each island's foam ring breathes.
    seaTex.offset.x = time * 0.004;
    seaTex.offset.y = Math.sin(time * 0.35) * 0.01;
    for (let i = 0; i < foamRings.length; i++) {
      const f = foamRings[i];
      f.scale.setScalar(1 + Math.sin(time * 0.8 + i * 1.7) * 0.03);
      f.rotation.y = time * 0.02 + i;
    }
    sky.position.set(ctx.camera.position.x, 0, ctx.camera.position.z);
    updateSwings(dt);
    updateTrees(dt);
    updateNearFade(dt);

    // Drifting clouds.
    for (const c of clouds) {
      c.position.x += dt * 1.1;
      if (c.position.x > 400) c.position.x = -380;
    }

    // Keep the shadow camera over wherever the player is standing.
    const focus = ctx.player ? ctx.player.position : null;
    const fx = focus ? focus.x : 0;
    const fz = focus ? focus.z : SWINGSET_POSITIONS[0].z;
    updateDenseGrass(fx, fz);
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + sunOffset.x, sunOffset.y, fz + sunOffset.z);
  }

  // --- api -----------------------------------------------------------------

  return {
    swingsets,
    trees,
    groundHeightAt(x: number, z: number): number {
      return landHeight(x, z);
    },
    breakSwing,
    repairAllSwings,
    syncHeartTrees,
    fellTree,
    removeFallenTree,
    scorchGrassAt,
    shipAnchorage(setIndex: number): { x: number; z: number } {
      const i = clamp(setIndex, 0, SWINGSET_POSITIONS.length - 1);
      const f = towardCenter(i); // island → centre; the Ship parks past the centre side
      return {
        x: ARCHIPELAGO_CENTER.x - f.x * SHIP_ORBIT,
        z: ARCHIPELAGO_CENTER.z - f.z * SHIP_ORBIT,
      };
    },
    zipPostTop(onSet: number, facingSet: number): THREE.Vector3 {
      const top = zipPostTops.get(`${onSet}:${facingSet}`);
      if (top) return zipScratch.copy(top);
      const s = SWINGSET_POSITIONS[clamp(onSet, 0, SWINGSET_POSITIONS.length - 1)];
      return zipScratch.set(s.x, landHeight(s.x, s.z) + ZIP_POST_H, s.z);
    },
    update,
  };
}
