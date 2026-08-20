// Pirates of the Swingset — shared contract between modules.
// Read CONTEXT.md for the game's vocabulary; the terms below match it.
//
// World conventions (three.js Y-up, right-handed, units = meters):
//   - The Playground is an archipelago: four themed Islands in a ring around
//     open water at y = WATER_Y; the Ship waits near the centre of the ring.
//   - Each Island's Swingset faces the centre (a kid swinging forward moves
//     toward the Ship). The camera sits behind the player, on the side away
//     from the centre. Per-island math uses the frame from towardCenter()/
//     setYaw(); island 0 keeps the historical axes (-Z toward the water).
//   - Islands are far enough apart that fog reduces the neighbours to
//     silhouettes; a Lookout (or a zip ride) opens the fog.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Tuning constants

export const WATER_Y = 0;
export const HEARTS_MAX = 5;
export const SWINGS_PER_SET = 4;
export const TREES_PER_SET = HEARTS_MAX; // one living Tree per Heart

/** Centre of the archipelago — the Ship's water. */
export const ARCHIPELAGO_CENTER = { x: 0, z: 0 } as const;
export const RING_RADIUS = 80; // island centres sit on this circle
export const SHIP_ORBIT = 25; // the Ship anchors this far from the centre

/** Island (= Swingset) centres: a ring around the Ship's water. Order is
 *  ring order — index ±1 are the two zip-line neighbours. */
export const SWINGSET_POSITIONS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 0, z: RING_RADIUS },
  { x: RING_RADIUS, z: 0 },
  { x: 0, z: -RING_RADIUS },
  { x: -RING_RADIUS, z: 0 },
];

/** Ring neighbours of an island — zip lines connect only these. */
export function ringNeighbors(setIndex: number): [number, number] {
  const n = SWINGSET_POSITIONS.length;
  return [(setIndex + 1) % n, (setIndex + n - 1) % n];
}

/** Unit XZ direction from island `setIndex` toward the archipelago centre. */
export function towardCenter(setIndex: number): { x: number; z: number } {
  const s = SWINGSET_POSITIONS[setIndex] ?? SWINGSET_POSITIONS[0];
  const dx = ARCHIPELAGO_CENTER.x - s.x;
  const dz = ARCHIPELAGO_CENTER.z - s.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: dx / d, z: dz / d };
}

/** rotation.y that points an island's local -Z ("toward the water" axis in
 *  the historical convention) at the centre, where the Ship waits. */
export function setYaw(setIndex: number): number {
  const f = towardCenter(setIndex);
  return Math.atan2(-f.x, -f.z);
}

// Island ground profile: flat plateau, then a beach sloping into the sea.
export const ISLAND_TOP = 1.6; // plateau height above the water
export const ISLAND_FLAT_R = 16; // dead flat out to here
export const ISLAND_SEA_R = 36; // fully drowned past here
export const SEABED_Y = -2.6;

/** Per-island looks. Index-aligned with SWINGSET_POSITIONS. */
export interface IslandTheme {
  name: string;
  /** Terrain grass base (HSL) — per-vertex noise varies around it. */
  grass: [number, number, number];
  /** Grass tuft instance colour base (HSL). */
  tuft: [number, number, number];
  sand: number;
  wetSand: number;
  leaf: number;
  leafWilt: number;
  wood: number; // swingset frame
  metal: number; // top bar
  seat: number;
}

export const ISLAND_THEMES: ReadonlyArray<IslandTheme> = [
  { name: 'Jungle', grass: [0.26, 0.58, 0.42], tuft: [0.26, 0.6, 0.44],
    sand: 0xf2d98f, wetSand: 0xd4b978, leaf: 0x4fae32, leafWilt: 0xa08c3c,
    wood: 0xc98a46, metal: 0x3fb8c4, seat: 0x46577a },
  { name: 'Autumn', grass: [0.1, 0.52, 0.44], tuft: [0.09, 0.6, 0.46],
    sand: 0xe8cf92, wetSand: 0xc9ad70, leaf: 0xd97c26, leafWilt: 0x8a5a2c,
    wood: 0xa96a34, metal: 0xd0542e, seat: 0x6b4a2e },
  { name: 'Snow', grass: [0.55, 0.18, 0.86], tuft: [0.52, 0.25, 0.78],
    sand: 0xe6edf2, wetSand: 0xbfd2dc, leaf: 0x4e8a6a, leafWilt: 0x7c8a80,
    wood: 0xa8b8c8, metal: 0x7cc8e8, seat: 0x4a6a8a },
  { name: 'Volcanic', grass: [0.04, 0.42, 0.26], tuft: [0.05, 0.5, 0.3],
    sand: 0x5c5450, wetSand: 0x403a38, leaf: 0xd8452a, leafWilt: 0x6a3a28,
    wood: 0x6a4a3a, metal: 0xe8742a, seat: 0x3a3440 },
];

// Zip lines: cable from a Lookout treetop down to a landing post on either
// ring neighbour. The ride is locked on — it always delivers.
export const ZIP_SPEED = 19; // m/s along the cable
export const ZIP_SAG = 3; // max mid-cable droop
export const ZIP_HANG = 1.5; // hands-on-cable → feet distance
export const ZIP_POST_R = 13; // landing post's distance from its island centre

export const FOG_NEAR = 45;
export const FOG_FAR = 150; // neighbour islands (~113m) are misty silhouettes

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
export type PlayerMode = 'swinging' | 'airborne' | 'ground' | 'climbing' | 'zipline';
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
  /** The player grabbed a zip line at a Lookout and is riding it. */
  zipStarted: { fromSet: number; toSet: number };
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
  /** Run speed fraction (0..1] for the held direction — the virtual joystick
   *  tilts it (small tilt = walk); the keyboard always reports 1. */
  moveScale: number;
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
  /** Land surface height — below WATER_Y out at sea between the islands. */
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
  /** Water position where the Ship parks: between the archipelago centre
   *  and the island it is menacing. */
  shipAnchorage(setIndex: number): { x: number; z: number };
  /** Top of the zip-line landing post on island `onSet` that faces its ring
   *  neighbour `facingSet`. The returned vector is shared scratch — copy it. */
  zipPostTop(onSet: number, facingSet: number): THREE.Vector3;
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
  /** False while the held item is away — the Boomerang Hammer mid-flight is
   *  still `held`, but the hand is empty, so the carry pose must let go. */
  readonly heldInHand: boolean;
  /** Throw/use input: returns true if the press did something. */
  useHeld(): boolean;
  /** Nearest ground pickup within `radius` of `from` (for the kid's head to
   *  glance at). The returned vector is reused scratch — copy, don't keep. */
  nearestPickup(from: THREE.Vector3, radius: number): THREE.Vector3 | null;
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
