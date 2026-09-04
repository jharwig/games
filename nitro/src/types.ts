// =============================================================================
// shared contracts between modules. main.ts wires everything together; every
// other module only imports from here and from the already-written model
// files (gfx.ts, tracks.ts, cars.ts, scenery.ts, roadsurface.ts, util.ts).
// =============================================================================
import type { AbilityId, CarId, CoinKind } from './cars';
import type { TrackId } from './tracks';

// ---- input (input.ts) -------------------------------------------------------
export interface InputState {
  steer: number;        // -1 (left) .. 1 (right); keyboard or phone tilt
  throttle: number;     // 0..1  (Up arrow / gas button)
  brake: number;        // 0..1  (Down arrow / brake button)
  /** set true on the frame the ability key/button goes down; the race consumes it */
  abilityPressed: boolean;
  /** any key/tap this frame (menus, "press to start") — consumed by main */
  anyPressed: boolean;
  touch: boolean;       // coarse pointer device → on-screen buttons + tilt
  tilt: boolean;        // tilt steering currently active
  tiltBlocked: boolean; // OS refused the permission
}

// ---- race simulation (race.ts) ---------------------------------------------
export type Surface = 'road' | 'off' | 'air' | 'falling';

export interface CarState {
  x: number; y: number; z: number;   // world position (y = road height + jump)
  heading: number;                   // rotation.y; forward = (-sin h, 0, -cos h)
  speed: number;                     // forward speed m/s (negative = reversing)
  lateral: number;                   // sideways slip m/s (drift)
  vy: number;
  steer: number;                     // smoothed steering -1..1 (for wheel visuals)
  surface: Surface;
  boosting: boolean;                 // pad or ability boost active (for FX / camera FOV)
  spinning: number;                  // >0 while spun by oil (seconds left)
}

export type HitKind = 'obstacle' | 'oil' | 'lava' | 'fall' | 'wall';
export type PadKind = 'boost' | 'slow';

/** Callbacks the race fires so main can play sound / particles / HUD. */
export interface RaceEvents {
  onCoin(kind: CoinKind, x: number, y: number, z: number): void;
  onHit(kind: HitKind): void;
  onSmash(x: number, y: number, z: number): void;          // tank destroyed an obstacle
  onPad(kind: PadKind): void;
  onCheckpoint(index: number, total: number): void;
  onRespawn(): void;
  onAbility(ability: AbilityId, on: boolean): void;
  onFinish(time: number): void;
}

/** One ghost sample; recorded at GHOST_HZ during a race. */
export interface GhostFrame { t: number; x: number; y: number; z: number; h: number }
export const GHOST_HZ = 15;

export interface GhostData { carId: CarId; time: number; frames: GhostFrame[] }

// ---- persistence (save.ts) -------------------------------------------------
export interface BestTime { time: number; carId: CarId }
export interface SaveData {
  coins: number;                         // banked coins
  unlocked: CarId[];                     // always includes 'f1'
  best: Partial<Record<TrackId, BestTime>>;
  ghosts: Partial<Record<TrackId, GhostData>>;
  lastTrack: TrackId;
  lastCar: CarId;
  muted: boolean;
  tilt: 'on' | 'off' | null;             // null = never asked
}

// ---- audio (audio.ts) -----------------------------------------------------
export interface Sfx {
  coin(kind: CoinKind): void;
  hit(kind: HitKind): void;
  smash(): void;
  pad(kind: PadKind): void;
  ability(ability: AbilityId, on: boolean): void;
  checkpoint(): void;
  /** 3, 2, 1 beeps; 0 = GO */
  countdown(n: number): void;
  finish(newBest: boolean): void;
  respawn(): void;
  unlock(): void;
  click(): void;
}

// ---- gameplay constants ----------------------------------------------------
export const ABILITY_USES = 3;
export const CHECKPOINTS = 6;        // gates per lap (start line is #0)
export const COUNTDOWN_SECONDS = 3;
