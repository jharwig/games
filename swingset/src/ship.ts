// ship.ts — the pirate Ship: procedural model, aiming/telegraph/firing,
// cannonball ballistics + collision detection, damage/sinking, trek cruising.
//
// The Ship only *detects* impacts and emits `cannonImpact`; main.ts owns every
// game rule. See CONTEXT.md for vocabulary and types.ts for the contract.

import * as THREE from 'three';
import {
  ARCHIPELAGO_CENTER,
  type BallInfo,
  type GameCtx,
  type HeldKind,
  PLAYER_HIT_RADIUS,
  SHIP_ORBIT,
  SWINGSET_POSITIONS,
  type ShipApi,
  SWING_HIT_RADIUS,
  type SwingInfo,
  shipSpec,
  TREK_FIRE_INTERVAL,
  towardCenter,
  WATER_Y,
} from './types';
import { clamp, damp, wrapAngle } from './util';
import { noOutline, toonMat } from './toon';

// --- tuning -----------------------------------------------------------------

const GRAVITY = 9.8;
const BALL_RADIUS = 0.35;
const BALL_MAX_LIFE = 14;

const AIM_TIME = 0.8; // cannon swings onto the target
const FUSE_TIME = 0.7; // fuse glows/sparks before the boom
const FLIGHT_MIN = 2.2;
const FLIGHT_MAX = 3.0;
const TARGET_SCATTER = 1.5;
const PLAYER_AIM_CHANCE = 0.7;

// Trajectory indicator: every ball in flight draws a dotted arc to its
// landing spot, marked with a pulsing ring. Dots behind the ball shrink away
// so the remaining trail always shows the path still to come.
const TRAJ_DOT_SPACING = 2.6; // metres of arc between dots
const TRAJ_DOT_RADIUS = 0.13;
const TRAJ_MAX_DOTS = 320; // shared cap across all balls in flight
const TRAJ_FADE_TIME = 0.35; // seconds a dot takes to shrink once passed
const TRAJ_COLOR = 0xe0863a; // muted danger orange

const SCORCH_RADIUS = 2.4; // grass wiped out around a ground impact

const SAIL_IN_SECONDS = 6;
const SAIL_IN_DIST = 170; // starts out in the fog beyond the far islands
const MOVE_SPEED = 16; // repositioning between anchorages
const TREK_SPEED = 5.5; // cruising along the shore during a Trek
const SINK_SECONDS = 4;

// Base hull dimensions at scale 1 (metres).
const HULL_LEN = 18;
const HULL_BEAM = 5.2;
const HULL_DEPTH = 3.4;
const DECK_Y = 1.95;

// --- scratch (no per-frame allocations in the hot loop) ---------------------

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpColor = new THREE.Color();

// --- shared procedural textures ---------------------------------------------

function makeTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  draw(c);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function plankTexture(base: string, line: string, rows: number): THREE.Texture {
  return makeTexture(128, 128, (c) => {
    c.fillStyle = base;
    c.fillRect(0, 0, 128, 128);
    // grain
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      c.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`;
      c.fillRect(x, y, 1 + Math.random() * 6, 1);
    }
    // plank seams
    const step = 128 / rows;
    c.fillStyle = line;
    for (let i = 0; i < rows; i++) {
      c.fillRect(0, Math.round(i * step), 128, 1.5);
    }
    // caulking dots
    c.fillStyle = 'rgba(30,20,10,0.5)';
    for (let i = 0; i < rows; i++) {
      for (let x = 6; x < 128; x += 26) c.fillRect(x, Math.round(i * step) + 3, 2, 2);
    }
  });
}

function sailTexture(): THREE.Texture {
  return makeTexture(128, 128, (c) => {
    c.fillStyle = '#f8f2e0';
    c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 320; i++) {
      c.fillStyle = `rgba(140,125,95,${Math.random() * 0.06})`;
      c.fillRect(Math.random() * 128, Math.random() * 128, 3, 2);
    }
    c.strokeStyle = 'rgba(160,145,115,0.4)';
    c.lineWidth = 1;
    for (let x = 16; x < 128; x += 32) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, 128);
      c.stroke();
    }
    // pirate-red band along the head of the sail
    c.fillStyle = '#c83c30';
    c.fillRect(0, 0, 128, 16);
    c.fillStyle = 'rgba(90,20,14,0.5)';
    c.fillRect(0, 15, 128, 2);
  });
}

function flagTexture(): THREE.Texture {
  return makeTexture(64, 64, (c) => {
    c.fillStyle = '#0d0d0f';
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#f2f0e6';
    // crossbones
    c.save();
    c.translate(32, 38);
    for (const a of [0.7, -0.7]) {
      c.save();
      c.rotate(a);
      c.fillRect(-20, -2.5, 40, 5);
      c.beginPath();
      c.arc(-20, 0, 4, 0, Math.PI * 2);
      c.arc(20, 0, 4, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    c.restore();
    // skull
    c.beginPath();
    c.arc(32, 26, 13, 0, Math.PI * 2);
    c.fill();
    c.fillRect(24, 33, 16, 8);
    c.fillStyle = '#0d0d0f';
    c.beginPath();
    c.arc(27, 25, 4, 0, Math.PI * 2);
    c.arc(37, 25, 4, 0, Math.PI * 2);
    c.fill();
    c.fillRect(30, 33, 1.5, 6);
    c.fillRect(33, 33, 1.5, 6);
  });
}

function puffTexture(): THREE.Texture {
  return makeTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
}

// --- pooled particles --------------------------------------------------------

class ParticlePool {
  readonly points: THREE.Points;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private vel: Float32Array;
  private base: Float32Array;
  private life: Float32Array;
  private ttl: Float32Array;
  private cursor = 0;
  private cap: number;
  private gravity: number;
  private fade: THREE.Color;

  constructor(
    cap: number,
    size: number,
    gravity: number,
    fade: THREE.Color,
    blending: THREE.Blending,
    tex: THREE.Texture,
  ) {
    this.cap = cap;
    this.gravity = gravity;
    this.fade = fade;
    this.vel = new Float32Array(cap * 3);
    this.base = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.ttl = new Float32Array(cap);
    const pos = new Float32Array(cap * 3);
    const col = new Float32Array(cap * 3);
    for (let i = 0; i < cap; i++) pos[i * 3 + 1] = -10000;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.colAttr = new THREE.BufferAttribute(col, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.PointsMaterial({
      size,
      map: tex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  burst(
    at: THREE.Vector3,
    count: number,
    speed: number,
    life: number,
    color: number,
    upBias = 0,
    spread = 1,
  ): void {
    tmpColor.setHex(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      const i3 = i * 3;
      const p = this.posAttr.array as Float32Array;
      p[i3] = at.x + (Math.random() - 0.5) * 0.3;
      p[i3 + 1] = at.y + (Math.random() - 0.5) * 0.3;
      p[i3 + 2] = at.z + (Math.random() - 0.5) * 0.3;
      const s = speed * (0.4 + Math.random() * 0.9);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - 2 * Math.random());
      this.vel[i3] = Math.sin(phi) * Math.cos(theta) * s * spread;
      this.vel[i3 + 1] = Math.cos(phi) * s * spread + upBias;
      this.vel[i3 + 2] = Math.sin(phi) * Math.sin(theta) * s * spread;
      const t = life * (0.7 + Math.random() * 0.6);
      this.life[i] = t;
      this.ttl[i] = t;
      const j = Math.random() * 0.25 + 0.87;
      this.base[i3] = tmpColor.r * j;
      this.base[i3 + 1] = tmpColor.g * j;
      this.base[i3 + 2] = tmpColor.b * j;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  update(dt: number): void {
    const p = this.posAttr.array as Float32Array;
    const c = this.colAttr.array as Float32Array;
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      const i3 = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        p[i3 + 1] = -10000;
        c[i3] = c[i3 + 1] = c[i3 + 2] = 0;
        continue;
      }
      this.vel[i3 + 1] -= this.gravity * dt;
      const drag = 1 - Math.min(0.9, 1.2 * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;
      p[i3] += this.vel[i3] * dt;
      p[i3 + 1] += this.vel[i3 + 1] * dt;
      p[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.life[i] / this.ttl[i];
      c[i3] = this.fade.r + (this.base[i3] - this.fade.r) * t;
      c[i3 + 1] = this.fade.g + (this.base[i3 + 1] - this.fade.g) * t;
      c[i3 + 2] = this.fade.b + (this.base[i3 + 2] - this.fade.b) * t;
    }
    if (any) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
    }
  }
}

// --- model -------------------------------------------------------------------

interface CannonNode {
  yaw: THREE.Object3D;
  pitch: THREE.Object3D;
  muzzle: THREE.Object3D;
  glow: THREE.Mesh;
  /** Seconds until the next phase change. */
  timer: number;
  phase: 'wait' | 'aim' | 'fuse';
  target: THREE.Vector3;
  targetSwing: SwingInfo | null;
  wantYaw: number;
  wantPitch: number;
  sputter: number;
}

interface ShipModel {
  root: THREE.Group; // position + heading
  bob: THREE.Group; // wave bob/roll/pitch
  body: THREE.Group; // the scaled model itself
  cannons: CannonNode[];
  flag: THREE.Object3D;
  sails: THREE.Object3D[];
  hullMats: THREE.MeshToonMaterial[];
  halfLen: number;
  halfBeam: number;
}

function hullShape(len: number, beam: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(len * 0.5, 0);
  s.bezierCurveTo(len * 0.3, beam * 0.4, len * 0.06, beam * 0.5, -len * 0.3, beam * 0.47);
  s.lineTo(-len * 0.5, beam * 0.36);
  s.lineTo(-len * 0.5, -beam * 0.36);
  s.lineTo(-len * 0.3, -beam * 0.47);
  s.bezierCurveTo(len * 0.06, -beam * 0.5, len * 0.3, -beam * 0.4, len * 0.5, 0);
  return s;
}

function billowedSail(w: number, h: number, bulge: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, h, 8, 5);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = Math.cos((x / w) * Math.PI);
    const v = Math.cos((y / h) * Math.PI) * 0.5 + 0.6;
    pos.setZ(i, u * v * bulge);
  }
  geo.computeVertexNormals();
  // Sails hang across the beam: normal along +X (fore/aft).
  geo.rotateY(Math.PI / 2);
  return geo;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

// ----------------------------------------------------------------------------

interface Ball extends BallInfo {
  mesh: THREE.Mesh;
  life: number;
  age: number;
  trajTimes: number[]; // flight time at which the ball reaches each dot
  trajPts: THREE.Vector3[];
  ring: THREE.Mesh | null; // landing ring, returned to its pool on free
}

type Phase = 'hidden' | 'sailIn' | 'anchored' | 'moving' | 'trek' | 'sinking' | 'sunk';

export function createShip(ctx: GameCtx): ShipApi {
  // Shared assets (built once, never disposed).
  const texHull = plankTexture('#8a5a32', 'rgba(50,30,14,0.7)', 9);
  texHull.repeat.set(2.2, 1.6);
  const texDeck = plankTexture('#a87c50', 'rgba(70,46,24,0.55)', 14);
  texDeck.repeat.set(3, 3);
  const texSail = sailTexture();
  const texFlag = flagTexture();
  const texPuff = puffTexture();

  const smoke = new ParticlePool(260, 1.5, -0.4, new THREE.Color(0xe4f2f8), THREE.NormalBlending, texPuff);
  const debris = new ParticlePool(300, 0.42, 12, new THREE.Color(0x2a1a0c), THREE.NormalBlending, texPuff);
  const sparks = new ParticlePool(160, 0.3, 6, new THREE.Color(0x100800), THREE.AdditiveBlending, texPuff);
  const splash = new ParticlePool(220, 0.55, 11, new THREE.Color(0xa8c8dc), THREE.NormalBlending, texPuff);
  const pools = [smoke, debris, sparks, splash];
  for (const p of pools) ctx.scene.add(p.points);

  // Muzzle flashes.
  const flashMat = new THREE.SpriteMaterial({
    map: texPuff,
    color: 0xffcf72,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flashes: THREE.Sprite[] = [];
  const flashLife: number[] = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(flashMat.clone());
    s.visible = false;
    s.renderOrder = 4;
    ctx.scene.add(s);
    flashes.push(s);
    flashLife.push(0);
  }
  let flashCursor = 0;

  // Ground scorch decals.
  const decalGeo = new THREE.CircleGeometry(1, 18);
  decalGeo.rotateX(-Math.PI / 2);
  const decals: THREE.Mesh[] = [];
  const decalLife: number[] = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(
      decalGeo,
      noOutline(
        new THREE.MeshBasicMaterial({
          color: 0x2b1d0f,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      ),
    );
    m.visible = false;
    m.renderOrder = 1;
    ctx.scene.add(m);
    decals.push(m);
    decalLife.push(0);
  }
  let decalCursor = 0;

  // Cannonballs.
  const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 12, 10);
  const ballMat = toonMat({ color: 0x23262e });
  const ballPool: THREE.Mesh[] = [];
  const balls: Ball[] = [];
  let nextBallId = 1;

  // Trajectory indicator: one InstancedMesh of dots shared by every ball in
  // flight (tiny spheres read as a dotted ink line and never shimmer the way
  // a dashed line material does under a moving camera).
  const trajGeo = new THREE.SphereGeometry(TRAJ_DOT_RADIUS, 8, 6);
  const trajMat = noOutline(
    new THREE.MeshBasicMaterial({
      color: TRAJ_COLOR,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  const trajDots = new THREE.InstancedMesh(trajGeo, trajMat, TRAJ_MAX_DOTS);
  trajDots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trajDots.frustumCulled = false;
  trajDots.count = 0;
  ctx.scene.add(trajDots);
  const trajMat4 = new THREE.Matrix4();

  // Landing rings (pooled; one per ball in flight).
  const ringGeo = new THREE.RingGeometry(0.78, 1.05, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = noOutline(
    new THREE.MeshBasicMaterial({
      color: TRAJ_COLOR,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  const ringPool: THREE.Mesh[] = [];

  function takeRing(): THREE.Mesh {
    const m = ringPool.pop() ?? new THREE.Mesh(ringGeo, ringMat);
    m.renderOrder = 1;
    m.visible = true;
    ctx.scene.add(m);
    return m;
  }

  function takeBallMesh(): THREE.Mesh {
    const m = ballPool.pop() ?? new THREE.Mesh(ballGeo, ballMat);
    m.castShadow = true;
    m.visible = true;
    ctx.scene.add(m);
    return m;
  }
  function freeBall(b: Ball): void {
    b.mesh.visible = false;
    ctx.scene.remove(b.mesh);
    ballPool.push(b.mesh);
    if (b.ring) {
      b.ring.visible = false;
      ctx.scene.remove(b.ring);
      ringPool.push(b.ring);
      b.ring = null;
    }
  }
  function clearBalls(): void {
    for (const b of balls) freeBall(b);
    balls.length = 0;
  }

  // --- model construction ---------------------------------------------------

  let model: ShipModel | null = null;

  function buildModel(cannonCount: number, scale: number): ShipModel {
    const root = new THREE.Group();
    const bob = new THREE.Group();
    const body = new THREE.Group();
    root.add(bob);
    bob.add(body);
    body.scale.setScalar(scale);

    const hullMats: THREE.MeshToonMaterial[] = [];
    const woodMat = toonMat({ map: texHull, color: 0xffffff });
    const deckMat = toonMat({ map: texDeck, color: 0xffffff });
    const trimMat = toonMat({ color: 0x4a3320 });
    const accentMat = toonMat({ color: 0xc83c30 }); // pirate-red rails + roof
    const ironMat = toonMat({ color: 0x23283a });
    hullMats.push(woodMat, deckMat, trimMat, accentMat);

    const shape = hullShape(HULL_LEN, HULL_BEAM);
    const hullGeo = new THREE.ExtrudeGeometry(shape, {
      depth: HULL_DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.5,
      bevelSize: 0.5,
      bevelSegments: 2,
      curveSegments: 10,
    });
    hullGeo.rotateX(-Math.PI / 2);
    hullGeo.translate(0, -2.0, 0);
    const hull = new THREE.Mesh(hullGeo, woodMat);
    hull.castShadow = true;
    body.add(hull);

    // Deck.
    const deckGeo = new THREE.ShapeGeometry(shape, 10);
    deckGeo.rotateX(-Math.PI / 2);
    deckGeo.scale(0.93, 1, 0.93);
    deckGeo.translate(0, DECK_Y, 0);
    body.add(new THREE.Mesh(deckGeo, deckMat));

    // Gunwales along both sides.
    for (const side of [1, -1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(HULL_LEN * 0.78, 0.55, 0.2),
        accentMat,
      );
      rail.position.set(-HULL_LEN * 0.02, DECK_Y + 0.25, side * HULL_BEAM * 0.44);
      body.add(rail);
    }

    // Stern castle + a little cabin roof.
    const castle = new THREE.Mesh(
      new THREE.BoxGeometry(HULL_LEN * 0.2, 1.3, HULL_BEAM * 0.72),
      woodMat,
    );
    castle.position.set(-HULL_LEN * 0.36, DECK_Y + 0.65, 0);
    castle.castShadow = true;
    body.add(castle);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(HULL_LEN * 0.22, 0.16, HULL_BEAM * 0.78),
      accentMat,
    );
    roof.position.set(-HULL_LEN * 0.36, DECK_Y + 1.38, 0);
    body.add(roof);

    // Bowsprit.
    const sprit = new THREE.Group();
    sprit.position.set(HULL_LEN * 0.47, DECK_Y + 0.35, 0);
    sprit.rotation.z = -Math.PI / 2 + 0.3;
    const spritMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 4.4, 7), trimMat);
    spritMesh.position.y = 2.2;
    sprit.add(spritMesh);
    body.add(sprit);

    // Masts + sails.
    const sails: THREE.Object3D[] = [];
    const sailMat = toonMat({
      map: texSail,
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    hullMats.push(sailMat);
    const mastSpecs = [
      { x: HULL_LEN * 0.16, h: 11.5, sailW: HULL_BEAM * 1.45, sailH: 5.2 },
      { x: -HULL_LEN * 0.16, h: 13.5, sailW: HULL_BEAM * 1.7, sailH: 6.2 },
    ];
    const mastTops: THREE.Vector3[] = [];
    for (const spec of mastSpecs) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, spec.h, 8), trimMat);
      mast.position.set(spec.x, DECK_Y + spec.h / 2, 0);
      mast.castShadow = true;
      body.add(mast);
      mastTops.push(new THREE.Vector3(spec.x, DECK_Y + spec.h, 0));

      const yardY = DECK_Y + spec.h * 0.72;
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, spec.sailW * 1.06, 6), trimMat);
      yard.rotation.x = Math.PI / 2;
      yard.position.set(spec.x, yardY, 0);
      body.add(yard);

      const sail = new THREE.Mesh(billowedSail(spec.sailW, spec.sailH, 0.55), sailMat);
      sail.position.set(spec.x, yardY - spec.sailH / 2, 0);
      sail.castShadow = true;
      body.add(sail);
      sails.push(sail);

      // Small topsail.
      const topY = DECK_Y + spec.h * 0.93;
      const topSail = new THREE.Mesh(billowedSail(spec.sailW * 0.6, spec.sailH * 0.42, 0.35), sailMat);
      topSail.position.set(spec.x, topY - spec.sailH * 0.24, 0);
      body.add(topSail);
      sails.push(topSail);
    }

    // Rigging hints.
    const lines: number[] = [];
    const spritTip = new THREE.Vector3(
      HULL_LEN * 0.47 + 4.2 * Math.cos(0.3),
      DECK_Y + 0.35 + 4.2 * Math.sin(0.3),
      0,
    );
    for (const top of mastTops) {
      lines.push(top.x, top.y, top.z, spritTip.x, spritTip.y, spritTip.z);
      lines.push(top.x, top.y, top.z, -HULL_LEN * 0.46, DECK_Y + 1.5, 0);
      for (const side of [1, -1]) {
        for (const f of [0.25, 0.55, 0.85]) {
          lines.push(
            top.x, top.y, top.z,
            top.x + (f - 0.55) * 4, DECK_Y + 0.3, side * HULL_BEAM * 0.42,
          );
        }
      }
    }
    if (mastTops.length === 2) {
      lines.push(
        mastTops[0].x, mastTops[0].y, 0,
        mastTops[1].x, mastTops[1].y, 0,
      );
    }
    const rigGeo = new THREE.BufferGeometry();
    rigGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const rigMat = new THREE.LineBasicMaterial({ color: 0x2b2318, transparent: true, opacity: 0.8 });
    body.add(new THREE.LineSegments(rigGeo, rigMat));

    // Black pirate flag on the tall mast.
    const tall = mastTops[1] ?? mastTops[0];
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.15),
      noOutline(
        new THREE.MeshBasicMaterial({ map: texFlag, side: THREE.DoubleSide, transparent: true }),
      ),
    );
    flag.position.set(tall.x + 0.9, tall.y - 0.9, 0);
    body.add(flag);

    // Cannons on the SHORE-FACING (+Z) side.
    const cannons: CannonNode[] = [];
    const glowMat = noOutline(new THREE.MeshBasicMaterial({ color: 0xffb020 }));
    for (let i = 0; i < cannonCount; i++) {
      const t = cannonCount === 1 ? 0.5 : i / (cannonCount - 1);
      const x = -HULL_LEN * 0.24 + t * HULL_LEN * 0.5;
      const yaw = new THREE.Group();
      yaw.position.set(x, DECK_Y + 0.32, HULL_BEAM * 0.4);
      body.add(yaw);

      const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 1.0), trimMat);
      carriage.position.y = -0.2;
      yaw.add(carriage);
      for (const s of [-1, 1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 8), ironMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(s * 0.42, -0.34, 0.25);
        yaw.add(wheel);
      }

      const pitch = new THREE.Group();
      yaw.add(pitch);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.27, 1.7, 10), ironMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 0.55;
      barrel.castShadow = true;
      pitch.add(barrel);
      const breech = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), ironMat);
      breech.position.z = -0.25;
      pitch.add(breech);

      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0, 1.55);
      pitch.add(muzzle);

      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), glowMat);
      glow.position.set(0, 0.24, -0.3);
      glow.visible = false;
      pitch.add(glow);

      cannons.push({
        yaw,
        pitch,
        muzzle,
        glow,
        timer: 0,
        phase: 'wait',
        target: new THREE.Vector3(),
        targetSwing: null,
        wantYaw: 0,
        wantPitch: -0.35,
        sputter: 0,
      });
    }

    // White foam ring hugging the hull at the waterline (Wind Waker style).
    const foamGeo = new THREE.TorusGeometry(1, 0.14, 5, 28);
    foamGeo.rotateX(Math.PI / 2);
    const foam = new THREE.Mesh(
      foamGeo,
      noOutline(
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        }),
      ),
    );
    foam.scale.set(HULL_LEN * 0.60 * scale, 0.5, HULL_BEAM * 0.95 * scale);
    foam.position.y = 0.12;
    foam.renderOrder = 2;
    bob.add(foam);

    root.position.y = WATER_Y;
    ctx.scene.add(root);
    return {
      root,
      bob,
      body,
      cannons,
      flag,
      sails,
      hullMats,
      halfLen: HULL_LEN * 0.5,
      halfBeam: HULL_BEAM * 0.5,
    };
  }

  function destroyModel(): void {
    if (!model) return;
    ctx.scene.remove(model.root);
    disposeTree(model.root);
    model = null;
  }

  // --- state ----------------------------------------------------------------

  let spec = shipSpec(1);
  let hp = spec.maxHp;
  let maxHp = spec.maxHp;
  let scale = spec.scale;
  let phase: Phase = 'hidden';
  let jammedFor = 0;
  let sunk = false;
  let sinkT = 0;
  let hitFlash = 0;
  let clock = 0;
  let sailInT = 0;
  const sailFrom = new THREE.Vector3();
  const anchor = new THREE.Vector2(0, -22);
  let trek = false;
  let jamPuffT = 0;

  function fireInterval(): number {
    return phase === 'trek' ? TREK_FIRE_INTERVAL : spec.fireInterval;
  }

  function resetCannonTimers(): void {
    if (!model) return;
    const n = model.cannons.length;
    const iv = fireInterval();
    for (let i = 0; i < n; i++) {
      const c = model.cannons[i];
      c.phase = 'wait';
      c.timer = 0.9 + (iv * i) / n;
      c.glow.visible = false;
      c.targetSwing = null;
    }
  }

  // --- targeting ------------------------------------------------------------

  function intactSwingAtPlayerSet(): SwingInfo | null {
    const sets = ctx.world.swingsets;
    const set = sets[ctx.player.currentSetIndex] ?? sets[0];
    if (!set) return null;
    let count = 0;
    for (const s of set.swings) if (!s.broken) count++;
    if (count === 0) return null;
    let pick = Math.floor(Math.random() * count);
    for (const s of set.swings) {
      if (s.broken) continue;
      if (pick === 0) return s;
      pick--;
    }
    return null;
  }

  function pickTarget(c: CannonNode): void {
    const p = ctx.player;
    let swing: SwingInfo | null = null;
    if (Math.random() < PLAYER_AIM_CHANCE) {
      if (p.ridingSwing && !p.ridingSwing.broken) {
        // Aim where the seat *rests* — swing high and the ball passes under.
        swing = p.ridingSwing;
        c.target.copy(swing.restSeatPos);
      } else {
        c.target.copy(p.position);
        c.target.y += 0.9;
      }
    } else {
      swing = intactSwingAtPlayerSet();
      if (swing) c.target.copy(swing.restSeatPos);
      else {
        c.target.copy(p.position);
        c.target.y += 0.9;
      }
    }
    c.target.x += (Math.random() - 0.5) * 2 * TARGET_SCATTER;
    c.target.z += (Math.random() - 0.5) * 2 * TARGET_SCATTER;
    c.targetSwing = swing;
  }

  function aimAt(c: CannonNode): void {
    if (!model) return;
    // Desired direction expressed in the cannon's parent (body) space.
    tmpA.copy(c.target);
    model.body.worldToLocal(tmpA);
    tmpA.sub(c.yaw.position);
    // Loft the aim a little so the barrel points along the launch arc.
    tmpA.y += tmpA.length() * 0.28;
    const len = tmpA.length() || 1;
    c.wantYaw = Math.atan2(tmpA.x, tmpA.z);
    c.wantPitch = -Math.asin(clamp(tmpA.y / len, -1, 1));
  }

  // --- firing ---------------------------------------------------------------

  function spawnFlash(at: THREE.Vector3, size: number): void {
    const s = flashes[flashCursor];
    flashLife[flashCursor] = 0.13;
    flashCursor = (flashCursor + 1) % flashes.length;
    s.position.copy(at);
    s.scale.setScalar(size);
    s.visible = true;
    (s.material as THREE.SpriteMaterial).opacity = 1;
  }

  function fire(c: CannonNode): void {
    if (!model) return;
    c.muzzle.getWorldPosition(tmpB);
    const from = tmpB;
    const T = FLIGHT_MIN + Math.random() * (FLIGHT_MAX - FLIGHT_MIN);
    const mesh = takeBallMesh();
    mesh.position.copy(from);
    const ball: Ball = {
      id: nextBallId++,
      pos: from.clone(),
      vel: new THREE.Vector3(
        (c.target.x - from.x) / T,
        (c.target.y - from.y) / T + 0.5 * GRAVITY * T,
        (c.target.z - from.z) / T,
      ),
      mesh,
      life: BALL_MAX_LIFE,
      age: 0,
      trajTimes: [],
      trajPts: [],
      ring: null,
    };
    computeTrajectory(ball);
    balls.push(ball);

    // Muzzle flash + smoke.
    spawnFlash(from, 2.2 * scale);
    smoke.burst(from, 14, 2.6, 1.5, 0xd8d2c6, 0.8, 1);
    sparks.burst(from, 10, 6, 0.35, 0xffb244, 0.5, 1);
    ctx.events.emit('cannonFire', { ball, targetSwing: c.targetSwing });
  }

  /** Sample the ball's analytic arc: a dot every TRAJ_DOT_SPACING metres, and
   *  the landing ring where the path first meets ground or water. Uses the
   *  same surface rule as the collision code, so the indicator is honest. */
  function computeTrajectory(b: Ball): void {
    const step = 0.03;
    let px = b.pos.x;
    let py = b.pos.y;
    let pz = b.pos.z;
    let since = TRAJ_DOT_SPACING * 0.4; // first dot clears the muzzle smoke
    for (let t = step; t < BALL_MAX_LIFE; t += step) {
      const nx = b.pos.x + b.vel.x * t;
      const ny = b.pos.y + b.vel.y * t - 0.5 * GRAVITY * t * t;
      const nz = b.pos.z + b.vel.z * t;
      since += Math.hypot(nx - px, ny - py, nz - pz);
      px = nx;
      py = ny;
      pz = nz;
      const surfaceY = Math.max(ctx.world.groundHeightAt(nx, nz), WATER_Y);
      if (ny <= surfaceY + BALL_RADIUS) {
        const ring = takeRing();
        ring.position.set(nx, surfaceY + 0.05, nz);
        b.ring = ring;
        return;
      }
      if (since >= TRAJ_DOT_SPACING) {
        since = 0;
        b.trajTimes.push(t);
        b.trajPts.push(new THREE.Vector3(nx, ny, nz));
      }
    }
  }

  /** Redraw the shared dot mesh and pulse the landing rings. Dots the ball
   *  has already passed shrink away over TRAJ_FADE_TIME. */
  function updateTrajectories(): void {
    let n = 0;
    for (const b of balls) {
      for (let k = 0; k < b.trajTimes.length && n < TRAJ_MAX_DOTS; k++) {
        const s = clamp(1 + (b.trajTimes[k] - b.age) / TRAJ_FADE_TIME, 0, 1);
        if (s <= 0) continue;
        const p = b.trajPts[k];
        trajMat4.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
        trajDots.setMatrixAt(n++, trajMat4);
      }
      if (b.ring) b.ring.scale.setScalar(1 + Math.sin(clock * 9) * 0.12);
    }
    trajDots.count = n;
    trajDots.instanceMatrix.needsUpdate = true;
  }

  // --- ball simulation ------------------------------------------------------

  function groundBurst(at: THREE.Vector3): void {
    // The blast tears the turf out: earth, sod clods, and uprooted grass.
    debris.burst(at, 34, 7.5, 0.95, 0x6b4b2a, 5, 1);
    debris.burst(at, 20, 6.5, 0.9, 0x4e7a2b, 4.5, 1.1);
    debris.burst(at, 10, 5.5, 0.8, 0x38571f, 3.5, 1.3);
    smoke.burst(at, 16, 3, 1.6, 0xa89880, 1.8, 1);
    ctx.world.scorchGrassAt(at.x, at.z, SCORCH_RADIUS);
    const d = decals[decalCursor];
    decalLife[decalCursor] = 6;
    decalCursor = (decalCursor + 1) % decals.length;
    d.position.set(at.x, ctx.world.groundHeightAt(at.x, at.z) + 0.04, at.z);
    d.scale.setScalar(1.7 + Math.random() * 0.7);
    d.visible = true;
    (d.material as THREE.MeshBasicMaterial).opacity = 0.6;
  }

  function waterSplash(at: THREE.Vector3): void {
    tmpD.set(at.x, WATER_Y + 0.1, at.z);
    splash.burst(tmpD, 22, 5.5, 0.9, 0xdbeaf4, 5, 0.7);
    smoke.burst(tmpD, 6, 1.6, 1.1, 0xe8f2f8, 1.2, 1);
  }

  function impact(pos: THREE.Vector3, kind: 'water' | 'ground' | 'swing' | 'player', swing?: SwingInfo): void {
    if (kind === 'ground') groundBurst(pos);
    else if (kind === 'water') waterSplash(pos);
    else {
      debris.burst(pos, 16, 5, 0.7, 0x8a6a44, 2, 1);
      smoke.burst(pos, 6, 2, 0.9, 0xc9bfae, 1, 1);
    }
    ctx.events.emit('cannonImpact', { pos: pos.clone(), kind, swing });
  }

  function ballHitsSwing(b: Ball): SwingInfo | null {
    const r2 = SWING_HIT_RADIUS * SWING_HIT_RADIUS;
    for (const set of ctx.world.swingsets) {
      const dx = set.position.x - b.pos.x;
      const dz = set.position.z - b.pos.z;
      if (dx * dx + dz * dz > 900) continue; // >30m away — skip the set
      for (const s of set.swings) {
        if (s.broken) continue;
        s.seatWorldPos(tmpA);
        if (tmpA.distanceToSquared(b.pos) < r2) return s;
      }
    }
    return null;
  }

  function updateBalls(dt: number): void {
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.vel.y -= GRAVITY * dt;
      b.pos.x += b.vel.x * dt;
      b.pos.y += b.vel.y * dt;
      b.pos.z += b.vel.z * dt;
      b.mesh.position.copy(b.pos);
      b.life -= dt;
      b.age += dt;

      let hit: 'water' | 'ground' | 'swing' | 'player' | null = null;
      let hitSwing: SwingInfo | undefined;

      // (a) direct hit on the player (torso, ~0.7m above the feet)
      tmpA.copy(ctx.player.position);
      tmpA.y += 0.7;
      if (tmpA.distanceToSquared(b.pos) < PLAYER_HIT_RADIUS * PLAYER_HIT_RADIUS) {
        hit = 'player';
      }
      // (b) a swing seat where it *currently* hangs
      if (!hit) {
        const s = ballHitsSwing(b);
        if (s) {
          hit = 'swing';
          hitSwing = s;
        }
      }
      // (c) ground — only where an island actually stands above the water;
      // the beach shelves under the sea and that fringe is surf, not ground.
      const surfaceY = ctx.world.groundHeightAt(b.pos.x, b.pos.z);
      if (!hit && surfaceY >= WATER_Y && b.pos.y <= surfaceY + BALL_RADIUS) {
        hit = 'ground';
      }
      // (d) water — open sea and the shallows
      if (!hit && b.pos.y <= WATER_Y + BALL_RADIUS) {
        hit = 'water';
      }

      if (!hit && (b.life <= 0 || b.pos.y < -40)) {
        freeBall(b);
        balls.splice(i, 1);
        continue;
      }
      if (hit) {
        impact(b.pos, hit, hitSwing);
        freeBall(b);
        balls.splice(i, 1);
      }
    }
  }

  // --- movement -------------------------------------------------------------

  function setAnchorFromSet(setIndex: number): void {
    const a = ctx.world.shipAnchorage(setIndex);
    anchor.set(a.x, a.z);
  }

  function moveToward(dt: number, speed: number): boolean {
    if (!model) return true;
    const p = model.root.position;
    const dx = anchor.x - p.x;
    const dz = anchor.y - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) return true;
    const step = Math.min(d, speed * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    return false;
  }

  // --- lifecycle ------------------------------------------------------------

  function startRound(r: number, setIndex: number): void {
    spec = shipSpec(r);
    maxHp = spec.maxHp;
    hp = maxHp;
    scale = spec.scale;
    sunk = false;
    sinkT = 0;
    jammedFor = 0;
    trek = false;
    hitFlash = 0;
    clearBalls();
    destroyModel();
    model = buildModel(spec.cannons, scale);
    setAnchorFromSet(setIndex);
    // Sail in out of the fog on the far side of the archipelago.
    const f = towardCenter(setIndex);
    sailFrom.set(
      ARCHIPELAGO_CENTER.x + f.x * SAIL_IN_DIST,
      WATER_Y,
      ARCHIPELAGO_CENTER.z + f.z * SAIL_IN_DIST,
    );
    model.root.position.copy(sailFrom);
    sailInT = 0;
    phase = 'sailIn';
    resetCannonTimers();
  }

  function beginSinking(): void {
    phase = 'sinking';
    sinkT = 0;
    clearBalls();
    if (model) {
      for (const c of model.cannons) {
        c.glow.visible = false;
        c.phase = 'wait';
      }
      model.root.getWorldPosition(tmpA);
      debris.burst(tmpA, 40, 7, 1.4, 0x7a5630, 4, 1.6);
      smoke.burst(tmpA, 26, 3, 2.4, 0x9a9488, 2, 2);
    }
  }

  // --- per-frame ------------------------------------------------------------

  function updateCannons(dt: number): void {
    if (!model) return;
    const canFire =
      (phase === 'anchored' || phase === 'trek') &&
      !sunk &&
      jammedFor <= 0 &&
      ctx.screen === 'playing';
    const iv = fireInterval();

    for (const c of model.cannons) {
      if (!canFire) {
        // Ease back to a neutral, slightly raised pose.
        c.yaw.rotation.y = damp(c.yaw.rotation.y, 0, 3, dt);
        c.pitch.rotation.x = damp(c.pitch.rotation.x, -0.15, 3, dt);
        if (c.phase === 'fuse') c.glow.visible = false;
        continue;
      }
      switch (c.phase) {
        case 'wait':
          c.timer -= dt;
          if (c.timer <= 0) {
            pickTarget(c);
            c.phase = 'aim';
            c.timer = AIM_TIME;
          }
          break;
        case 'aim':
          c.timer -= dt;
          aimAt(c);
          if (c.timer <= 0) {
            c.phase = 'fuse';
            c.timer = FUSE_TIME;
            c.glow.visible = true;
          }
          break;
        case 'fuse':
          c.timer -= dt;
          c.glow.scale.setScalar(1 + Math.sin(clock * 30) * 0.35);
          if (Math.random() < dt * 14) {
            c.glow.getWorldPosition(tmpA);
            sparks.burst(tmpA, 2, 2.2, 0.3, 0xffd27a, 0.6, 1);
          }
          if (c.timer <= 0) {
            c.glow.visible = false;
            fire(c);
            c.phase = 'wait';
            c.timer = Math.max(0.3, iv - AIM_TIME - FUSE_TIME);
          }
          break;
      }
      if (c.phase !== 'wait') {
        c.yaw.rotation.y = damp(c.yaw.rotation.y, c.wantYaw, 6, dt);
        c.pitch.rotation.x = damp(c.pitch.rotation.x, c.wantPitch, 6, dt);
      }
    }
  }

  function updateJamPuffs(dt: number): void {
    if (!model || jammedFor <= 0) return;
    jamPuffT -= dt;
    if (jamPuffT > 0) return;
    jamPuffT = 0.28;
    for (const c of model.cannons) {
      c.sputter = 1;
      c.muzzle.getWorldPosition(tmpA);
      smoke.burst(tmpA, 4, 1.4, 1.1, 0x8f8d88, 1.1, 0.7);
      sparks.burst(tmpA, 2, 1.5, 0.25, 0xff8a3c, 0.4, 1);
    }
  }

  function updateFx(dt: number): void {
    for (const p of pools) p.update(dt);
    for (let i = 0; i < flashes.length; i++) {
      if (flashLife[i] <= 0) continue;
      flashLife[i] -= dt;
      const s = flashes[i];
      const m = s.material as THREE.SpriteMaterial;
      if (flashLife[i] <= 0) {
        s.visible = false;
        continue;
      }
      m.opacity = flashLife[i] / 0.13;
      s.scale.multiplyScalar(1 + dt * 3);
    }
    for (let i = 0; i < decals.length; i++) {
      if (decalLife[i] <= 0) continue;
      decalLife[i] -= dt;
      const d = decals[i];
      const m = d.material as THREE.MeshBasicMaterial;
      if (decalLife[i] <= 0) {
        d.visible = false;
        continue;
      }
      m.opacity = 0.6 * Math.min(1, decalLife[i] / 2.5);
    }
  }

  function updateShipMotion(dt: number): void {
    if (!model) return;
    const root = model.root;

    switch (phase) {
      case 'sailIn': {
        sailInT += dt;
        const t = clamp(sailInT / SAIL_IN_SECONDS, 0, 1);
        const e = t * t * (3 - 2 * t); // smoothstep
        root.position.x = sailFrom.x + (anchor.x - sailFrom.x) * e;
        root.position.z = sailFrom.z + (anchor.y - sailFrom.z) * e;
        if (t >= 1) {
          phase = trek ? 'trek' : 'anchored';
          resetCannonTimers();
        }
        break;
      }
      case 'moving':
        if (moveToward(dt, MOVE_SPEED)) {
          phase = trek ? 'trek' : 'anchored';
          resetCannonTimers();
        }
        break;
      case 'trek': {
        // Cruise around the centre, shadowing the player's bearing.
        const px = ctx.player.position.x - ARCHIPELAGO_CENTER.x;
        const pz = ctx.player.position.z - ARCHIPELAGO_CENTER.z;
        const d = Math.hypot(px, pz) || 1;
        anchor.set(
          ARCHIPELAGO_CENTER.x + (px / d) * SHIP_ORBIT,
          ARCHIPELAGO_CENTER.z + (pz / d) * SHIP_ORBIT,
        );
        moveToward(dt, TREK_SPEED);
        break;
      }
      case 'sinking': {
        sinkT += dt;
        const t = clamp(sinkT / SINK_SECONDS, 0, 1);
        model.bob.rotation.z = -1.0 * t * t;
        model.bob.rotation.x = 0.18 * t;
        root.position.y = WATER_Y - 9 * scale * t * t;
        if (Math.random() < dt * 22) {
          tmpA.set(
            root.position.x + (Math.random() - 0.5) * HULL_LEN * scale,
            WATER_Y + 0.1,
            root.position.z + (Math.random() - 0.5) * HULL_BEAM * scale,
          );
          splash.burst(tmpA, 4, 2.2, 1.2, 0xe4f0f8, 2.4, 0.6);
          smoke.burst(tmpA, 2, 1.2, 1.6, 0xcfd6da, 1, 1);
        }
        if (t >= 1) {
          phase = 'sunk';
          sunk = true;
          model.root.visible = false;
          clearBalls();
          ctx.events.emit('shipSunk', { round: ctx.round });
        }
        break;
      }
      default:
        break;
    }

    // Wave bob / roll (skipped once the sinking animation owns the transform).
    if (phase !== 'sinking' && phase !== 'sunk') {
      const s = scale;
      model.bob.position.y = Math.sin(clock * 0.9) * 0.22 * s + Math.sin(clock * 1.7 + 1.3) * 0.08 * s;
      model.bob.rotation.z = Math.sin(clock * 0.75) * 0.055 + Math.sin(clock * 1.9) * 0.018;
      model.bob.rotation.x = Math.sin(clock * 1.15 + 0.7) * 0.03;
      // Wheel the broadside (the +Z cannon row) square to the player's island.
      const isl =
        SWINGSET_POSITIONS[
          clamp(ctx.player ? ctx.player.currentSetIndex : 0, 0, SWINGSET_POSITIONS.length - 1)
        ];
      const wantYaw = Math.atan2(isl.x - root.position.x, isl.z - root.position.z);
      root.rotation.y += wrapAngle(wantYaw - root.rotation.y) * (1 - Math.exp(-1.2 * dt));
      root.position.y = damp(root.position.y, WATER_Y, 4, dt);
    }

    // Flag flutter + gentle sail breathing.
    model.flag.rotation.y = Math.sin(clock * 3.1) * 0.28;
    model.flag.rotation.z = Math.sin(clock * 2.3) * 0.08;
    const breathe = 1 + Math.sin(clock * 1.4) * 0.03;
    for (const s of model.sails) s.scale.z = breathe;

    // Damage flash.
    if (hitFlash > 0) {
      hitFlash = Math.max(0, hitFlash - dt);
      const k = hitFlash / 0.25;
      for (const m of model.hullMats) m.emissive.setRGB(0.8 * k, 0.25 * k, 0.1 * k);
    }
  }

  // --- public API -----------------------------------------------------------

  const aimScratch = new THREE.Vector3();

  const api: ShipApi = {
    get hp() {
      return hp;
    },
    get maxHp() {
      return maxHp;
    },
    get sunk() {
      return sunk;
    },
    get jammedFor() {
      return jammedFor;
    },
    get cannonballs(): ReadonlyArray<BallInfo> {
      return balls;
    },
    get aimPoint(): THREE.Vector3 {
      if (model) {
        aimScratch.copy(model.root.position);
        aimScratch.y = WATER_Y + 2.2 * scale;
      } else {
        const a = ctx.world.shipAnchorage(ctx.player.currentSetIndex);
        aimScratch.set(a.x, WATER_Y + 2.2, a.z);
      }
      return aimScratch;
    },

    startRound(r: number, setIndex: number): void {
      startRound(r, setIndex);
    },

    setTrek(on: boolean): void {
      if (sunk) return;
      trek = on;
      if (on) {
        if (phase === 'anchored' || phase === 'moving') {
          phase = 'trek';
          resetCannonTimers();
        }
      } else if (phase === 'trek') {
        phase = 'moving';
      }
    },

    moveToSet(setIndex: number): void {
      if (sunk) return;
      setAnchorFromSet(setIndex);
      trek = false;
      if (phase === 'anchored' || phase === 'trek' || phase === 'moving') {
        phase = 'moving';
      }
    },

    damage(amount: number, source: HeldKind): void {
      if (sunk || phase === 'sinking' || phase === 'hidden' || amount <= 0) return;
      hp = Math.max(0, hp - amount);
      hitFlash = 0.25;
      if (model) {
        // Splinter burst from a random point on the shore-facing hull.
        model.body.localToWorld(
          tmpA.set(
            (Math.random() - 0.5) * HULL_LEN * 0.7,
            DECK_Y * 0.5 + Math.random(),
            HULL_BEAM * 0.45,
          ),
        );
        debris.burst(tmpA, 20, 5.5, 0.9, 0x9a7042, 2.5, 1.2);
        smoke.burst(tmpA, 8, 2, 1.2, 0xb9b1a4, 1.2, 1);
      }
      ctx.events.emit('shipDamaged', { amount, source, hp });
      if (hp <= 0) beginSinking();
    },

    jam(seconds: number): void {
      if (sunk) return;
      jammedFor = Math.max(jammedFor, seconds);
      ctx.events.emit('shipJammed', { seconds });
      jamPuffT = 0;
      if (model) {
        for (const c of model.cannons) {
          c.glow.visible = false;
          if (c.phase !== 'wait') {
            c.phase = 'wait';
            c.timer = Math.max(c.timer, seconds * 0.5);
          }
        }
      }
    },

    catchNearestBall(pos: THREE.Vector3, radius: number): BallInfo | null {
      let best = -1;
      let bestD = radius * radius;
      for (let i = 0; i < balls.length; i++) {
        const d = balls[i].pos.distanceToSquared(pos);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) return null;
      const b = balls[best];
      balls.splice(best, 1);
      freeBall(b);
      return { id: b.id, pos: b.pos, vel: b.vel };
    },

    hitTest(pos: THREE.Vector3, radius: number): boolean {
      if (!model || sunk || phase === 'hidden' || !model.root.visible) return false;
      // Sphere vs. the hull's oriented box, done in model-local space.
      tmpA.copy(pos);
      model.body.worldToLocal(tmpA);
      const hx = Math.max(0, Math.abs(tmpA.x) - model.halfLen);
      const hy = Math.max(0, Math.abs(tmpA.y - DECK_Y * 0.4) - 3.2);
      const hz = Math.max(0, Math.abs(tmpA.z) - model.halfBeam);
      const dist = Math.sqrt(hx * hx + hy * hy + hz * hz) * scale;
      return dist <= radius;
    },

    update(dt: number): void {
      clock += dt;
      if (jammedFor > 0) jammedFor = Math.max(0, jammedFor - dt);
      updateShipMotion(dt);
      updateCannons(dt);
      updateJamPuffs(dt);
      updateBalls(dt);
      updateTrajectories();
      updateFx(dt);
    },
  };

  return api;
}
