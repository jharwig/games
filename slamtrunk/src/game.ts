// =============================================================================
// one 60-second game of Slam Trunk. Owns the Three.js scene, the two
// elephants, the peanut in flight, the possession state machine and the
// camera. Everything DOM lives in hud/menu/result/shop; everything audible in
// audio.ts. This module only emits GameEvents.
//
// geometry notes (they drive most of the tuning constants below):
//   court is 28 x 15 m, long axis Z, bowls at z = +/-13, rim y = 4.0, r = 1.05
//   an elephant is ~3 m at the shoulder and its raised trunk tip sits 3.45 m
//   in FRONT of its body, so the shooter's release point is a long way ahead
//   of her feet. Shot distances are therefore measured from the release point.
// =============================================================================
import * as THREE from 'three';
import { buildElephant, NO_OUTFIT, type Elephant, type Outfit } from './elephant';
import { buildCourt, buildHoop, buildPeanut, buildBleachers, HOOP_Z, RIM_Y, RIM_R, type Hoop, type Crowd } from './court';
import { buildStadium, type Stadium, type StadiumId } from './stadiums';
import { GAME_SECONDS, type GameEvents, type InputState, type Score, type Who } from './types';

// ------------------------------------------------------------- constants ----
const G = 14;                 // gravity, matches the approved mockup's feel
const THREE_PT = 6.75;        // metres from the bowl centre
const BALL_START_Y = 0.25;    // resting height of a peanut on the floor
const SINK_R = RIM_R * 0.8;   // inside this it drops in
const RING_R = RIM_R * 1.45;  // between SINK_R and this it clatters off the rim
const LATERAL = 3.2;          // metres of sideways aim at full drag
const BLOCK_Y = 3.4;          // block point sits above the defender's head
const BLOCK_FWD = 0.5;        // ...and just in front of it
const CAM_BACK = 8.5, CAM_SIDE = 3.2, CAM_HIGH = 4.6;
const FADE_START = 5.5, FADE_END = 2.0, FADE_MIN = 0.12; // near-fade, as in ninja
const WALK_TIME = 0.9, SETTLE_TIME = 1.35, COUNT_STEP = 0.85;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** exponential smoothing that is stable at any frame rate */
const damp = (cur: number, to: number, lambda: number, dt: number): number => cur + (to - cur) * (1 - Math.exp(-lambda * dt));

// ------------------------------------------------------------ difficulty ----
/** Ellie's numbers per loop. Loop 0 is deliberately soft: she is slow to slide
 *  across, often bites early, only jumps 2 out of 5 times and cannot reach a
 *  lofted arc. Each loop she reacts sooner, reads the aim better and jumps
 *  higher; from loop 6 on she stops getting harder. */
export interface Difficulty {
  slide: number;      // m/s she can shuffle sideways
  read: number;       // 0..1 how much of the real aim she sees
  readErr: number;    // metres of bias in what she sees
  jumpChance: number; // chance she jumps at all on a shot
  jumpErr: number;    // seconds of timing error on that jump
  biteChance: number; // chance she jumps early while Peanut is still aiming
  hop: number;        // metres of jump
  reach: number;      // block sphere radius
  windup: number;     // her tell before she shoots (seconds)
  shotErr: number;    // metres of error on her own shot
  peanutReach: number;// how forgiving Peanut's block is (shrinks as loops rise)
}
export function difficulty(loop: number): Difficulty {
  const L = clamp(loop, 0, 6);
  return {
    slide: 1.5 + 0.75 * L,
    read: Math.min(0.95, 0.35 + 0.12 * L),
    readErr: Math.max(0.2, 2.0 - 0.34 * L),
    jumpChance: Math.min(0.95, 0.4 + 0.11 * L),
    jumpErr: Math.max(0.05, 0.42 - 0.065 * L),
    biteChance: Math.max(0, 0.55 - 0.1 * L),
    hop: 1.0 + 0.09 * L,
    reach: 1.0 + 0.06 * L,
    windup: Math.max(0.5, 0.92 - 0.07 * L),
    shotErr: Math.max(0.35, 1.3 - 0.16 * L),
  peanutReach: Math.max(1.1, 1.45 - 0.06 * L),
  };
}

// ----------------------------------------------------------------- actor ----
interface Actor {
  el: Elephant;
  who: Who;
  pos: THREE.Vector3;
  goal: THREE.Vector3;
  yaw: number; yawGoal: number;
  trunk: number; trunkGoal: number;
  /** seconds into a jump, or -1 when grounded */
  jumpT: number;
  jumpDur: number; hop: number;
  cheer: number; slump: number;
  phase: number;
}

