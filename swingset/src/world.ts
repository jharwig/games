// world.ts — the Playground: terrain, water, sky, Swingsets and Trees.
// Owns swing pendulum integration and tree fall / regrow animation.
//
// Conventions (see types.ts): Y-up, water fills z < 0 at WATER_Y, the shore
// runs along X, the Playground is on z > 0 and a Swing moving toward the
// water moves toward -Z. A swing pivot rotated by +angle about X sends its
// seat to -Z, so `pivot.rotation.x = angle` matches the contract directly.

import * as THREE from 'three';
import {
  type GameCtx,
  STUMP_REGROW_SECONDS,
  SWINGS_PER_SET,
  SWINGSET_POSITIONS,
  SWING_BAR_HEIGHT,
  SWING_MAX_ANGLE,
  SWING_ROPE_LENGTH,
  type SwingInfo,
  type SwingsetInfo,
  TREES_PER_SET,
  type TreeInfo,
  WATER_Y,
  type WorldApi,
} from './types';
import { clamp, damp } from './util';

// --- tuning ----------------------------------------------------------------

const G = 9.81;
const SWING_DAMPING = 0.22;
const PUMP_GAIN = 0.55;
const BAR_SPAN = 7; // metres of top bar along X
const SEAT_OFFSETS = [-2.55, -0.85, 0.85, 2.55]; // SWINGS_PER_SET along the bar

const BEACH_END = 2.4; // land reaches y = 0 here; sand fades to grass by ~10
const BEACH_SLOPE = 0.12;
const WATER_EDGE_Z = 1.6; // water plane stops just short of dry sand
const HILL_START = 55; // everything nearer than this is dead flat
const HILL_FULL = 100;
const HILL_AMP = 1.6;

const TERRAIN_X0 = -260;
const TERRAIN_X1 = 380;
const TERRAIN_Z0 = -10;
const TERRAIN_Z1 = 250;
const TERRAIN_SEG = 4; // metres per quad

const FALL_SECONDS = 1;
const STAND_SECONDS = 0.7;
const ANCHORAGE_Z = -28;

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

/** Cheap deterministic rolling hills, only used far from the gameplay area. */
function hillNoise(x: number, z: number): number {
  return (
    Math.sin(x * 0.037 + 1.3) * Math.cos(z * 0.041 - 0.7) +
    0.5 * Math.sin(x * 0.093 - 2.1) * Math.cos(z * 0.077 + 1.9)
  );
}

/** The exact surface used to build the terrain mesh (land, may go negative). */
function landHeight(x: number, z: number): number {
  if (z < BEACH_END) return Math.max(-2.2, (z - BEACH_END) * BEACH_SLOPE);
  const mask = smoothstep(HILL_START, HILL_FULL, z);
  if (mask <= 0) return 0;
  return hillNoise(x, z) * HILL_AMP * mask;
}

// --- shared geometry / materials -------------------------------------------

const barkMat = new THREE.MeshLambertMaterial({ color: 0x6b4d33 });
const woodMat = new THREE.MeshLambertMaterial({ color: 0x8a6440 });
const metalMat = new THREE.MeshLambertMaterial({ color: 0x9aa2a8 });
const chainMat = new THREE.MeshLambertMaterial({ color: 0x3b3f44 });
const seatMat = new THREE.MeshLambertMaterial({ color: 0x2f3438 });
const leafMat = new THREE.MeshLambertMaterial({ color: 0x466b30, flatShading: true });
const leafWiltMat = new THREE.MeshLambertMaterial({ color: 0x7a6a34, flatShading: true });
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xf4f8fb, fog: false });

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
  anim: TreeAnim;
  animT: number;
  fallAngle: number;
  fromScale: number;
}

// ---------------------------------------------------------------------------

