// Tuning constants for Circle the Wagons. Vocabulary: see CONTEXT.md.

export const enum State { LOADING, TITLE, PLAYING, BREATHER, OVER }

// ---- world scale (metres) ----
export const EYE_HEIGHT = 1.7;
export const RING_RADIUS = 7.5;        // Stagecoach ring — tight, with wide gaps to shoot through
export const COACH_COUNT = 6;
export const LANE_MIN = 11;            // Riders circle between these radii
export const LANE_MAX = 19;
export const SPAWN_RADIUS = 42;        // Riders appear out here and ride in
export const GROUND_SIZE = 400;

// ---- player ----
export const HEARTS = 5;
export const PITCH_LIMIT = 0.62;       // radians up/down
export const MOUSE_SENS = 0.0022;
export const TOUCH_SENS = 0.0045;
export const KEY_TURN_SPEED = 2.2;     // rad/s with A/D or arrows

// ---- guns ----
export const RIFLE_LEVER_TIME = 0.55;  // lever cycle after each shot
export const RIFLE_SPREAD = 0.0;
export const REVOLVER_ROUNDS = 6;
export const REVOLVER_FIRE_TIME = 0.17;
export const REVOLVER_RELOAD_TIME = 1.6;
export const REVOLVER_SPREAD = 0.012;  // radians cone
export const SWAP_TIME = 0.4;
export const AIM_ASSIST = 0.016;       // radians: a near miss on a Rider still counts

// ---- riders ----
export const HORSE_SPEED = 11;         // m/s at raid 0 (gallop)
export const AIM_TIME = 1.1;           // Aim telegraph duration at raid 1 (shrinks)
export const AIM_TIME_MIN = 0.65;
export const AIM_GAP = 7;              // seconds between a rider's Aims at raid 1
export const AIM_GAP_MIN = 2.8;
export const BODY_FADE_TIME = 6;       // fallen riders fade after this
export const HORSE_DOWN_TIME = 2.6;    // a shot Horse goes down, then gets up and runs
export const BREATHER_TIME = 4;

// ---- scoring ----
export const STREAK_STEPS = [0, 5, 10, 20]; // streak -> multiplier index+1

export const BEST_KEY = 'wagons.best';
export const GYRO_KEY = 'wagons.gyro';

// ---- raid progression (n = raid number, 1-based) ----
export function raidParams(n: number) {
  const k = n - 1;
  return {
    count: Math.min(4 + 2 * k, 26),
    concurrent: Math.min(3 + k, 9),
    speed: 1 + 0.05 * k,
    aimTime: Math.max(AIM_TIME_MIN, AIM_TIME - 0.04 * k),
    aimGap: Math.max(AIM_GAP_MIN, AIM_GAP - 0.35 * k),
    reverseChance: Math.min(0.4, 0.1 * k),
    hangerChance: k >= 2 ? Math.min(0.4, 0.12 * (k - 1)) : 0,
    behindChance: Math.min(0.5, 0.15 * k), // riders may Aim from behind you
  };
}

// golden-hour palette used by the procedural fallbacks + UI
export const PALETTE = {
  skyTop: 0x5a6fa8,
  skyHorizon: 0xf6b26b,
  sun: 0xffd9a0,
  ground: 0xb08a4c,
  groundFar: 0xc99a5a,
  fog: 0xe9b57a,
  wood: 0x5b3b22,
  woodLight: 0x8a5a32,
  horse: [0x4a2f1d, 0x2b1b10, 0x8c6a4a, 0xa88b6b, 0x1a1a1a],
  skin: 0xd9a679,
  shirt: [0x6a3d2c, 0x3d4a6a, 0x2f4a32, 0x5a5a5a],
  hat: 0x3a2a1c,
  rider: 0xcf7b43,
};
