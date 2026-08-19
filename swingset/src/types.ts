// Pirates of the Swingset — shared contract between modules.
// Read CONTEXT.md for the game's vocabulary; the terms below match it.
//
// World conventions (three.js Y-up, right-handed, units = meters):
//   - Water fills z < 0 at y = WATER_Y; the shore runs along the X axis.
//   - The Playground is on z > 0; Swingsets face the water (a kid swinging
//     forward moves toward -Z). The camera sits behind the player (+Z side)
//     looking toward the water.
//   - Swingsets are spread far apart along the shore (mostly along X); fog
//     keeps only the current one visible.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Tuning constants

export const WATER_Y = 0;
export const HEARTS_MAX = 5;
export const SWINGS_PER_SET = 4;
export const TREES_PER_SET = HEARTS_MAX; // one living Tree per Heart

/** Swingset locations (x, z). Far enough apart that fog hides the others. */
export const SWINGSET_POSITIONS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 0, z: 26 },
  { x: 130, z: 32 },
  { x: -140, z: 28 },
  { x: 265, z: 30 },
];

export const FOG_NEAR = 45;
export const FOG_FAR = 110; // next swingset (~130m away) is beyond the fog

export const SWING_ROPE_LENGTH = 3.2; // pivot (top bar) to seat
export const SWING_BAR_HEIGHT = 3.6;
export const SWING_MAX_ANGLE = 1.35; // rad, amplitude cap from pumping

export const BLAST_RADIUS = 4.5; // ground blast that costs a Heart
export const PLAYER_HIT_RADIUS = 1.0; // ball-vs-player direct hit
export const SWING_HIT_RADIUS = 1.1; // ball-vs-seat

export const MAGNET_CATCH_RADIUS = 5.0;
export const WRENCH_JAM_SECONDS = 6;
export const STUMP_REGROW_SECONDS = 25; // chainsawed stump grows back

export const TOOL_DAMAGE: Record<string, number> = {
  hammer: 6,
  cannonball: 14, // magnet-caught ball slung back
  log: 26, // thrown Tree
  wrench: 0, // jams instead of damaging
};

/** Per-Round Ship scaling ("all of it, gradually"). */
export function shipSpec(round: number): {
  maxHp: number;
  fireInterval: number; // seconds between shots
  cannons: number;
  scale: number; // visual size multiplier
} {
  return {
    maxHp: 30 + 22 * (round - 1),
    fireInterval: Math.max(2.4, 6.5 - 0.55 * (round - 1)),
    cannons: 1 + Math.floor((round - 1) / 3),
    scale: 1 + 0.12 * (round - 1),
  };
}

/** During a Trek the Ship repositions and only lobs occasional slow shots. */
export const TREK_FIRE_INTERVAL = 9;

export const SCORE_POINTS = {
  hit: 10, // per point of damage dealt
  shipSunk: 500, // × round
  swingPerSecond: 5, // while riding with decent amplitude
  swingsetFound: 300,
  treeClimbed: 50,
} as const;

// ---------------------------------------------------------------------------
// Basic shared types

export type CharacterKind = 'boy' | 'girl';
export type ToolKind = 'chainsaw' | 'hammer' | 'magnet' | 'wrench';
export type Screen = 'title' | 'playing' | 'roundWon' | 'gameOver';
export type PlayerMode = 'swinging' | 'airborne' | 'ground' | 'climbing';
export type TreeState = 'alive' | 'fallen' | 'stump' | 'gone';

export interface ScoreBreakdown {
  hits: number; // points from damaging the Ship
  shipsSunk: number; // count
  swingSeconds: number; // seconds of real swinging
  swingsetsFound: number; // count
  treesClimbed: number; // count
  total: number; // running point total
}

export interface SwingInfo {
  setIndex: number;
  swingIndex: number;
  broken: boolean;
  /** Pendulum state, integrated by world.update(); 0 = hanging at rest,
   *  positive = seat toward the water (-Z). */
  angle: number;
  angularVel: number;
  /** Add pump energy (called by the player module on a pump press). */
  pump(strength: number): void;
  /** Group whose rotation.x follows `angle`; seat mesh hangs at its end. */
  pivot: THREE.Object3D;
  /** Current world position of the seat. */
  seatWorldPos(out: THREE.Vector3): THREE.Vector3;
  /** World position of the seat when hanging at rest (targeting). */
  restSeatPos: THREE.Vector3;
}

