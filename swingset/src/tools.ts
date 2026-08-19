// tools.ts — Tool pickups scattered around the Playground (some up Trees),
// the held item, throws (Boomerang Hammer, thrown Tree, slung cannonball),
// Chainsaw felling, Wrench jamming, Giant Magnet catching.
//
// See CONTEXT.md for vocabulary and types.ts for the contract.

import * as THREE from 'three';
import {
  MAGNET_CATCH_RADIUS,
  SWINGSET_POSITIONS,
  TOOL_DAMAGE,
  WATER_Y,
  WRENCH_JAM_SECONDS,
  type GameCtx,
  type HeldKind,
  type ToolKind,
  type ToolsApi,
  type TreeInfo,
} from './types';
import { noOutline, toonMat } from './toon';

// --- tuning ----------------------------------------------------------------

const PICKUP_RADIUS = 1.3;
const TREE_PICKUP_RADIUS = 1.6;
const LOG_PICKUP_RADIUS = 2.0;
const CHAINSAW_REACH = 2.0;
const CHAINSAW_REV_SECONDS = 0.5;
const HIT_RADIUS = 1.0; // projectile-vs-hull test radius

/** Flight time is derived from distance / speed, so throws land on target. */
const THROW_SPEED: Record<HeldKind, number> = {
  hammer: 34,
  wrench: 28,
  cannonball: 22,
  log: 15,
  chainsaw: 20, // never thrown, kept for completeness
  magnet: 20, // never thrown
};
const THROW_GRAVITY: Record<HeldKind, number> = {
  hammer: 5,
  wrench: 9,
  cannonball: 18,
  log: 13,
  chainsaw: 12,
  magnet: 12,
};
/** Fraction of the throw distance used as random spread (misses happen). */
const THROW_SPREAD = 0.022;

const HAMMER_BACK_SPEED = 30;
const HAMMER_BACK_TIMEOUT = 6;
const HAMMER_CATCH_DIST = 1.4;
const MAX_FLIGHT_SECONDS = 7;

const TOOL_KINDS: ToolKind[] = ['hammer', 'wrench', 'chainsaw', 'magnet'];

// --- scratch (no per-frame allocation) --------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();

// --- shared materials -------------------------------------------------------

const MAT = {
  wood: toonMat({ color: 0xb0763c }),
  bark: toonMat({ color: 0x8a5228 }),
  steel: toonMat({ color: 0x8a94a8 }),
  darkSteel: toonMat({ color: 0x4a5468 }),
  iron: toonMat({ color: 0x2e3442 }),
  orange: toonMat({ color: 0xff8c1a }),
  red: toonMat({ color: 0xe0402e }),
  black: toonMat({ color: 0x20242e }),
};

// --- procedural tool models -------------------------------------------------

function addMesh(
  g: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

function buildHammer(): THREE.Group {
  const g = new THREE.Group();
  addMesh(g, new THREE.CylinderGeometry(0.075, 0.09, 1.0, 8), MAT.wood, 0, 0, 0);
  addMesh(g, new THREE.BoxGeometry(0.46, 0.26, 0.26), MAT.darkSteel, 0, 0.58, 0);
  // Claw on the back side.
  const claw = addMesh(g, new THREE.BoxGeometry(0.18, 0.2, 0.22), MAT.darkSteel, -0.3, 0.5, 0);
  claw.rotation.z = 0.5;
  // Grip wrap.
  addMesh(g, new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8), MAT.black, 0, -0.34, 0);
  return g;
}

function buildWrench(): THREE.Group {
  const g = new THREE.Group();
  addMesh(g, new THREE.BoxGeometry(0.15, 0.9, 0.08), MAT.steel, 0, 0, 0);
  // Open-end jaws at the top: two prongs with a gap.
  const jawL = addMesh(g, new THREE.BoxGeometry(0.11, 0.34, 0.08), MAT.steel, -0.16, 0.56, 0);
  jawL.rotation.z = 0.22;
  const jawR = addMesh(g, new THREE.BoxGeometry(0.11, 0.34, 0.08), MAT.steel, 0.16, 0.56, 0);
  jawR.rotation.z = -0.22;
  addMesh(g, new THREE.BoxGeometry(0.42, 0.12, 0.08), MAT.steel, 0, 0.42, 0);
  // Ring end at the bottom.
  const ring = addMesh(g, new THREE.TorusGeometry(0.17, 0.055, 6, 14), MAT.steel, 0, -0.54, 0);
  ring.rotation.x = Math.PI / 2;
  ring.rotation.y = Math.PI / 2;
  return g;
}

