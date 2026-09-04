// =============================================================================
// the race: one lap, one car, one clock.
//
// Owns the world (track + scenery + items + car + ghost), steps the physics,
// resolves collisions, tracks checkpoints and fires events so main can do the
// HUD / sound / particles. Nothing in here touches the DOM.
// =============================================================================
import * as THREE from 'three';
import {
  applyOpacity, CarVisuals, makeCarState, pushOut, resetCar, snapshotMaterials, stepCar,
  type CarEnv, type MatSnapshot, type StepResult,
} from './car';
import { buildCar, carById, COIN_VALUE, type AbilityId, type CarModel, type CarSpec } from './cars';
import { buildLayout, ghostifyMaterials, type Layout } from './raceitems';
import { buildScenery, fogFor, type Scenery } from './scenery';
import { buildTrack, lateral, nearestSample, type BuiltTrack, type TrackDef } from './tracks';
import {
  ABILITY_USES, CHECKPOINTS, GHOST_HZ,
  type CarState, type GhostData, type GhostFrame, type InputState, type RaceEvents, type Surface,
} from './types';
import { clamp, damp, seeded, wrapAngle } from './util';

/** Gameplay knobs main may want to tweak. */
export const RACE_TUNING = {
  gravity: 22,
  /** collision radius of the car itself */
  carRadius: 1.3,
  coinRadius: 2.4,
  /** how far a coin can be vertically and still be scooped up */
  coinReach: 4,
  padBoostMul: 1.35,
  padBoostTime: 1.5,
  padSlowMul: 0.5,
  padCooldown: 1.0,
  /** speed kept after a solid hit = 1 - hitLoss × spec.weight */
  hitLoss: 0.65,
  /** backwards kick after a solid hit, × spec.weight */
  hitBounce: 2.2,
  obstacleCooldown: 0.6,
  oilSpin: 1.2,
  /** ice cracks: seconds of greatly reduced grip */
  crackTime: 1.5,
  crackGrip: 0.22,
  /** how long the fall / burn animation runs before the respawn */
  crashTime: 1.0,
  /** how far past the road edge you can hang before falling (Space) */
  edgeSlack: 1.0,
  magnetRange: 18,
  magnetPull: 26,
  phaseOpacity: 0.35,
  ghostOpacity: 0.35,
  boostAbilityTop: 1.5,
  boostAbilityAccel: 2,
  /** scenery closer than this to the camera is fully invisible */
  fadeNear: 2.5,
  /** ...and fully solid again beyond this */
  fadeFar: 9,
  fadeSpeed: 14,
};

interface FadeProp {
  obj: THREE.Object3D;
  mats: { m: THREE.Material; op: number; tr: boolean; dw: boolean }[];
  x: number; y: number; z: number;
  f: number;        // current fade 0..1
  applied: number;  // last value pushed into the materials
}

export class Race {
  // ---- public world handles -------------------------------------------------
  readonly track: BuiltTrack;
  readonly scenery: Scenery;
  readonly carModel: CarModel;
  readonly car: CarState;
  readonly spec: CarSpec;
  ghostModel: THREE.Group | null = null;
  readonly layout: Layout;

  // ---- public race state ----------------------------------------------------
  /** seconds since start(); frozen once finished */
  time = 0;
  finished = false;
  started = false;
  /** 0..1 around the lap */
  progress = 0;
  /** ability uses REMAINING this race (starts at ABILITY_USES) */
  abilityUses = ABILITY_USES;
  abilityActive = false;
  abilityTimeLeft = 0;
  /** coin value banked this run */
  coinsThisRun = 0;
  /** ghost samples of this run, for main to save as the next ghost */
  readonly recording: GhostFrame[] = [];
  /** seconds ahead (+) / behind (−) the ghost at the same point on the lap */
  ghostDelta: number | null = null;
  /** last checkpoint passed (respawn point) */
  lastCheckpoint = 0;

  // ---- internals ------------------------------------------------------------
  private readonly scene: THREE.Scene;
  private readonly events: RaceEvents;
  private readonly def: TrackDef;
  private readonly visuals: CarVisuals;
  private readonly carMats: MatSnapshot[];
  private readonly sunDir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  private hint = 0;
  private laps = 0;
  private prevProg = 0;
  private nextCp = 1;
  private ability: AbilityId | null = null;
  private boostTimer = 0;
  private slipTimer = 0;
  private crashKind: 'fall' | 'lava' | null = null;
  private crashTimer = 0;
  private lastStep: StepResult = { accel: 0, yawRate: 0, airborne: false, landed: false };
  private disposed = false;