export interface SwingsetInfo {
  index: number;
  position: THREE.Vector3; // center of the frame on the ground
  swings: SwingInfo[]; // SWINGS_PER_SET of them
  wrecked(): boolean; // all swings broken
}

export interface TreeInfo {
  id: number;
  setIndex: number; // which Swingset it stands near
  position: THREE.Vector3; // trunk base
  height: number;
  state: TreeState;
  /** Set when state === 'fallen': cause of the fall. */
  fallCause?: 'chainsaw' | 'heart';
  /** Top-of-tree world position (Lookout perch / in-tree pickups). */
  topPos(out: THREE.Vector3): THREE.Vector3;
}

export interface BallInfo {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

export type HeldKind = ToolKind | 'log' | 'cannonball';

// ---------------------------------------------------------------------------
// Events

export interface GameEvents {
  /** A cannon fired a ball (audio: boom; ui: warning). */
  cannonFire: { ball: BallInfo; targetSwing: SwingInfo | null };
  /** A ball landed/collided. kind 'swing' includes the swing hit; 'player'
   *  means a direct mid-air hit on the player. Rules applied in main.ts. */
  cannonImpact: {
    pos: THREE.Vector3;
    kind: 'water' | 'ground' | 'swing' | 'player';
    swing?: SwingInfo;
  };
  swingBroken: { swing: SwingInfo };
  heartLost: { reason: 'swingHit' | 'blast' | 'directHit' };
  shipDamaged: { amount: number; source: HeldKind; hp: number };
  shipSunk: { round: number };
  shipJammed: { seconds: number };
  toolPickedUp: { tool: ToolKind };
  /** Any throw: tool, log, or caught cannonball. */
  itemThrown: { kind: HeldKind };
  ballCaught: Record<string, never>;
  treeFelled: { tree: TreeInfo; cause: 'chainsaw' | 'heart' };
  chainsawRevved: Record<string, never>;
  lookoutReached: { tree: TreeInfo };
  swingsetArrived: { index: number };
  screenShake: { intensity: number }; // 0..1
  roundStarted: { round: number };
  runStarted: { character: CharacterKind };
  gameOver: { score: ScoreBreakdown; best: number };
  message: { text: string }; // transient HUD message
}

export type EventKey = keyof GameEvents;

export class EventBus {
  private handlers = new Map<EventKey, Array<(e: never) => void>>();
  on<K extends EventKey>(key: K, fn: (e: GameEvents[K]) => void): void {
    const list = this.handlers.get(key) ?? [];
    list.push(fn as (e: never) => void);
    this.handlers.set(key, list);
  }
  emit<K extends EventKey>(key: K, payload: GameEvents[K]): void {
    const list = this.handlers.get(key);
    if (list) for (const fn of list) (fn as (e: GameEvents[K]) => void)(payload);
  }
}

// ---------------------------------------------------------------------------
// Input (keyboard written by input.ts, touch buttons written by ui.ts)

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Edge-triggered (true for one frame): main.ts clears after each frame. */
  pumpPressed: boolean;
  throwPressed: boolean;
  mutePressed: boolean;
  anyPressed: boolean;
}

// ---------------------------------------------------------------------------
// Module APIs — each implemented by its own file, composed in main.ts.

/** world.ts — terrain, water, sky, Swingsets, Trees. Owns swing pendulum
 *  integration and tree fall/regrow animation. */
export interface WorldApi {
  swingsets: SwingsetInfo[];
  trees: TreeInfo[];
  groundHeightAt(x: number, z: number): number;
  /** Mark broken + snap the ropes visually. */
  breakSwing(swing: SwingInfo): void;
  /** Repair every swing (new Run). */
  repairAllSwings(): void;
  /** Make living-tree count near `setIndex` match `hearts`: fell extras
   *  (cause 'heart'), revive dead ones when hearts refill. */
  syncHeartTrees(setIndex: number, hearts: number): void;
  fellTree(tree: TreeInfo, cause: 'chainsaw' | 'heart'): void;
  /** A fallen tree was picked up to carry: remove its mesh from the ground. */
  removeFallenTree(tree: TreeInfo): void;
  /** A blast bared the ground here: clear grass tufts within `radius` of
   *  (x, z). Grass regrows on a new Run. */
  scorchGrassAt(x: number, z: number, radius: number): void;
  /** Water position offshore from a Swingset where the Ship parks. */
  shipAnchorage(setIndex: number): { x: number; z: number };
  update(dt: number): void;
}