function buildChainsaw(): THREE.Group {
  const g = new THREE.Group();
  addMesh(g, new THREE.BoxGeometry(0.52, 0.4, 0.3), MAT.orange, -0.2, 0, 0);
  addMesh(g, new THREE.BoxGeometry(0.22, 0.24, 0.26), MAT.black, -0.5, 0.06, 0);
  // Blade bar.
  addMesh(g, new THREE.BoxGeometry(0.95, 0.13, 0.07), MAT.steel, 0.55, 0.02, 0);
  addMesh(g, new THREE.BoxGeometry(0.95, 0.05, 0.1), MAT.darkSteel, 0.55, 0.02, 0);
  // Top handle loop.
  const loop = addMesh(g, new THREE.TorusGeometry(0.17, 0.04, 6, 12), MAT.black, -0.2, 0.3, 0);
  loop.rotation.y = Math.PI / 2;
  return g;
}

function buildMagnet(): THREE.Group {
  const g = new THREE.Group();
  // Red horseshoe: a half torus with two silver pole tips.
  const arc = addMesh(
    g,
    new THREE.TorusGeometry(0.36, 0.13, 8, 18, Math.PI),
    MAT.red,
    0,
    0.05,
    0,
  );
  arc.rotation.z = 0;
  addMesh(g, new THREE.CylinderGeometry(0.13, 0.13, 0.3, 8), MAT.steel, -0.36, -0.1, 0);
  addMesh(g, new THREE.CylinderGeometry(0.13, 0.13, 0.3, 8), MAT.steel, 0.36, -0.1, 0);
  return g;
}

function buildLog(): THREE.Group {
  const g = new THREE.Group();
  const trunk = addMesh(g, new THREE.CylinderGeometry(0.32, 0.38, 3.4, 9), MAT.bark, 0, 0, 0);
  trunk.rotation.z = Math.PI / 2;
  addMesh(g, new THREE.CylinderGeometry(0.3, 0.3, 0.06, 9), MAT.wood, 1.7, 0, 0).rotation.z =
    Math.PI / 2;
  const stub = addMesh(g, new THREE.CylinderGeometry(0.08, 0.11, 0.7, 6), MAT.bark, -0.5, 0.3, 0.1);
  stub.rotation.z = 0.5;
  return g;
}

function buildCannonball(): THREE.Group {
  const g = new THREE.Group();
  addMesh(g, new THREE.SphereGeometry(0.34, 12, 10), MAT.iron, 0, 0, 0);
  return g;
}

/** The Magnet with a caught cannonball clamped between its poles. */
function buildMagnetWithBall(): THREE.Group {
  const g = buildMagnet();
  addMesh(g, new THREE.SphereGeometry(0.3, 12, 10), MAT.iron, 0, -0.14, 0);
  return g;
}

function buildKind(kind: HeldKind): THREE.Group {
  switch (kind) {
    case 'hammer':
      return buildHammer();
    case 'wrench':
      return buildWrench();
    case 'chainsaw':
      return buildChainsaw();
    case 'magnet':
      return buildMagnet();
    case 'log':
      return buildLog();
    case 'cannonball':
      return buildCannonball();
  }
}

