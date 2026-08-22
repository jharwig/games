// Tuning constants and palette. All gameplay numbers live here so a playtest
// pass is a one-file edit.

export const W = 960;
export const H = 540;

// Difficulty ramps from hour 0 to RAMP_HOURS, then holds at the floor.
export const RAMP_HOURS = 8;
export const NAP_MIN = [10, 5];      // [hour 0, floor] seconds
export const NAP_MAX = [18, 8];
export const STIR_LEN = [2.5, 1.0];  // telegraph window before the sweep
export const SPAWN_EVERY = [6, 2.5]; // seconds between chaos events

export const SWEEP_TIME = 2.0;       // gaze crossing the whole room
export const REACT_PAUSE = 1.15;     // gaze holds while a Reaction plays
export const SETTLE_LEN = 1.4;       // grumble + chime before dozing off

export const METER_MAX = 100;        // ~5 medium Dislikes fill it
export const LIKE_DRAIN = 30;        // a seen Like ≈ 1.5 medium Dislikes

// Points
export const PTS_LIKE_SEEN = 50;
export const PTS_SURVIVE = 25;       // + PTS_SURVIVE_HOUR * hour per wake-up
export const PTS_SURVIVE_HOUR = 5;

export interface Judgeable {
  key: string;        // stable identity within one sweep (so nothing is judged twice)
  x: number;
  reaction: string;   // key into REACTIONS
  meter: number;      // + fills the Grump Meter, - drains it
  points: number;     // banked when seen (Likes) — Dislikes give 0
  onSeen?: () => void;
}

// Severity (meter fill when seen) and stash points per Dislike.
export const SEVERITY: Record<string, { meter: number; stashPts: number }> = {
  toys:       { meter: 14, stashPts: 10 },
  juice:      { meter: 20, stashPts: 15 },
  pawprints:  { meter: 14, stashPts: 10 },
  cushion:    { meter: 20, stashPts: 15 },
  tv:         { meter: 20, stashPts: 15 },
  roughhouse: { meter: 22, stashPts: 0 },
  squabble:   { meter: 20, stashPts: 0 },
};

export function ramp(pair: number[], hour: number): number {
  const t = Math.min(1, hour / RAMP_HOURS);
  return pair[0] + (pair[1] - pair[0]) * t;
}

export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }
export function rand(a: number, b: number): number { return a + Math.random() * (b - a); }
export function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
