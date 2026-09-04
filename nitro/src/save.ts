// =============================================================================
// persistence: coins, unlocked cars, best times and ghosts, in localStorage.
// Ghost frames are stored as a flat rounded number array (5 numbers per frame)
// so a ~1000 frame ghost stays a few kB; they are rehydrated into GhostFrame[]
// on load, so the in-memory shape is always the SaveData declared in types.ts.
// =============================================================================
import { CARS, carById, type CarId, type CarSpec } from './cars';
import { TRACKS, type TrackId } from './tracks';
import type { BestTime, GhostData, GhostFrame, SaveData } from './types';
import { storeGet, storeSet } from './util';

const KEY = 'nitro.save';

/** Wire format: ghosts keep their frames flattened + rounded. */
interface WireGhost { c: string; t: number; f: number[] }
interface WireSave {
  coins?: unknown;
  unlocked?: unknown;
  best?: unknown;
  ghosts?: unknown;
  lastTrack?: unknown;
  lastCar?: unknown;
  muted?: unknown;
  tilt?: unknown;
}

const CAR_IDS = new Set<string>(CARS.map((c) => c.id));
const TRACK_IDS = new Set<string>(TRACKS.map((t) => t.id));

const isCarId = (v: unknown): v is CarId => typeof v === 'string' && CAR_IDS.has(v);
const isTrackId = (v: unknown): v is TrackId => typeof v === 'string' && TRACK_IDS.has(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);
const r2 = (n: number): number => Math.round(n * 100) / 100;

export function defaultSave(): SaveData {
  return {
    coins: 0,
    unlocked: ['f1'],
    best: {},
    ghosts: {},
    lastTrack: 'speedway',
    lastCar: 'f1',
    muted: false,
    tilt: null,
  };
}

function readGhost(v: unknown): GhostData | null {
  if (!v || typeof v !== 'object') return null;
  const g = v as Record<string, unknown>;
  if (!Array.isArray(g.f) || !isCarId(g.c)) return null;
  const flat = g.f as unknown[];
  const n = Math.floor(flat.length / 5);
  const frames: GhostFrame[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 5;
    frames[i] = {
      t: num(flat[o], 0), x: num(flat[o + 1], 0), y: num(flat[o + 2], 0),
      z: num(flat[o + 3], 0), h: num(flat[o + 4], 0),
    };
  }
  return { carId: g.c, time: num(g.t, 0), frames };
}

function writeGhost(g: GhostData): WireGhost {
  const flat = new Array<number>(g.frames.length * 5);
  for (let i = 0; i < g.frames.length; i++) {
    const f = g.frames[i], o = i * 5;
    flat[o] = r2(f.t); flat[o + 1] = r2(f.x); flat[o + 2] = r2(f.y);
    flat[o + 3] = r2(f.z); flat[o + 4] = r2(f.h);
  }
  return { c: g.carId, t: r2(g.time), f: flat };
}

/** Read the save, tolerating missing / corrupt / partially wrong data. */
export function loadSave(): SaveData {
  const out = defaultSave();
  let raw: unknown;
  try {
    raw = JSON.parse(storeGet(KEY, 'null')) as unknown;
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  const s = raw as WireSave;

  out.coins = Math.max(0, Math.floor(num(s.coins, 0)));
  if (Array.isArray(s.unlocked)) {
    for (const id of s.unlocked) if (isCarId(id) && !out.unlocked.includes(id)) out.unlocked.push(id);
  }
  if (s.best && typeof s.best === 'object') {
    for (const [k, v] of Object.entries(s.best as Record<string, unknown>)) {
      if (!isTrackId(k) || !v || typeof v !== 'object') continue;
      const b = v as Partial<BestTime>;
      const time = num(b.time, 0);
      if (time > 0) out.best[k] = { time, carId: isCarId(b.carId) ? b.carId : 'f1' };
    }
  }
  if (s.ghosts && typeof s.ghosts === 'object') {
    for (const [k, v] of Object.entries(s.ghosts as Record<string, unknown>)) {
      if (!isTrackId(k)) continue;
      const g = readGhost(v);
      if (g && g.frames.length) out.ghosts[k] = g;
    }
  }
  if (isTrackId(s.lastTrack)) out.lastTrack = s.lastTrack;
  if (isCarId(s.lastCar)) out.lastCar = s.lastCar;
  out.muted = s.muted === true;
  out.tilt = s.tilt === 'on' || s.tilt === 'off' ? s.tilt : null;
  return out;
}

/** Write the save immediately (compacting ghost frames). */
export function saveNow(data: SaveData): void {
  try {
    const ghosts: Record<string, WireGhost> = {};
    for (const [k, g] of Object.entries(data.ghosts)) if (g) ghosts[k] = writeGhost(g);
    storeSet(KEY, JSON.stringify({
      coins: Math.max(0, Math.floor(data.coins)),
      unlocked: data.unlocked,
      best: data.best,
      ghosts,
      lastTrack: data.lastTrack,
      lastCar: data.lastCar,
      muted: data.muted,
      tilt: data.tilt,
    }));
  } catch { /* quota / private mode — the run just isn't remembered */ }
}

/** Bank coins (clamped at 0) and persist. */
export function addCoins(data: SaveData, n: number): void {
  data.coins = Math.max(0, Math.floor(data.coins + n));
  saveNow(data);
}

export function isUnlocked(data: SaveData, spec: CarSpec): boolean {
  return spec.cost === 0 || data.unlocked.includes(spec.id);
}

export function canAfford(data: SaveData, spec: CarSpec): boolean {
  return !isUnlocked(data, spec) && data.coins >= spec.cost;
}

/** Buy a car: deducts the cost, unlocks it, saves. False if not affordable. */
export function unlockCar(data: SaveData, spec: CarSpec): boolean {
  if (isUnlocked(data, spec)) return false;
  if (data.coins < spec.cost) return false;
  data.coins -= spec.cost;
  data.unlocked.push(spec.id);
  saveNow(data);
  return true;
}

/**
 * Record a finished run. Stores the best time + its ghost when it beats the
 * previous best (or there wasn't one). Returns true for a new record.
 */
export function recordResult(
  data: SaveData, track: TrackId, carId: CarId, time: number, ghost: GhostData,
): boolean {
  data.lastTrack = track;
  data.lastCar = carId;
  const prev = data.best[track];
  const better = !prev || time < prev.time;
  if (better && isFinite(time) && time > 0) {
    data.best[track] = { time, carId };
    data.ghosts[track] = { carId: ghost.carId, time: ghost.time, frames: ghost.frames };
  }
  saveNow(data);
  return better;
}

/** The car the player should start in — falls back to F1 if it isn't owned. */
export function currentCar(data: SaveData): CarSpec {
  const spec = carById(data.lastCar);
  return isUnlocked(data, spec) ? spec : carById('f1');
}