/** Pose a mesh in the player's hand so it reads at a glance. */
function poseInHand(kind: HeldKind, mesh: THREE.Object3D): void {
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.setScalar(1);
  switch (kind) {
    case 'hammer':
      // Shouldered like an axe: the grip in the hand, the head tipped back and
      // out over the right shoulder. The carry arm (poseGround: shoulder 0.55,
      // elbow 1.0) points the hand's +Y backward, so rotation.x lifts the
      // handle up from there and rotation.z splays it clear of the head.
      mesh.position.set(0.04, 0.24, -0.1);
      mesh.rotation.set(-0.8, 0, -0.55);
      break;
    case 'wrench':
      mesh.position.set(0, 0.25, 0);
      mesh.rotation.z = -0.25;
      break;
    case 'chainsaw':
      mesh.position.set(0.15, 0.1, 0);
      mesh.rotation.z = 0.15;
      break;
    case 'magnet':
      mesh.position.set(0, 0.3, 0);
      mesh.rotation.z = Math.PI; // poles pointing forward/down
      break;
    case 'cannonball':
      mesh.position.set(0, 0.34, 0);
      mesh.rotation.z = Math.PI;
      break;
    case 'log':
      // Big trunk section carried over the shoulder.
      mesh.position.set(-0.1, 0.85, -0.15);
      mesh.rotation.set(0, 0.35, 0.22);
      break;
  }
}

// --- internal records -------------------------------------------------------

interface Pickup {
  kind: HeldKind;
  mesh: THREE.Group;
  basePos: THREE.Vector3;
  phase: number;
  /** Set when the pickup sits at the top of a Tree. */
  tree: TreeInfo | null;
}

interface Projectile {
  kind: HeldKind;
  mesh: THREE.Group;
  vel: THREE.Vector3;
  gravity: number;
  spinX: number;
  spinY: number;
  phase: 'out' | 'back';
  t: number;
}

interface Splash {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  active: boolean;
}

// ---------------------------------------------------------------------------