/** player.ts — character, swing riding/pumping, bail & run, climbing,
 *  and the camera rig (behind the player; zoomed out at a Lookout). */
export interface PlayerApi {
  readonly position: THREE.Vector3; // feet, world space
  readonly mode: PlayerMode;
  readonly ridingSwing: SwingInfo | null;
  readonly climbingTree: TreeInfo | null;
  readonly atLookout: boolean; // at the top of a climbed tree
  /** Swingset the player is at / nearest to. */
  readonly currentSetIndex: number;
  setCharacter(kind: CharacterKind): void;
  /** Place the player on an intact swing of the set (ground if none). */
  reset(setIndex: number): void;
  /** Hit while riding: lose the seat and tumble to the ground. */
  tumbleOff(): void;
  /** Where a held tool / carried log attaches (hand/back). */
  readonly carryAnchor: THREE.Object3D;
  cameraShake(intensity: number): void;
  update(dt: number): void;
}

/** ship.ts — the pirate Ship: model, aiming/telegraph/firing, cannonball
 *  ballistics + collision detection (emits cannonImpact; main applies rules),
 *  damage/sinking, trek repositioning. */
export interface ShipApi {
  readonly hp: number;
  readonly maxHp: number;
  readonly sunk: boolean;
  readonly jammedFor: number; // seconds of jam remaining
  readonly cannonballs: ReadonlyArray<BallInfo>;
  /** Sail in a fresh (bigger) ship for this round at the current set. */
  startRound(round: number, setIndex: number): void;
  /** Trek mode: reposition along shore, occasional slow shots. */
  setTrek(on: boolean): void;
  /** Called when the player settles at a new Swingset. */
  moveToSet(setIndex: number): void;
  damage(amount: number, source: HeldKind): void;
  jam(seconds: number): void;
  /** Remove and return a ball in flight within `radius` of `pos` (Magnet). */
  catchNearestBall(pos: THREE.Vector3, radius: number): BallInfo | null;
  /** Does a projectile at `pos` hit the ship's hull? */
  hitTest(pos: THREE.Vector3, radius: number): boolean;
  /** Current world point thrown items should aim at (hull center). The
   *  returned vector is a reused scratch — copy it, don't keep it. */
  readonly aimPoint: THREE.Vector3;
  update(dt: number): void;
}

/** tools.ts — Tool pickups scattered around the Playground (some up Trees),
 *  the held item, throws (hammer boomerang, log arc, caught cannonball),
 *  chainsaw felling, wrench jamming, magnet catching. */
export interface ToolsApi {
  readonly held: HeldKind | null;
  /** Throw/use input: returns true if the press did something. */
  useHeld(): boolean;
  /** Re-scatter pickups for a new Run. */
  reset(): void;
  update(dt: number): void;
}

/** ui.ts — DOM under #ui: HUD (hearts, round, ship HP, score, held tool),
 *  title/character-select, round-won celebration (with character switch),
 *  game-over breakdown, transient messages, touch controls, mute button. */
export interface UiApi {
  setScreen(s: Screen): void;
  /** Character picked on title / roundWon screens; null until clicked. */
  consumeStartRequest(): CharacterKind | null;
  update(dt: number): void;
}

/** audio.ts — WebAudio sea-shanty adventure loop + event-driven sfx. */
export interface AudioApi {
  readonly muted: boolean;
  toggleMute(): void;
  /** Call on first user gesture so the AudioContext may start. */
  userGesture(): void;
  update(dt: number): void;
}

// ---------------------------------------------------------------------------
// Shared game context, assembled by main.ts. Module factories receive this;
// the module fields are assigned right after construction, so modules must
// only *dereference* sibling modules inside update()/handlers, never at
// construction time.

export interface GameCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  events: EventBus;
  input: InputState;
  screen: Screen;
  round: number;
  hearts: number;
  character: CharacterKind;
  score: ScoreBreakdown;
  bestScore: number;
  /** Swingsets already credited as "found" this Run. */
  foundSets: Set<number>;
  world: WorldApi;
  player: PlayerApi;
  ship: ShipApi;
  tools: ToolsApi;
  ui: UiApi;
  audio: AudioApi;
}
