// scene geometry
export const GROUND_Y = 262; // top of the pavement strip
export const FAR_BASE = 236; // baseline of far skyline
export const NEAR_BASE = 262; // baseline of near skyline

// physics + course tuning
export const GRAVITY = 520; // px/s^2
export const FLAP = -155; // px/s impulse
export const MAX_FALL = 260; // px/s terminal velocity
export const SPEED_BASE = 40; // px/s
export const SPEED_STEP = 3; // px/s added every 5 points
export const SPEED_MAX = 70; // px/s cap
export const GAP_H = 72; // px vertical gap
export const SPACING = 70; // px between column left edges
export const GAP_MIN = 40;
export const GAP_MAX = GROUND_Y - GAP_H - 30;
export const PLAYER_X = 50;
export const HIT_INSET = 2; // forgiving hitbox
export const DEAD_LOCK = 0.3; // s before restart is accepted