export function createWorld(ctx: GameCtx): WorldApi {
  const scene = ctx.scene;

  // --- lighting ------------------------------------------------------------

  const hemi = new THREE.HemisphereLight(0xcfe4f2, 0x53663a, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d6, 1.5);
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

  // --- terrain -------------------------------------------------------------

  const tw = TERRAIN_X1 - TERRAIN_X0;
  const td = TERRAIN_Z1 - TERRAIN_Z0;
  const groundGeo = new THREE.PlaneGeometry(
    tw,
    td,
    Math.round(tw / TERRAIN_SEG),
    Math.round(td / TERRAIN_SEG),
  );
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(TERRAIN_X0 + tw / 2, 0, TERRAIN_Z0 + td / 2);

  {
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color();
    const sand = new THREE.Color(0xcbb489);
    const wet = new THREE.Color(0xa2916d);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, landHeight(x, z));

      const v = hillNoise(x * 2.3, z * 2.1);
      grass.setHSL(0.255 + v * 0.012, 0.34 + v * 0.05, 0.31 + v * 0.035);
      const sandT = 1 - smoothstep(6.5, 12, z); // sand strip along the shore
      const wetT = 1 - smoothstep(-1, 2.2, z);
      c.copy(grass).lerp(sand, sandT).lerp(wet, wetT);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    pos.needsUpdate = true;
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
  }

  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // --- water ---------------------------------------------------------------

  const waterTime = { value: 0 };
  const waterMat = new THREE.MeshLambertMaterial({
    color: 0x2c5e78,
    transparent: true,
    opacity: 0.93,
  });
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterTime;
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
        float foam = clamp(vWave * 0.34 + 0.34, 0.0, 1.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.60, 0.79, 0.84), foam * 0.42);`,
      );
  };

  const waterW = 1500;
  const waterD = 820;
  const waterGeo = new THREE.PlaneGeometry(waterW, waterD, 150, 82);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate(60, 0, WATER_EDGE_Z - waterD / 2);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WATER_Y;
  water.renderOrder = 1;
  scene.add(water);

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
      g.position.set(-260 + cr() * 700, 52 + cr() * 26, -280 + cr() * 420);
      scene.add(g);
      clouds.push(g);
    }
  }

  // --- swingsets -----------------------------------------------------------

  const swingsets: SwingsetInfo[] = [];
  const allSwings: Swing[] = [];

  for (let si = 0; si < SWINGSET_POSITIONS.length; si++) {
    const spot = SWINGSET_POSITIONS[si];
    const baseY = landHeight(spot.x, spot.z);
    const group = new THREE.Group();
    group.position.set(spot.x, baseY, spot.z);
    scene.add(group);

    // Wooden A-frame legs at each end, splayed along Z.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(unitCylGeo, woodMat);
        tmpA.set(sx * 3.85, 0, sz * 1.75);
        tmpB.set(sx * 3.4, SWING_BAR_HEIGHT, 0);
        spanCylinder(leg, tmpA, tmpB, 0.11);
        leg.castShadow = true;
        group.add(leg);
      }
      // Cross-brace near the top of each A.
      const brace = new THREE.Mesh(unitCylGeo, woodMat);
      tmpA.set(sx * 3.6, SWING_BAR_HEIGHT * 0.55, -0.85);
      tmpB.set(sx * 3.6, SWING_BAR_HEIGHT * 0.55, 0.85);
      spanCylinder(brace, tmpA, tmpB, 0.07);
      brace.castShadow = true;
      group.add(brace);
    }

    const bar = new THREE.Mesh(barGeo, metalMat);
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

      const seat = new THREE.Mesh(seatGeo, seatMat);
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
        restSeatPos: new THREE.Vector3(
          spot.x + offsetX,
          baseY + SWING_BAR_HEIGHT - SWING_ROPE_LENGTH,
          spot.z,
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
      // Loose arc behind / beside the swingset — never between it and the water.
      const a = -1.15 + (2.3 * i) / (TREES_PER_SET - 1) + (r() - 0.5) * 0.22;
      const rad = 9.5 + r() * 5.5;
      const x = spot.x + Math.sin(a) * rad;
      const z = spot.z + Math.cos(a) * rad;
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
        const m = new THREE.Mesh(foliageGeo, leafMat);
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
    setFoliage(tree, leafWiltMat);
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
      setFoliage(tree, leafMat);
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
    setFoliage(tree, leafMat);
    tree.fromScale = Math.max(0.2, tree.tilt.scale.x);
    tree.tilt.scale.setScalar(tree.fromScale);
  }

  function syncHeartTrees(setIndex: number, hearts: number): void {
    const mine = trees.filter((t) => t.setIndex === setIndex);
    const want = clamp(Math.round(hearts), 0, mine.length);

    const alive = mine.filter((t) => t.state === 'alive');
    // Too many living Trees: the farthest-from-water ones fall first.
    if (alive.length > want) {
      alive.sort((a, b) => b.position.z - a.position.z);
      for (let i = 0; i < alive.length - want; i++) fellTree(alive[i], 'heart');
    } else if (alive.length < want) {
      // Hearts refilled: heart-felled Trees stand back up (nearest water first).
      const dead = mine
        .filter((t) => t.fallCause === 'heart' && (t.state === 'fallen' || t.state === 'gone'))
        .sort((a, b) => a.position.z - b.position.z);
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

  function update(dt: number): void {
    time += dt;
    waterTime.value = time;
    updateSwings(dt);
    updateTrees(dt);

    // Drifting clouds.
    for (const c of clouds) {
      c.position.x += dt * 1.1;
      if (c.position.x > 460) c.position.x = -300;
    }

    // Keep the shadow camera over wherever the player is standing.
    const focus = ctx.player ? ctx.player.position : null;
    const fx = focus ? focus.x : 0;
    const fz = focus ? focus.z : SWINGSET_POSITIONS[0].z;
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + sunOffset.x, sunOffset.y, fz + sunOffset.z);
  }

  // --- api -----------------------------------------------------------------

  return {
    swingsets,
    trees,
    groundHeightAt(x: number, z: number): number {
      if (z < 0) return WATER_Y;
      return landHeight(x, z);
    },
    breakSwing,
    repairAllSwings,
    syncHeartTrees,
    fellTree,
    removeFallenTree,
    shipAnchorage(setIndex: number): { x: number; z: number } {
      const spot = SWINGSET_POSITIONS[clamp(setIndex, 0, SWINGSET_POSITIONS.length - 1)];
      return { x: spot.x, z: ANCHORAGE_Z };
    },
    update,
  };
}