export function createTools(ctx: GameCtx): ToolsApi {
  const group = new THREE.Group();
  group.name = 'tools';
  ctx.scene.add(group);

  const pickups: Pickup[] = [];
  const projectiles: Projectile[] = [];
  const meshPool = new Map<HeldKind, THREE.Group[]>();

  let held: HeldKind | null = null;
  let heldMesh: THREE.Group | null = null;
  let hammerInFlight = false;
  let revTimer = 0;
  let revTree: TreeInfo | null = null;

  // --- mesh pooling ---------------------------------------------------------

  function takeMesh(kind: HeldKind): THREE.Group {
    const free = meshPool.get(kind);
    const m = free && free.length > 0 ? free.pop()! : buildKind(kind);
    m.visible = true;
    return m;
  }

  function giveMesh(kind: HeldKind, mesh: THREE.Group): void {
    mesh.removeFromParent();
    mesh.visible = false;
    const free = meshPool.get(kind);
    if (free) free.push(mesh);
    else meshPool.set(kind, [mesh]);
  }

  // --- splash / impact puffs ------------------------------------------------

  const splashGeo = new THREE.ConeGeometry(0.55, 1.1, 8, 1, true);
  const splashes: Splash[] = [];
  for (let i = 0; i < 12; i++) {
    const mat = noOutline(new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const mesh = new THREE.Mesh(splashGeo, mat);
    mesh.visible = false;
    group.add(mesh);
    splashes.push({ mesh, t: 0, life: 0.55, active: false });
  }

  function spawnSplash(pos: THREE.Vector3, color: number, scale: number): void {
    let slot: Splash | null = null;
    for (const s of splashes) {
      if (!s.active) {
        slot = s;
        break;
      }
    }
    if (!slot) slot = splashes[0];
    slot.active = true;
    slot.t = 0;
    slot.mesh.visible = true;
    slot.mesh.position.copy(pos);
    slot.mesh.scale.setScalar(scale);
    const mat = slot.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = 0.85;
  }

  function updateSplashes(dt: number): void {
    for (const s of splashes) {
      if (!s.active) continue;
      s.t += dt;
      const k = s.t / s.life;
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.mesh.scale.setScalar(0.6 + k * 1.8);
      s.mesh.position.y += dt * 1.4;
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
    }
  }

  // --- pickups --------------------------------------------------------------

  function clearPickups(): void {
    for (const p of pickups) giveMesh(p.kind, p.mesh);
    pickups.length = 0;
  }

  function addPickup(kind: HeldKind, x: number, y: number, z: number, tree: TreeInfo | null): void {
    const mesh = takeMesh(kind);
    mesh.scale.setScalar(kind === 'log' ? 1 : 1.15); // chunky and readable
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
    group.add(mesh);
    pickups.push({
      kind,
      mesh,
      basePos: new THREE.Vector3(x, y, z),
      phase: Math.random() * Math.PI * 2,
      tree,
    });
  }

  function groundY(x: number, z: number): number {
    const h = ctx.world ? ctx.world.groundHeightAt(x, z) : 0;
    return (Number.isFinite(h) ? h : 0) + 0.75;
  }

  function dropAtFeet(kind: HeldKind): void {
    const p = ctx.player.position;
    // Clear of PICKUP_RADIUS, or the swapped-out Tool is grabbed straight back
    // and the two keep trading places every frame.
    const x = p.x + (Math.random() - 0.5) * 1.2;
    const z = p.z + PICKUP_RADIUS + 0.7 + Math.random() * 0.4;
    addPickup(kind, x, groundY(x, z), z, null);
  }

  /** Scatter Tools across the Playground for a new Run. */
  function scatter(): void {
    clearPickups();

    // A bag that cycles all four kinds so every Tool exists somewhere.
    const bag: ToolKind[] = [];
    let bagAt = 0;
    function nextKind(): ToolKind {
      if (bagAt >= bag.length) {
        const shuffled = TOOL_KINDS.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = shuffled[i];
          shuffled[i] = shuffled[j];
          shuffled[j] = t;
        }
        bag.length = 0;
        bag.push(...shuffled);
        bagAt = 0;
      }
      return bag[bagAt++];
    }

    const sets = ctx.world?.swingsets?.length
      ? ctx.world.swingsets.map((s) => ({ x: s.position.x, z: s.position.z }))
      : SWINGSET_POSITIONS.map((s) => ({ x: s.x, z: s.z }));

    function placeNear(cx: number, cz: number, kind: ToolKind, minR: number, maxR: number): void {
      // Islands are surrounded by sea: resample until the spot is on grass.
      let x = cx;
      let z = cz + minR;
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = minR + Math.random() * (maxR - minR);
        const tx = cx + Math.cos(a) * r;
        const tz = cz + Math.sin(a) * r;
        if (ctx.world.groundHeightAt(tx, tz) > 0.5) {
          x = tx;
          z = tz;
          break;
        }
      }
      addPickup(kind, x, groundY(x, z), z, null);
    }

    // Starting Swingset: a Hammer close by so Round 1 always has a weapon,
    // plus 1–2 more.
    const start = sets[0];
    placeNear(start.x, start.z, 'hammer', 3.5, 5.5);
    const extraStart = 1 + Math.floor(Math.random() * 2); // 2–3 total
    for (let i = 0; i < extraStart; i++) placeNear(start.x, start.z, nextKind(), 6, 12);

    // 1–2 near each other island's Swingset.
    for (let i = 1; i < sets.length; i++) {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) placeNear(sets[i].x, sets[i].z, nextKind(), 5, 12);
    }

    // 1–2 up a Tree — grabbed while climbing to a Lookout.
    const alive = (ctx.world?.trees ?? []).filter((t) => t.state === 'alive');
    if (alive.length > 0) {
      const wanted = Math.min(alive.length, 1 + Math.floor(Math.random() * 2));
      const used = new Set<number>();
      for (let i = 0; i < wanted; i++) {
        let tree: TreeInfo | null = null;
        for (let tries = 0; tries < 8 && !tree; tries++) {
          const cand = alive[Math.floor(Math.random() * alive.length)];
          if (!used.has(cand.id)) tree = cand;
        }
        if (!tree) break;
        used.add(tree.id);
        tree.topPos(_v1);
        addPickup(nextKind(), _v1.x, _v1.y, _v1.z, tree);
      }
    }
  }

  // --- held item ------------------------------------------------------------

  // The held cannonball reads as a ball clamped in the Magnet. It is kept out
  // of the shared pool so a thrown cannonball never reuses it.
  let magnetBallMesh: THREE.Group | null = null;
  function takeMagnetBall(): THREE.Group {
    if (!magnetBallMesh) magnetBallMesh = buildMagnetWithBall();
    magnetBallMesh.visible = true;
    return magnetBallMesh;
  }

  function setHeld(kind: HeldKind | null): void {
    if (held === 'chainsaw' && kind !== 'chainsaw') {
      // The saw left the hand mid-rev: stop the cut (and stop shaking whatever
      // is held next).
      revTree = null;
      revTimer = 0;
    }
    if (heldMesh) {
      if (heldMesh === magnetBallMesh) {
        heldMesh.removeFromParent();
        heldMesh.visible = false;
      } else if (held) {
        giveMesh(held, heldMesh);
      }
      heldMesh = null;
    }
    held = kind;
    if (!kind) return;
    const mesh = kind === 'cannonball' ? takeMagnetBall() : takeMesh(kind);
    poseInHand(kind, mesh);
    const anchor = ctx.player.carryAnchor;
    (anchor ?? group).add(mesh);
    heldMesh = mesh;
  }

  function pickUp(kind: HeldKind): void {
    if (held && held !== 'cannonball') dropAtFeet(held);
    setHeld(kind);
    if (kind === 'hammer' || kind === 'wrench' || kind === 'chainsaw' || kind === 'magnet') {
      ctx.events.emit('toolPickedUp', { tool: kind });
    }
  }

  function updatePickups(dt: number): void {
    const feet = ctx.player.position;
    const climbing = ctx.player.mode === 'climbing' || ctx.player.atLookout;
    let grabbed = -1;

    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i];
      if (p.tree && p.tree.state !== 'alive') {
        // The Tree it sat in came down: the Tool drops to the ground so it
        // does not hang unreachable in mid-air for the rest of the Run.
        p.basePos.y = groundY(p.basePos.x, p.basePos.z);
        p.tree = null;
      }
      p.phase += dt * 2.2;
      p.mesh.position.set(
        p.basePos.x,
        p.basePos.y + Math.sin(p.phase) * 0.14,
        p.basePos.z,
      );
      p.mesh.rotation.y += dt * 0.9;

      if (grabbed >= 0 || hammerInFlight || held === 'cannonball') continue;

      if (p.tree) {
        // Tree-top pickup: only reachable while climbing that Tree.
        if (!climbing || ctx.player.climbingTree !== p.tree) continue;
        if (feet.distanceTo(p.basePos) < TREE_PICKUP_RADIUS) grabbed = i;
      } else {
        _v1.set(p.basePos.x - feet.x, 0, p.basePos.z - feet.z);
        const dy = Math.abs(p.basePos.y - feet.y);
        if (_v1.length() < PICKUP_RADIUS && dy < 2.4) grabbed = i;
      }
    }

    if (grabbed >= 0) {
      const p = pickups[grabbed];
      pickups.splice(grabbed, 1);
      giveMesh(p.kind, p.mesh);
      pickUp(p.kind);
    }
  }

  /** Walking over a fallen Tree picks it up as a throwable log. */
  function updateLogPickup(): void {
    if (hammerInFlight || held === 'log' || held === 'cannonball') return;
    if (ctx.player.mode === 'climbing') return;
    const feet = ctx.player.position;
    for (const tree of ctx.world.trees) {
      if (tree.state !== 'fallen') continue;
      _v1.set(tree.position.x - feet.x, 0, tree.position.z - feet.z);
      if (_v1.length() > LOG_PICKUP_RADIUS + tree.height * 0.35) continue;
      // Close enough to the trunk line: grab it.
      ctx.world.removeFallenTree(tree);
      pickUp('log');
      return;
    }
  }

  // --- throwing -------------------------------------------------------------

  function handWorldPos(out: THREE.Vector3): THREE.Vector3 {
    const anchor = ctx.player.carryAnchor;
    // A detached anchor reports its local position (near the world origin), so
    // fall back to the player rather than throwing from nowhere.
    if (anchor && anchor.parent) anchor.getWorldPosition(out);
    else out.copy(ctx.player.position).setY(ctx.player.position.y + 1.2);
    if (!Number.isFinite(out.x)) out.copy(ctx.player.position);
    return out;
  }

  /** Where the Ship actually is right now (tracks sailing and Treks). */
  function shipAimPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(ctx.ship.aimPoint);
  }

  function launch(kind: HeldKind): void {
    const mesh = takeMesh(kind);
    mesh.scale.setScalar(1);
    handWorldPos(_v1);
    mesh.position.copy(_v1);
    mesh.rotation.set(0, 0, 0);
    group.add(mesh);

    shipAimPoint(_v2);
    // Slight spread so throws can miss.
    const dist = _v1.distanceTo(_v2);
    _v2.x += (Math.random() - 0.5) * dist * THROW_SPREAD * 2;
    _v2.z += (Math.random() - 0.5) * dist * THROW_SPREAD;

    const gravity = THROW_GRAVITY[kind];
    const time = Math.max(0.35, dist / THROW_SPEED[kind]);
    const vel = new THREE.Vector3()
      .subVectors(_v2, _v1)
      .divideScalar(time);
    vel.y += 0.5 * gravity * time;

    projectiles.push({
      kind,
      mesh,
      vel,
      gravity,
      spinX: kind === 'log' ? 3.2 : kind === 'cannonball' ? 2 : 14,
      spinY: kind === 'hammer' ? 18 : kind === 'wrench' ? 12 : 1.5,
      phase: 'out',
      t: 0,
    });
    ctx.events.emit('itemThrown', { kind });
  }

  function surfaceYAt(x: number, z: number): number {
    const h = ctx.world.groundHeightAt(x, z);
    return Math.max(Number.isFinite(h) ? h : 0, WATER_Y);
  }

  function splashAtSurface(p: Projectile, at: THREE.Vector3): void {
    const water = ctx.world.groundHeightAt(at.x, at.z) < WATER_Y;
    spawnSplash(at, water ? 0xbfe6ff : 0xd8c9a8, p.kind === 'log' ? 1.6 : 1.0);
  }

  function onProjectileHitShip(p: Projectile): void {
    spawnSplash(p.mesh.position, 0xffe08a, 1.3);
    switch (p.kind) {
      case 'wrench':
        // ship.jam() owns the 'shipJammed' event.
        ctx.ship.jam(WRENCH_JAM_SECONDS);
        break;
      case 'hammer':
        ctx.ship.damage(TOOL_DAMAGE.hammer, 'hammer');
        break;
      case 'cannonball':
        ctx.ship.damage(TOOL_DAMAGE.cannonball, 'cannonball');
        break;
      case 'log':
        ctx.ship.damage(TOOL_DAMAGE.log, 'log');
        break;
      default:
        break;
    }
    ctx.events.emit('screenShake', { intensity: p.kind === 'log' ? 0.6 : 0.3 });
  }

  function updateProjectiles(dt: number): void {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.t += dt;
      const pos = p.mesh.position;

      if (p.phase === 'back') {
        // Boomerang: curve home to wherever the player is now.
        handWorldPos(_v1);
        _v2.subVectors(_v1, pos);
        const d = _v2.length();
        if (d > 0.0001) _v2.divideScalar(d);
        _v3.copy(_v2).multiplyScalar(HAMMER_BACK_SPEED);
        const k = 1 - Math.exp(-5 * dt);
        p.vel.lerp(_v3, k);
        pos.addScaledVector(p.vel, dt);
        p.mesh.rotation.y += p.spinY * dt;
        p.mesh.rotation.x += p.spinX * dt;
        if (d < HAMMER_CATCH_DIST || p.t > HAMMER_BACK_TIMEOUT) {
          // Caught: back in hand.
          giveMesh(p.kind, p.mesh);
          projectiles.splice(i, 1);
          hammerInFlight = false;
          if (held === 'hammer' && heldMesh) heldMesh.visible = true;
          else if (held === null) setHeld('hammer');
          continue;
        }
        continue;
      }

      p.vel.y -= p.gravity * dt;
      pos.addScaledVector(p.vel, dt);
      p.mesh.rotation.y += p.spinY * dt;
      p.mesh.rotation.x += p.spinX * dt;

      let done = false;
      if (ctx.ship.hitTest(pos, HIT_RADIUS)) {
        onProjectileHitShip(p);
        done = true;
      } else {
        const surface = surfaceYAt(pos.x, pos.z);
        if (pos.y <= surface) {
          _v4.set(pos.x, surface + 0.2, pos.z);
          splashAtSurface(p, _v4);
          done = true;
        } else if (p.t > MAX_FLIGHT_SECONDS) {
          done = true;
        }
      }

      if (!done) continue;

      if (p.kind === 'hammer') {
        // Hit or miss, the Boomerang Hammer always curves back.
        p.phase = 'back';
        p.t = 0;
        p.vel.set(0, 5, 0);
        continue;
      }

      giveMesh(p.kind, p.mesh);
      projectiles.splice(i, 1);
    }
  }

  // --- chainsaw -------------------------------------------------------------

  function nearestAliveTree(maxDist: number): TreeInfo | null {
    const feet = ctx.player.position;
    let best: TreeInfo | null = null;
    let bestD = maxDist;
    for (const tree of ctx.world.trees) {
      if (tree.state !== 'alive') continue;
      _v1.set(tree.position.x - feet.x, 0, tree.position.z - feet.z);
      const d = _v1.length();
      if (d < bestD) {
        bestD = d;
        best = tree;
      }
    }
    return best;
  }

  function updateChainsaw(dt: number): void {
    if (!revTree) return;
    revTimer -= dt;
    if (heldMesh) heldMesh.rotation.z = 0.15 + Math.sin(revTimer * 55) * 0.12;
    if (revTimer > 0) return;
    const tree = revTree;
    revTree = null;
    if (tree.state === 'alive') ctx.world.fellTree(tree, 'chainsaw');
    if (heldMesh) heldMesh.rotation.z = 0.15;
  }

  // --- use / throw ----------------------------------------------------------

  function useHeld(): boolean {
    if (!held) return false;

    switch (held) {
      case 'hammer': {
        if (hammerInFlight) return false;
        hammerInFlight = true;
        if (heldMesh) heldMesh.visible = false;
        launch('hammer');
        return true;
      }
      case 'wrench': {
        launch('wrench');
        setHeld(null); // consumed — it ends up in the sea either way
        return true;
      }
      case 'magnet': {
        const ball = ctx.ship.catchNearestBall(ctx.player.position, MAGNET_CATCH_RADIUS);
        if (!ball) return false;
        ctx.events.emit('ballCaught', {});
        setHeld('cannonball');
        return true;
      }
      case 'cannonball': {
        launch('cannonball');
        setHeld('magnet'); // the Magnet is never lost
        return true;
      }
      case 'log': {
        launch('log');
        setHeld(null);
        return true;
      }
      case 'chainsaw': {
        if (revTree) return false;
        const tree = nearestAliveTree(CHAINSAW_REACH);
        if (!tree) return false;
        revTree = tree;
        revTimer = CHAINSAW_REV_SECONDS;
        ctx.events.emit('chainsawRevved', {});
        return true;
      }
    }
  }

  function reset(): void {
    // Drop anything in flight or in hand and re-scatter the Playground.
    for (const p of projectiles) giveMesh(p.kind, p.mesh);
    projectiles.length = 0;
    hammerInFlight = false;
    revTree = null;
    revTimer = 0;
    setHeld(null);
    for (const s of splashes) {
      s.active = false;
      s.mesh.visible = false;
    }
    scatter();
  }

  function update(dt: number): void {
    updatePickups(dt);
    updateLogPickup();
    updateChainsaw(dt);
    updateProjectiles(dt);
    updateSplashes(dt);
  }

  return {
    get held(): HeldKind | null {
      return held;
    },
    get heldInHand(): boolean {
      return held !== null && heldMesh !== null && heldMesh.visible;
    },
    useHeld,
    reset,
    update,
  };
}