  private ghostFrames: GhostFrame[] = [];
  private ghostProg: number[] = [];
  private ghostTotal = 0;
  private ghostCursor = 0;
  private deltaCursor = 0;
  private ghostMat: THREE.Material | null = null;

  private fades: FadeProp[] = [];

  private readonly env: CarEnv = {
    gripMul: 1, offRoad: false, offRoadMul: 1, topMul: 1, accelMul: 1,
    groundY: 0, gravity: RACE_TUNING.gravity, frozen: true,
  };

  constructor(scene: THREE.Scene, trackDef: TrackDef, carSpec: CarSpec, ghost: GhostData | null, events: RaceEvents) {
    this.scene = scene;
    this.events = events;
    this.def = trackDef;
    this.spec = carSpec;

    this.track = buildTrack(trackDef);
    scene.add(this.track.group);

    this.scenery = buildScenery(this.track);
    scene.add(this.scenery.group);
    scene.fog = fogFor(trackDef);
    this.sunDir.set(trackDef.sunDir[0], trackDef.sunDir[1], trackDef.sunDir[2]);

    // seeded from the track id so this track's layout never changes between runs
    const seed = 1000 + trackDef.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 100000;
    this.layout = buildLayout(this.track, seeded(seed));
    scene.add(this.layout.group);

    this.carModel = buildCar(carSpec);
    scene.add(this.carModel.group);
    this.carMats = snapshotMaterials(this.carModel.group);
    this.visuals = new CarVisuals(this.carModel);

    const s0 = this.track.samples[0];
    this.car = makeCarState(s0.p.x, s0.p.y, s0.p.z, Math.atan2(-s0.t.x, -s0.t.z));
    this.visuals.update(this.car, this.lastStep, 0.016, 0, 0);

    if (ghost && ghost.frames.length > 1) this.setupGhost(ghost);
    this.collectFadeProps();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Countdown is over: the clock runs and the driver gets control. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.time = 0;
    this.recording.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const root of [this.track.group, this.scenery.group, this.layout.group, this.carModel.group, this.ghostModel]) {
      if (!root) continue;
      this.scene.remove(root);
      disposeTree(root);
    }
    this.ghostMat?.dispose();
    this.ghostMat = null;
    this.ghostModel = null;
    this.fades.length = 0;
    if (this.scene.fog) this.scene.fog = null;
  }

  // ------------------------------------------------------------------ ability

  /** Fire the car's ability if one is left. Returns false if it couldn't. */
  useAbility(): boolean {
    if (!this.started || this.finished || this.crashTimer > 0) return false;
    if (this.abilityActive || this.abilityUses <= 0) return false;
    this.abilityUses--;
    this.ability = this.spec.ability;
    this.abilityActive = true;
    this.abilityTimeLeft = this.spec.abilityTime;
    if (this.ability === 'jump') {
      // vy picked so the hop lands again after roughly abilityTime seconds
      this.car.vy = (RACE_TUNING.gravity * this.spec.abilityTime) / 2;
    } else if (this.ability === 'phase') {
      applyOpacity(this.carMats, RACE_TUNING.phaseOpacity);
    }
    this.events.onAbility(this.ability, true);
    return true;
  }

  private endAbility(): void {
    if (!this.abilityActive || !this.ability) return;
    const a = this.ability;
    this.abilityActive = false;
    this.abilityTimeLeft = 0;
    this.ability = null;
    if (a === 'phase') applyOpacity(this.carMats, 1);
    this.events.onAbility(a, false);
  }

  // ------------------------------------------------------------------- update

  update(dt: number, input: InputState, now: number): void {
    if (this.disposed) return;
    dt = clamp(dt, 0, 0.05);
    const t = now / 1000;

    // the world keeps living during the countdown and after the finish
    this.scenery.update(t);
    for (const c of this.layout.coins) if (!c.taken) c.mesh.rotation.y = t * 2.5;
    for (const g of this.layout.gates) g.obj.position.y = g.baseY + Math.sin(t * 1.6 + g.index) * 0.12;

    if (this.started && !this.finished) this.time += dt;

    // --- ability bookkeeping
    if (input.abilityPressed) this.useAbility();
    if (this.abilityActive) {
      this.abilityTimeLeft -= dt;
      if (this.abilityTimeLeft <= 0) this.endAbility();
    }
    if (this.boostTimer > 0) this.boostTimer -= dt;
    if (this.slipTimer > 0) this.slipTimer -= dt;

    // --- crash (falling / burning) countdown, then back to the last checkpoint
    if (this.crashTimer > 0) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) this.respawn();
    }

    const car = this.car;
    const samples = this.track.samples;
    const n = samples.length;
    this.hint = nearestSample(samples, car.x, car.z, this.hint, 60);
    const s = samples[this.hint];
    const lat = lateral(s, car.x, car.z);
    const half = this.def.width / 2;
    const roadY = this.roadHeightAt(this.hint, car.x, car.z);
    // airborne is decided from last frame's height so a jump ignores the ground rules
    const inAir = car.y > roadY + 0.06 || car.vy > 0.01;
    const falling = this.crashKind === 'fall';
    const offRoad = Math.abs(lat) > half;
    const overVoid = this.def.ground === null && Math.abs(lat) > half + RACE_TUNING.edgeSlack;

    // driving off the edge of a floating track = falling (unless mid-hop)
    if (overVoid && !inAir && !this.crashTimer && this.started && !this.finished) this.startCrash('fall');

    // --- build this frame's environment for the physics
    const env = this.env;
    const boostAbility = this.abilityActive && this.ability === 'boost';
    env.gripMul = this.def.grip * (this.slipTimer > 0 ? RACE_TUNING.crackGrip : 1);
    env.offRoad = offRoad && !inAir && !falling;
    env.offRoadMul = this.def.offRoad;
    env.topMul = (this.boostTimer > 0 ? RACE_TUNING.padBoostMul : 1) * (boostAbility ? RACE_TUNING.boostAbilityTop : 1);
    env.accelMul = boostAbility ? RACE_TUNING.boostAbilityAccel : 1;
    env.groundY = falling || (overVoid && !inAir) ? null : roadY;
    env.gravity = RACE_TUNING.gravity;
    env.frozen = !this.started || this.finished || this.crashTimer > 0;

    this.lastStep = stepCar(car, this.spec, input, dt, env);
    car.boosting = this.boostTimer > 0 || boostAbility;
    car.surface = pickSurface(falling, this.lastStep.airborne, env.offRoad);

    // --- world interactions (skipped while crashed / before the flag drops)
    const live = this.started && !this.finished && this.crashTimer <= 0;
    this.updateCoins(dt, live);
    if (live) {
      this.updateObstacles(dt, inAir);
      this.updatePads(dt, inAir);
      this.updateCheckpoints(n);
    } else {
      for (const o of this.layout.obstacles) if (o.cool > 0) o.cool -= dt;
      for (const p of this.layout.pads) if (p.cool > 0) p.cool -= dt;
    }

    // --- ghost record / playback (keeps recording through a crash so the
    // ghost's timeline stays dense and lines up with the clock)
    if (this.started && !this.finished) this.record();
    this.playGhost();

    // --- visuals
    this.visuals.update(car, this.lastStep, dt, t, this.def.ground === null ? this.slopeAt(this.hint) : 0);
    const sun = this.scenery.sun;
    sun.position.set(car.x, car.y, car.z).addScaledVector(this.sunDir, 140);
    sun.target.position.set(car.x, car.y, car.z);
    sun.target.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- near fade

  /**
   * Repo rule: scenery must never block the view of the player. Anything close
   * to the camera dissolves and comes back once it's behind you.
   */
  updateNearFade(camera: THREE.Camera, dt: number): void {
    if (this.disposed) return;
    camera.getWorldPosition(this.tmp);
    const { fadeNear, fadeFar, fadeSpeed } = RACE_TUNING;
    const span = fadeFar - fadeNear;
    for (const f of this.fades) {
      const dx = f.x - this.tmp.x, dy = f.y - this.tmp.y, dz = f.z - this.tmp.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const target = clamp((d - fadeNear) / span, 0, 1);
      if (target === 1 && f.f === 1) continue;
      f.f = damp(f.f, target, fadeSpeed, dt);
      if (target === 1 && f.f > 0.995) f.f = 1;
      if (Math.abs(f.f - f.applied) < 0.01) continue;
      f.applied = f.f;
      f.obj.visible = f.f > 0.02;
      for (const m of f.mats) {
        m.m.opacity = m.op * f.f;
        const tr = m.tr || f.f < 1;
        // toggling `transparent` forces a shader rebuild, so only do it on a change
        if (m.m.transparent !== tr) { m.m.transparent = tr; m.m.needsUpdate = true; }
        m.m.depthWrite = m.dw && f.f > 0.95;
      }
    }
  }

  // ------------------------------------------------------------------ helpers

  /** Road surface height under a world position (Space has hills). */
  private roadHeightAt(idx: number, x: number, z: number): number {
    const ss = this.track.samples;
    const n = ss.length;
    const s = ss[idx];
    const ds = this.track.length / n;
    const along = (x - s.p.x) * s.t.x + (z - s.p.z) * s.t.z;
    const j = along >= 0 ? (idx + 1) % n : (idx - 1 + n) % n;
    const f = clamp(Math.abs(along) / ds, 0, 1);
    return s.p.y + (ss[j].p.y - s.p.y) * f;
  }

  /** Road slope in radians (nose-up going uphill). */
  private slopeAt(idx: number): number {
    const ss = this.track.samples;
    const n = ss.length;
    const ds = this.track.length / n;
    const a = ss[(idx - 1 + n) % n].p.y;
    const b = ss[(idx + 1) % n].p.y;
    return Math.atan2(b - a, 2 * ds);
  }

  private startCrash(kind: 'fall' | 'lava'): void {
    if (this.crashTimer > 0) return;
    this.crashKind = kind;
    this.crashTimer = RACE_TUNING.crashTime;
    this.endAbility();
    this.boostTimer = 0;
    this.car.boosting = false;
    this.car.surface = kind === 'fall' ? 'falling' : 'road';
    if (kind === 'fall') this.car.vy = Math.min(this.car.vy, 0);
    this.events.onHit(kind === 'fall' ? 'fall' : 'lava');
  }

  private respawn(): void {
    this.crashKind = null;
    this.crashTimer = 0;
    const idx = this.layout.checkpointSamples[this.lastCheckpoint];
    const s = this.track.samples[idx];
    resetCar(this.car, s.p.x, s.p.y, s.p.z, Math.atan2(-s.t.x, -s.t.z));
    this.hint = idx;
    this.laps = 0;
    this.prevProg = idx / this.track.samples.length;
    this.boostTimer = 0;
    this.slipTimer = 0;
    this.visuals.roll = 0;
    this.visuals.pitch = 0;
    this.events.onRespawn();
  }

  // ------------------------------------------------------------------- pieces

  private updateCoins(dt: number, live: boolean): void {
    const car = this.car;
    const magnet = live && this.abilityActive && this.ability === 'magnet';
    const range2 = RACE_TUNING.magnetRange * RACE_TUNING.magnetRange;
    const r2 = (RACE_TUNING.coinRadius + RACE_TUNING.carRadius) ** 2;
    for (const c of this.layout.coins) {
      if (c.taken) continue;
      const p = c.mesh.position;
      if (magnet) {
        const dx = car.x - p.x, dy = car.y + 0.8 - p.y, dz = car.z - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < range2) {
          const d = Math.sqrt(d2) || 1;
          const step = Math.min(d, RACE_TUNING.magnetPull * dt);
          p.set(p.x + (dx / d) * step, p.y + (dy / d) * step, p.z + (dz / d) * step);
        }
      }
      if (!live) continue;
      const dx = car.x - p.x, dz = car.z - p.z;
      if (dx * dx + dz * dz > r2) continue;
      if (Math.abs(car.y - p.y) > RACE_TUNING.coinReach) continue;
      c.taken = true;
      c.mesh.visible = false;
      this.coinsThisRun += COIN_VALUE[c.kind];
      this.events.onCoin(c.kind, p.x, p.y, p.z);
    }
  }

  private updateObstacles(dt: number, inAir: boolean): void {
    const car = this.car;
    const phasing = this.abilityActive && this.ability === 'phase';
    const smashing = this.abilityActive && this.ability === 'smash';
    const R = RACE_TUNING;
    for (const o of this.layout.obstacles) {
      if (o.cool > 0) o.cool -= dt;
      if (o.dead) continue;
      const dx = car.x - o.x, dz = car.z - o.z;
      const rr = o.radius + R.carRadius;
      const d2 = dx * dx + dz * dz;
      if (d2 > rr * rr) continue;
      if (inAir || phasing || o.cool > 0) continue;   // hopped over / phased through
      if (smashing) {
        o.dead = true;
        o.obj.visible = false;
        this.events.onSmash(o.x, o.obj.position.y + 0.6, o.z);
        continue;
      }
      o.cool = R.obstacleCooldown;
      if (o.solid) {
        // bounce out of the obstacle and lose speed, scaled by how heavy we are
        const d = Math.sqrt(d2) || 0.001;
        pushOut(car, dx / d, dz / d, rr - d + 0.05);
        const w = this.spec.weight;
        car.speed = car.speed * (1 - R.hitLoss * w) - R.hitBounce * w;
        car.lateral *= 0.3;
        this.events.onHit('obstacle');
      } else if (o.kind === 'lava') {
        this.startCrash('lava');
        return;
      } else if (o.kind === 'crack') {
        this.slipTimer = R.crackTime;
        this.events.onHit('oil');
      } else {
        car.spinning = R.oilSpin;
        this.events.onHit('oil');
      }
    }
  }

  private updatePads(dt: number, inAir: boolean): void {
    const car = this.car;
    const R = RACE_TUNING;
    const r2 = (3.0 + R.carRadius) ** 2;
    for (const p of this.layout.pads) {
      if (p.cool > 0) { p.cool -= dt; continue; }
      if (inAir) continue;
      const dx = car.x - p.x, dz = car.z - p.z;
      if (dx * dx + dz * dz > r2) continue;
      p.cool = R.padCooldown;
      if (p.kind === 'boost') {
        car.speed = Math.max(car.speed, this.spec.topSpeed * R.padBoostMul);
        this.boostTimer = R.padBoostTime;
      } else {
        car.speed *= R.padSlowMul;
      }
      this.events.onPad(p.kind);
    }
  }

  private updateCheckpoints(n: number): void {
    const prog = this.hint / n;
    // detect the wrap so `total` grows monotonically across the start line
    if (this.prevProg > 0.75 && prog < 0.25) this.laps++;
    else if (this.prevProg < 0.25 && prog > 0.75) this.laps--;
    this.prevProg = prog;
    const total = this.laps + prog;
    this.progress = clamp(total, 0, 1);

    while (this.nextCp < CHECKPOINTS && total >= this.nextCp / CHECKPOINTS) {
      this.lastCheckpoint = this.nextCp;
      this.events.onCheckpoint(this.nextCp, CHECKPOINTS);
      this.nextCp++;
    }
    if (this.nextCp >= CHECKPOINTS && total >= 1) {
      this.finished = true;
      this.progress = 1;
      this.endAbility();
      this.events.onFinish(this.time);
    }
  }

  // -------------------------------------------------------------------- ghost

  private setupGhost(ghost: GhostData): void {
    const model = buildCar(carById(ghost.carId));
    this.ghostMat = ghostifyMaterials(model.group, RACE_TUNING.ghostOpacity);
    this.ghostModel = model.group;
    const f0 = ghost.frames[0];
    this.ghostModel.position.set(f0.x, f0.y, f0.z);
    this.ghostModel.rotation.y = f0.h;
    this.scene.add(this.ghostModel);
    this.ghostFrames = ghost.frames;
    this.ghostTotal = ghost.time;

    // pre-compute how far round the lap the ghost was at each sample so the
    // delta can be read off by progress rather than by time
    const samples = this.track.samples;
    const n = samples.length;
    let hint = -1, prev = 0, laps = 0;
    this.ghostProg = ghost.frames.map((f, i) => {
      hint = nearestSample(samples, f.x, f.z, hint, 80);
      const p = hint / n;
      if (i > 0) {
        if (prev > 0.75 && p < 0.25) laps++;
        else if (prev < 0.25 && p > 0.75) laps--;
      }
      prev = p;
      return laps + p;
    });
  }

  private record(): void {
    const step = 1 / GHOST_HZ;
    while (this.recording.length * step <= this.time) {
      const c = this.car;
      this.recording.push({ t: this.recording.length * step, x: c.x, y: c.y, z: c.z, h: c.heading });
    }
  }

  private playGhost(): void {
    const frames = this.ghostFrames;
    if (!this.ghostModel || frames.length < 2) return;
    const t = this.time;
    while (this.ghostCursor < frames.length - 2 && frames[this.ghostCursor + 1].t <= t) this.ghostCursor++;
    const a = frames[this.ghostCursor], b = frames[this.ghostCursor + 1];
    const span = b.t - a.t;
    const f = span > 0 ? clamp((t - a.t) / span, 0, 1) : 0;
    this.tmp2.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
    this.ghostModel.position.copy(this.tmp2);
    this.ghostModel.rotation.y = a.h + wrapAngle(b.h - a.h) * f;
    this.ghostModel.visible = t <= this.ghostTotal + 0.5;

    // delta: when did the ghost reach the point of the lap we're at now?
    if (!this.started) { this.ghostDelta = null; return; }
    const prog = this.ghostProg;
    const total = this.laps + this.hint / this.track.samples.length;
    while (this.deltaCursor < prog.length - 2 && prog[this.deltaCursor + 1] <= total) this.deltaCursor++;
    let ghostTime: number;
    if (total >= prog[prog.length - 1]) ghostTime = this.ghostTotal;
    else {
      const p0 = prog[this.deltaCursor], p1 = prog[this.deltaCursor + 1];
      const g = p1 > p0 ? clamp((total - p0) / (p1 - p0), 0, 1) : 0;
      ghostTime = frames[this.deltaCursor].t + (frames[this.deltaCursor + 1].t - frames[this.deltaCursor].t) * g;
    }
    this.ghostDelta = ghostTime - this.time;
  }

  // --------------------------------------------------------------- fade setup

  /** Tag the small props that sit near the road; big things never fade. */
  private collectFadeProps(): void {
    const bb = new THREE.Box3();
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const samples = this.track.samples;
    const nearRoad = this.def.width / 2 + 32;
    const candidates: THREE.Object3D[] = [
      ...this.scenery.group.children,
      ...this.layout.gates.map((g) => g.obj),
    ];
    for (const child of candidates) {
      const anyChild = child as unknown as { isLight?: boolean; isPoints?: boolean };
      if (anyChild.isLight || anyChild.isPoints) continue;
      bb.setFromObject(child);
      if (bb.isEmpty()) continue;
      bb.getSize(size);
      // ground planes, seas, mountains, planets and the sky dome stay put
      if (Math.max(size.x, size.y, size.z) > 40) continue;
      bb.getCenter(centre);
      if (centre.y > 30) continue;
      const s = samples[nearestSample(samples, centre.x, centre.z)];
      if (Math.hypot(s.p.x - centre.x, s.p.z - centre.z) > nearRoad) continue;
      const mats: FadeProp['mats'] = [];
      const seen = new Set<THREE.Material>();
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of list) {
          if (!m || seen.has(m)) continue;
          seen.add(m);
          mats.push({ m, op: m.opacity, tr: m.transparent, dw: m.depthWrite });
        }
      });
      if (!mats.length) continue;
      this.fades.push({ obj: child, mats, x: centre.x, y: centre.y, z: centre.z, f: 1, applied: 1 });
    }
  }
}

function pickSurface(falling: boolean, airborne: boolean, offRoad: boolean): Surface {
  if (falling) return 'falling';
  if (airborne) return 'air';
  return offRoad ? 'off' : 'road';
}

function disposeTree(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  root.traverse((o) => {
    const any = o as THREE.Mesh & THREE.Points;
    if (any.geometry) geos.add(any.geometry);
    const m = any.material as THREE.Material | THREE.Material[] | undefined;
    if (m) for (const mm of Array.isArray(m) ? m : [m]) mats.add(mm);
  });
  for (const m of mats) {
    // NB: never touch `gradientMap` — gfx.ts shares one toon ramp across every material
    for (const key of ['map', 'alphaMap', 'emissiveMap'] as const) {
      const tex = (m as unknown as Record<string, unknown>)[key];
      if (tex instanceof THREE.Texture) texs.add(tex);
    }
    m.dispose();
  }
  for (const g of geos) g.dispose();
  for (const t of texs) t.dispose();
  root.clear();
}