type Phase = 'countdown' | 'walk' | 'ready' | 'flight' | 'settle' | 'over';

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
  /** true when the bounce that was just reported came off the rim, not the
   *  floor — main.ts uses it to pick sfx.rim() vs sfx.bounce(). */
  lastBounceWasRim = false;

  private renderer: THREE.WebGLRenderer;
  private events: GameEvents;

  private stadium!: Stadium;
  private crowd!: Crowd;
  private hoops!: Record<Who, Hoop>;
  private peanut!: Actor;
  private ellie!: Actor;
  private held!: THREE.Mesh;
  private ball!: THREE.Mesh;
  private dots!: THREE.InstancedMesh;

  private stadiumId: StadiumId = 'circus';
  private loop = 0;
  private diff = difficulty(0);

  private phase: Phase = 'countdown';
  private t = 0;                 // scene time, for the ambient animations
  private phaseT = 0;
  private clock = GAME_SECONDS;
  private lastTick = GAME_SECONDS;
  private countStep = 3;
  private score: Score = { peanut: 0, ellie: 0 };
  private possession: Who = 'peanut';
  private started = false;

  // possession geometry, recomputed when the shooter walks to a new spot
  private shotDist = 8;          // release point to bowl, metres
  private threePointer = false;
  private forward = new THREE.Vector3(0, 0, 1);  // shooter -> bowl, horizontal
  private perp = new THREE.Vector3(1, 0, 0);     // screen-right of that
  private defFrac = 0.4;         // where along the flight the block point sits
  private shotA = 0;             // angle of the shot line off the middle of the court

  // Ellie's defending
  private sway = 0;              // defender's lateral offset from the shot line
  private swayGoal = 0;
  private readBias = 0;
  private biteAt = Infinity;
  private jumpAt = Infinity;     // seconds after release that she leaves the floor
  private flightT = 0;

  // ball
  private vel = new THREE.Vector3();
  private prev = new THREE.Vector3();
  private live = false;
  private sunk = false;
  private rimHits = 0;
  private shooter: Who = 'peanut';

  // camera
  private camPos = new THREE.Vector3(0, 6, -18);
  private camLook = new THREE.Vector3(0, 3, 0);
  private camWant = new THREE.Vector3();
  private lookWant = new THREE.Vector3();

  // fade set + scratch (no allocation in the hot loop)
  private fadeMeshes: THREE.Mesh[] = [];
  private v0 = new THREE.Vector3();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private mtx = new THREE.Matrix4();
  private fadeBox = new THREE.Box3();
  private dotP = new THREE.Vector3();

  constructor(renderer: THREE.WebGLRenderer, events: GameEvents) {
    this.renderer = renderer;
    this.events = events;
  }

  // --------------------------------------------------------------- setup ----
  start(opts: { stadium: StadiumId; loop: number; outfit: Outfit }): void {
    this.disposeScene();
    this.stadiumId = opts.stadium;
    this.loop = opts.loop;
    this.diff = difficulty(opts.loop);

    const scene = this.scene;
    this.stadium = buildStadium(this.stadiumId, scene);
    scene.add(this.stadium.group);
    scene.add(buildCourt(this.stadium.floorTint));
    this.crowd = buildBleachers(this.stadium.helmets);
    scene.add(this.crowd.group);
    // Peanut shoots at +HOOP_Z (as in the mockup), Ellie at -HOOP_Z
    const far = buildHoop(HOOP_Z), near = buildHoop(-HOOP_Z);
    scene.add(far.group, near.group);
    this.hoops = { peanut: far, ellie: near };

    this.peanut = this.makeActor(buildElephant({ skin: 0x8d8a86, tusks: false }), 'peanut');
    this.peanut.el.setOutfit(opts.outfit);
    this.ellie = this.makeActor(buildElephant({ skin: 0x24325e, tusks: true }), 'ellie');
    this.ellie.el.setOutfit(NO_OUTFIT);   // Ellie never wears anything

    this.held = buildPeanut();
    this.ball = buildPeanut(); this.ball.visible = false; scene.add(this.ball);
    this.dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
      40,
    );
    this.dots.frustumCulled = false; this.dots.count = 0; scene.add(this.dots);

    this.collectFadeables();

    this.clock = GAME_SECONDS; this.lastTick = GAME_SECONDS;
    this.score = { peanut: 0, ellie: 0 };
    this.live = false; this.ball.visible = false;
    this.started = true;
    this.setSpots('peanut');
    this.peanut.pos.copy(this.peanut.goal); this.ellie.pos.copy(this.ellie.goal);
    this.peanut.yaw = this.peanut.yawGoal; this.ellie.yaw = this.ellie.yawGoal;
    // ...and then hold them there for 3-2-1-GO
    this.phase = 'countdown'; this.phaseT = 0; this.countStep = 3;
    // snap the camera behind Peanut so the countdown starts framed correctly
    this.aimCamera();
    this.camPos.copy(this.camWant); this.camLook.copy(this.lookWant);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
    this.events.onCountdown(3);
  }

  private makeActor(el: Elephant, who: Who): Actor {
    this.scene.add(el.group);
    return {
      el, who,
      pos: new THREE.Vector3(), goal: new THREE.Vector3(),
      yaw: who === 'peanut' ? 0 : Math.PI, yawGoal: who === 'peanut' ? 0 : Math.PI,
      trunk: 0, trunkGoal: 0,
      jumpT: -1, jumpDur: 0.62, hop: 1,
      cheer: 0, slump: 0, phase: who === 'peanut' ? 0 : 2.1,
    };
  }

  // ------------------------------------------------------------ geometry ----
  /** point at `dist` from a bowl, `a` radians off the middle of the court */
  private onLine(who: Who, dist: number, a: number, out: THREE.Vector3): THREE.Vector3 {
    const sign = who === 'peanut' ? 1 : -1;          // which bowl is the target
    return out.set(Math.sin(a) * dist, 0, sign * (HOOP_Z - Math.cos(a) * dist));
  }

  /** pick this possession's shooting spot and stand everyone up */
  private setSpots(who: Who): void {
    // release-point distance from the bowl. Biased short so contested shots
    // (and 2-pointers) are common; > 6.75 m scores three.
    // 5.4 m is as close as an elephant can shoot with another elephant's head
    // in the way; past ~9.6 m the arc is so high nobody could ever contest it.
    const L0 = 5.4 + 4.2 * Math.random() ** 1.25;
    this.shotDist = L0;
    this.threePointer = L0 > THREE_PT;
    const D = L0 + 3.45;                              // body is 3.45 m behind the trunk tip
    const maxA = Math.asin(Math.min(0.5, 6.0 / D));
    const a = (Math.random() * 2 - 1) * maxA;
    this.shotA = a;

    const shooter = who === 'peanut' ? this.peanut : this.ellie;
    const defender = who === 'peanut' ? this.ellie : this.peanut;
    this.onLine(who, D, a, shooter.goal);
    // defender's body: far enough in front of the release point that her head
    // is genuinely in the flight path, but never inside the bowl's pole
    const Dd = clamp(0.62 * L0 - 0.9, 2.9, L0 - 2.4);
    this.onLine(who, Dd, a, defender.goal);
    this.defFrac = clamp((L0 - (Dd + BLOCK_FWD)) / L0, 0.05, 0.9);

    // shot axes
    this.forward.copy(this.hoops[who].rim).setY(0).sub(this.v0.copy(shooter.goal).setY(0)).normalize();
    this.perp.crossVectors(this.forward, THREE.Object3D.DEFAULT_UP).normalize();

    // the defender starts out of position and has to shuffle back onto the line
    this.sway = (Math.random() < 0.5 ? -1 : 1) * (1.0 + Math.random() * 1.8);
    this.swayGoal = 0;
    this.readBias = (Math.random() * 2 - 1) * this.diff.readErr;
    defender.goal.addScaledVector(this.perp, this.sway);

    shooter.yawGoal = Math.atan2(this.forward.x, this.forward.z);
    defender.yawGoal = shooter.yawGoal + Math.PI;
    shooter.trunkGoal = who === 'peanut' ? 1 : 0;   // Ellie winds up later
    defender.trunkGoal = 0.55;
    shooter.jumpT = defender.jumpT = -1;
    shooter.cheer = shooter.slump = defender.cheer = defender.slump = 0;
    defender.hop = who === 'peanut' ? this.diff.hop : 1.5;
    defender.jumpDur = who === 'peanut' ? 0.62 : 0.66;

    // hand the peanut to the shooter's trunk
    shooter.el.trunkTip.add(this.held);
    this.held.position.set(0, 0.25, 0.1); this.held.rotation.set(0, 0, Math.PI / 2);
    this.held.visible = true;

    this.biteAt = Math.random() < this.diff.biteChance ? 0.8 + Math.random() * 1.7 : Infinity;
    this.jumpAt = Infinity;
    this.shooter = who; this.possession = who;
    this.phase = 'walk'; this.phaseT = 0;
    this.events.onPossession(who);
  }

  // ------------------------------------------------------------ ballistic ----
  /** velocity that carries a peanut from `from` to `to`, `loft` stretching the
   *  flight time (and so the height of the arc) without moving the landing
   *  spot — dragging up arcs the shot over a defender's trunk. */
  private solve(from: THREE.Vector3, to: THREE.Vector3, loft: number, out: THREE.Vector3): THREE.Vector3 {
    const dx = to.x - from.x, dz = to.z - from.z, h = to.y - from.y;
    const d = Math.max(0.5, Math.hypot(dx, dz));
    const T = (0.45 + 0.075 * d) * loft;
    const vy = (h + 0.5 * G * T * T) / T;
    return out.set(dx / T, vy, dz / T);
  }

  /** where Peanut's current drag would send the peanut */
  private aimTarget(dx: number, dy: number, out: THREE.Vector3): number {
    const loft = clamp(1 + dy * 1.05, 0.65, 1.95);
    const lateral = clamp(dx, -1, 1) * LATERAL;
    // a very high or very low arc also loses a little range: max drag overshoots
    const rangeErr = (loft - 1.05) * 1.4;
    out.copy(this.hoops[this.possession].rim)
      .addScaledVector(this.perp, lateral)
      .addScaledVector(this.forward, rangeErr);
    return loft;
  }

  private tipWorld(a: Actor, out: THREE.Vector3): THREE.Vector3 {
    a.el.trunkTip.getWorldPosition(out);
    return out;
  }

  private updateDots(input: InputState): void {
    if (this.phase !== 'ready' || this.possession !== 'peanut') { this.dots.count = 0; return; }
    const from = this.tipWorld(this.peanut, this.v0);
    const loft = this.aimTarget(input.aimDx, input.aimDy, this.v1);
    this.solve(from, this.v1, loft, this.v2);
    const p = this.dotP.copy(from);
    let n = 0; const step = 0.055;
    for (let i = 0; i < 120 && n < 40; i++) {
      p.addScaledVector(this.v2, step); this.v2.y -= G * step;
      if (i % 3 === 0) { this.mtx.makeTranslation(p.x, p.y, p.z); this.dots.setMatrixAt(n++, this.mtx); }
      if (p.y < 0.1) break;
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- shoot ----
  private shoot(who: Who, loft: number, target: THREE.Vector3): void {
    const shooter = who === 'peanut' ? this.peanut : this.ellie;
    this.tipWorld(shooter, this.v0);
    this.ball.position.copy(this.v0);
    this.ball.rotation.set(0, 0, Math.PI / 2);
    this.ball.visible = true;
    this.held.visible = false;
    this.solve(this.v0, target, loft, this.vel);
    this.live = true; this.sunk = false; this.rimHits = 0;
    this.flightT = 0;
    this.phase = 'flight'; this.phaseT = 0;
    this.shooter = who;
    this.events.onShoot(who);

    // the defender commits: jump so her head crosses the flight path as the
    // peanut arrives there (with a loop-scaled timing error)
    const defender = who === 'peanut' ? this.ellie : this.peanut;
    if (who === 'peanut') {
      if (defender.jumpT >= 0) this.jumpAt = Infinity;   // already committed (bit early)
      else if (Math.random() < this.diff.jumpChance) {
        const vh = Math.hypot(this.vel.x, this.vel.z);
        const arrive = (this.shotDist * this.defFrac) / Math.max(1, vh);
        const err = (Math.random() * 2 - 1) * this.diff.jumpErr;
        this.jumpAt = Math.max(0, arrive - defender.jumpDur * 0.42 + err);
      } else this.jumpAt = Infinity;
    } else this.jumpAt = Infinity;   // Peanut only jumps when the player taps
  }

  private ellieShoot(): void {
    const rim = this.hoops.ellie.rim;
    const mag = this.diff.shotErr * Math.sqrt(Math.random());
    const ang = Math.random() * Math.PI * 2;
    this.v1.copy(rim)
      .addScaledVector(this.perp, Math.cos(ang) * mag)
      .addScaledVector(this.forward, Math.sin(ang) * mag);
    this.shoot('ellie', 0.98 + Math.random() * 0.1, this.v1);
  }

  private jump(a: Actor): void {
    if (a.jumpT >= 0) return;
    a.jumpT = 0; a.trunkGoal = 1;
  }

  /** world-space centre of a defender's block volume */
  private blockPoint(a: Actor, out: THREE.Vector3): THREE.Vector3 {
    const u = a.jumpT < 0 ? 0 : clamp(a.jumpT / a.jumpDur, 0, 1);
    const y = a.hop * Math.pow(Math.sin(Math.PI * u), 0.8);
    return out.set(a.pos.x + Math.sin(a.yaw) * BLOCK_FWD, BLOCK_Y + y, a.pos.z + Math.cos(a.yaw) * BLOCK_FWD);
  }

  // ---------------------------------------------------------------- flight ----
  private stepBall(dt: number): void {
    const rim = this.hoops[this.shooter].rim;
    const defender = this.shooter === 'peanut' ? this.ellie : this.peanut;
    const reach = this.shooter === 'peanut' ? this.diff.reach : this.diff.peanutReach;
    const steps = Math.min(6, Math.max(1, Math.ceil(dt / 0.008)));
    const h = dt / steps;
    for (let s = 0; s < steps && this.live; s++) {
      this.prev.copy(this.ball.position);
      this.vel.y -= G * h;
      this.ball.position.addScaledVector(this.vel, h);
      this.ball.rotation.x += h * 7;

      // --- block: the defender's raised trunk / head volume ---
      if (!this.sunk && defender.jumpT >= 0) {
        this.blockPoint(defender, this.v0);
        if (this.ball.position.distanceTo(this.v0) < reach) {
          // swatted away: the peanut tumbles back and the blocker takes over
          this.live = false;
          this.vel.set(this.vel.x * -0.35, 2.2, this.vel.z * -0.55);
          this.events.onBlock(defender.who);
          defender.cheer = 1.0;
          (this.shooter === 'peanut' ? this.peanut : this.ellie).slump = 1.0;
          this.finish('block');
          return;
        }
      }

      if (this.sunk) continue;

      // --- rim / bowl mouth ---
      const dr = Math.hypot(this.ball.position.x - rim.x, this.ball.position.z - rim.z);
      const crossedDown = this.prev.y > RIM_Y && this.ball.position.y <= RIM_Y && this.vel.y < 0;
      const crossedUp = this.prev.y < RIM_Y && this.ball.position.y >= RIM_Y && this.vel.y > 0;
      if (crossedDown && dr < SINK_R) {
        this.sunk = true;
        this.ball.position.set(rim.x, RIM_Y - 0.35, rim.z);
        this.vel.set(0, 0, 0);
        this.finish('score');
        return;
      }
      if ((crossedDown || crossedUp) && dr >= SINK_R && dr < RING_R) {
        // clatter: kick it outward off the ring with a bit of randomness
        this.rimHits++;
        const nx = (this.ball.position.x - rim.x) / Math.max(0.001, dr);
        const nz = (this.ball.position.z - rim.z) / Math.max(0.001, dr);
        const spin = (Math.random() * 2 - 1) * 1.4;
        const push = 1.6 + Math.random() * 1.8;
        this.vel.set(nx * push + nz * spin, Math.abs(this.vel.y) * 0.42 + 1.2, nz * push - nx * spin);
        this.ball.position.y = RIM_Y + 0.02;
        this.lastBounceWasRim = true;
        this.events.onBounce();
        // a soft clatter can still drop straight in
        if (this.rimHits === 1 && Math.random() < 0.22) {
          this.sunk = true;
          this.ball.position.set(rim.x, RIM_Y - 0.35, rim.z);
          this.vel.set(0, 0, 0);
          this.finish('score');
          return;
        }
        continue;
      }

      // --- floor ---
      if (this.ball.position.y < BALL_START_Y) {
        this.ball.position.y = BALL_START_Y;
        this.vel.set(this.vel.x * 0.6, -this.vel.y * 0.35, this.vel.z * 0.6);
        this.lastBounceWasRim = false;
        this.events.onBounce();
        if (Math.abs(this.vel.y) < 0.6) {
          this.vel.set(0, 0, 0);
          this.finish('miss');
          return;
        }
      }
    }
  }

  /** after the possession is decided the peanut still falls, without scoring */
  private coast(dt: number): void {
    if (!this.ball.visible || this.sunk) return;
    this.vel.y -= G * dt;
    this.ball.position.addScaledVector(this.vel, dt);
    this.ball.rotation.x += dt * 7;
    if (this.ball.position.y < BALL_START_Y) {
      this.ball.position.y = BALL_START_Y;
      this.vel.set(this.vel.x * 0.6, -this.vel.y * 0.35, this.vel.z * 0.6);
      if (Math.abs(this.vel.y) < 0.6) this.vel.set(0, 0, 0);
    }
  }

  /** close out the possession */
  private finish(how: 'score' | 'miss' | 'block'): void {
    if (this.phase !== 'flight') return;
    const shooter = this.shooter === 'peanut' ? this.peanut : this.ellie;
    const defender = this.shooter === 'peanut' ? this.ellie : this.peanut;
    if (how === 'score') {
      const pts = this.threePointer ? 3 : 2;
      this.score[this.shooter] += pts;
      shooter.cheer = 1.2;
      this.crowd.excite(this.shooter === 'peanut' ? 2.2 : 1.0);
      this.events.onScore(this.shooter, { ...this.score }, this.threePointer);
      this.possession = defender.who;
    } else if (how === 'miss') {
      shooter.slump = 1.0;
      this.events.onMiss(this.shooter);
      this.possession = defender.who;
    } else {
      this.possession = defender.who;   // the blocker takes over
    }
    this.phase = 'settle'; this.phaseT = 0;
  }

  // ----------------------------------------------------------------- loop ----
  update(dt: number, input: InputState): void {
    if (!this.started) return;
    dt = clamp(dt, 0, 1 / 20);
    this.t += dt; this.phaseT += dt;

    this.stadium.update(this.t, dt);
    this.crowd.update(this.t);

    switch (this.phase) {
      case 'countdown': this.tickCountdown(); break;
      case 'walk': if (this.phaseT >= WALK_TIME) { this.phase = 'ready'; this.phaseT = 0; } break;
      case 'ready': this.tickReady(dt, input); break;
      case 'flight': this.tickFlight(dt, input); break;
      case 'settle':
        this.coast(dt);
        if (this.phaseT >= SETTLE_TIME) { this.ball.visible = false; this.live = false; this.setSpots(this.possession); }
        break;
      case 'over': break;
    }

    if (this.phase !== 'countdown' && this.phase !== 'over') this.tickClock(dt);

    this.updateDots(input);
    this.stepActor(this.peanut, dt);
    this.stepActor(this.ellie, dt);
    this.aimCamera();
    this.stepCamera(dt);
    this.updateNearFade(dt);
  }

  private tickCountdown(): void {
    const want = 3 - Math.floor(this.phaseT / COUNT_STEP);
    if (want !== this.countStep) {
      this.countStep = want;
      if (want > 0) this.events.onCountdown(want);
      else if (want === 0) this.events.onCountdown('GO');
      else { this.phase = 'walk'; this.phaseT = 0; }
    }
  }

  private tickClock(dt: number): void {
    this.clock -= dt;
    const whole = Math.max(0, Math.ceil(this.clock));
    if (whole !== this.lastTick) { this.lastTick = whole; this.events.onTick(whole); }
    if (this.clock <= 0) {
      this.clock = 0;
      this.phase = 'over';
      this.live = false;
      this.dots.count = 0;
      this.events.onEnd({
        ...this.score,
        // a tie counts as a loss, so a coin is only ever earned by winning outright
        won: this.score.peanut > this.score.ellie,
        stadium: this.stadiumId,
        loop: this.loop,
      });
    }
  }

  private tickReady(dt: number, input: InputState): void {
    if (this.possession === 'peanut') {
      this.defend(this.ellie, dt, input.aimDx);
      // Ellie sometimes bites early while Peanut lines the shot up
      if (this.phaseT > this.biteAt && this.ellie.jumpT < 0) {
        this.jump(this.ellie);
        this.biteAt = this.phaseT + 1.4 + Math.random() * 1.6;
      }
      if (input.release) {
        const loft = this.aimTarget(input.release.dx, input.release.dy, this.v1);
        this.shoot('peanut', loft, this.v1);
      }
    } else {
      // Peanut defends; Ellie winds her trunk up as a tell, then flings
      this.defend(this.peanut, dt, 0);
      const u = clamp(this.phaseT / this.diff.windup, 0, 1);
      this.ellie.trunkGoal = 0.15 + 0.85 * u;
      if (input.tap) this.jump(this.peanut);
      if (this.phaseT >= this.diff.windup) this.ellieShoot();
    }
  }

  private tickFlight(dt: number, input: InputState): void {
    if (this.possession === 'peanut') {
      this.defend(this.ellie, dt, 0);
      this.flightT += dt;
      if (this.flightT >= this.jumpAt) { this.jump(this.ellie); this.jumpAt = Infinity; }
    } else {
      this.defend(this.peanut, dt, 0);
      if (input.tap) this.jump(this.peanut);
    }
    if (this.live) this.stepBall(dt);
    else if (this.phaseT > 3.4) this.finish('miss');
    // safety net: a peanut that never settles still ends the possession
    if (this.phase === 'flight' && this.phaseT > 4.5) this.finish('miss');
  }

  /** the defender shuffles sideways to get her head onto the flight line */
  private defend(a: Actor, dt: number, aimDx: number): void {
    const isEllie = a.who === 'ellie';
    if (isEllie) {
      const seen = this.diff.read * clamp(aimDx, -1, 1) * LATERAL * this.defFrac + this.readBias;
      this.swayGoal = clamp(seen, -3.2, 3.2);
      const step = this.diff.slide * dt;
      this.sway += clamp(this.swayGoal - this.sway, -step, step);
    } else {
      // Peanut drifts onto the shot line by herself; the player only times taps
      this.swayGoal = 0;
      this.sway = damp(this.sway, 0, 3.2, dt);
    }
    const line = this.onLine(this.possession, this.defBodyDist(), this.shotA, this.v0);
    a.goal.copy(line).addScaledVector(this.perp, this.sway);
    a.trunkGoal = a.jumpT >= 0 ? 1 : 0.5 + Math.sin(this.t * 1.6) * 0.3;
  }

  private defBodyDist(): number {
    return clamp(0.62 * this.shotDist - 0.9, 2.9, this.shotDist - 2.4);
  }

  // ---------------------------------------------------------------- actors ----
  private stepActor(a: Actor, dt: number): void {
    const moving = a.pos.distanceToSquared(a.goal) > 0.02;
    a.pos.x = damp(a.pos.x, a.goal.x, 4.5, dt);
    a.pos.z = damp(a.pos.z, a.goal.z, 4.5, dt);
    a.yaw = damp(a.yaw, a.yawGoal, 5, dt);

    if (a.jumpT >= 0) {
      a.jumpT += dt;
      if (a.jumpT > a.jumpDur + 0.28) a.jumpT = -1;
    }
    const u = a.jumpT < 0 ? 0 : clamp(a.jumpT / a.jumpDur, 0, 1);
    let y = a.hop * Math.pow(Math.sin(Math.PI * u), 0.8);

    if (a.cheer > 0) { a.cheer = Math.max(0, a.cheer - dt); y += Math.abs(Math.sin(this.t * 9)) * 0.42; }
    if (a.slump > 0) a.slump = Math.max(0, a.slump - dt);
    if (moving) { a.phase += dt * 9; y += Math.abs(Math.sin(a.phase)) * 0.07; }

    a.el.group.position.set(a.pos.x, y, a.pos.z);
    a.el.group.rotation.y = a.yaw;
    a.el.group.rotation.x = a.slump > 0 ? -0.1 * Math.min(1, a.slump * 3) : 0;
    a.el.group.rotation.z = moving ? Math.sin(a.phase * 0.5) * 0.03 : 0;

    a.trunk = damp(a.trunk, a.slump > 0 ? 0 : a.trunkGoal, 9, dt);
    a.el.setTrunkPose(a.trunk);
    a.el.update(this.t + (a.who === 'ellie' ? 2.1 : 0));
  }

  // ---------------------------------------------------------------- camera ----
  private aimCamera(): void {
    const shooter = this.possession === 'peanut' ? this.peanut : this.ellie;
    // forward for the camera: from the shooter toward her bowl
    this.v0.copy(this.hoops[this.possession].rim).setY(0).sub(this.v1.copy(shooter.pos).setY(0));
    if (this.v0.lengthSq() < 0.01) this.v0.set(0, 0, this.possession === 'peanut' ? 1 : -1);
    this.v0.normalize();
    this.v1.crossVectors(this.v0, THREE.Object3D.DEFAULT_UP).normalize();   // screen right
    this.camWant.copy(shooter.pos)
      .addScaledVector(this.v0, -CAM_BACK)
      .addScaledVector(this.v1, -CAM_SIDE);
    this.camWant.y = CAM_HIGH;
    this.lookWant.copy(shooter.pos).addScaledVector(this.v0, 9); this.lookWant.y = 3.0;
    // let the ball pull the look point so the player watches it land
    if (this.ball.visible && (this.phase === 'flight' || this.phase === 'settle')) {
      this.lookWant.lerp(this.ball.position, 0.45);
    }
    // never below the floor, never buried in the stands
    this.camWant.y = Math.max(1.4, this.camWant.y);
    this.camWant.x = clamp(this.camWant.x, -8.3, 8.3);
    this.camWant.z = clamp(this.camWant.z, -23, 23);
  }

  private stepCamera(dt: number): void {
    const lambda = this.phase === 'walk' ? 2.6 : 4.5;   // slow swing on possession change
    this.camPos.x = damp(this.camPos.x, this.camWant.x, lambda, dt);
    this.camPos.y = damp(this.camPos.y, this.camWant.y, lambda, dt);
    this.camPos.z = damp(this.camPos.z, this.camWant.z, lambda, dt);
    this.camLook.x = damp(this.camLook.x, this.lookWant.x, lambda + 2, dt);
    this.camLook.y = damp(this.camLook.y, this.lookWant.y, lambda + 2, dt);
    this.camLook.z = damp(this.camLook.z, this.lookWant.z, lambda + 2, dt);
    this.camPos.y = Math.max(1.4, this.camPos.y);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ------------------------------------------------------------ near fade ----
  // repo rule: scenery that gets close to the lens fades so it never blocks the
  // view of the players. Adapted from ninja/src/course.ts updateNearFade.
  private collectFadeables(): void {
    this.fadeMeshes.length = 0;
    const consider = (root: THREE.Object3D): void => {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) return;  // crowd bodies
        this.fadeBox.setFromObject(m);
        m.userData.fadeOp = 1;
        m.userData.fadeHalf = [
          (this.fadeBox.max.x - this.fadeBox.min.x) / 2,
          (this.fadeBox.max.y - this.fadeBox.min.y) / 2,
          (this.fadeBox.max.z - this.fadeBox.min.z) / 2,
        ];
        this.fadeMeshes.push(m);
      });
    };
    consider(this.crowd.group);
    consider(this.stadium.group);
  }

  private updateNearFade(dt: number): void {
    const cam = this.camera.position;
    for (let i = 0; i < this.fadeMeshes.length; i++) {
      const m = this.fadeMeshes[i];
      m.getWorldPosition(this.v0);
      const half = m.userData.fadeHalf as [number, number, number];
      // distance to the mesh's box, not its centre, so long slabs only fade
      // once their near edge really reaches the lens
      const dx = Math.max(0, Math.abs(this.v0.x - cam.x) - half[0]);
      const dy = Math.max(0, Math.abs(this.v0.y - cam.y) - half[1]);
      const dz = Math.max(0, Math.abs(this.v0.z - cam.z) - half[2]);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let target = clamp((dist - FADE_END) / (FADE_START - FADE_END), 0, 1);
      target = FADE_MIN + (1 - FADE_MIN) * target;
      const op = damp(m.userData.fadeOp as number, target, 12, dt);
      m.userData.fadeOp = op;
      if (op < 0.995) {
        if (!m.userData.fadeMat) {
          m.userData.baseMat = m.material;
          const fm = (m.material as THREE.Material).clone();
          fm.transparent = true;
          m.userData.fadeMat = fm;
        }
        (m.userData.fadeMat as THREE.Material).opacity = op;
        m.material = m.userData.fadeMat as THREE.Material;
      } else if (m.userData.baseMat && m.material !== m.userData.baseMat) {
        m.material = m.userData.baseMat as THREE.Material;
      }
    }
  }

  // ---------------------------------------------------------------- plumbing ----
  resize(): void {
    this.renderer.setSize(innerWidth, innerHeight, true);
    this.camera.aspect = innerWidth / Math.max(1, innerHeight);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    if (!this.started) return;
    this.renderer.render(this.scene, this.camera);
  }

  /** score so far, for the HUD after a resume */
  get currentScore(): Score { return { ...this.score }; }
  get secondsLeft(): number { return Math.max(0, Math.ceil(this.clock)); }

  private disposeScene(): void {
    if (!this.started) { this.scene.clear(); return; }
    // buildPeanut caches one shared geometry + material, so never dispose those
    const keepGeo = this.ball?.geometry, keepMat = this.ball?.material;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.geometry && m.geometry !== keepGeo) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of mats) {
        if (!mm || mm === keepMat) continue;
        const s = mm as THREE.MeshStandardMaterial;
        s.map?.dispose(); s.bumpMap?.dispose();
        mm.dispose();
      }
    });
    this.scene.clear();
    this.scene.background = null; this.scene.fog = null;
    this.fadeMeshes.length = 0;
    this.started = false;
  }

  dispose(): void {
    this.disposeScene();
  }
}

export function createGame(renderer: THREE.WebGLRenderer, events: GameEvents): Game {
  return new Game(renderer, events);
}
