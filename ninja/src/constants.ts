// =============================================================================
// tuning constants
// =============================================================================
export const GRAVITY      = 26;      // units / s^2
export const RUN_SPEED    = 7.2;     // units / s
export const JUMP_V       = 11.5;    // units / s
export const AIR_ACCEL    = 26;      // units / s^2 toward RUN_SPEED while holding forward
export const AIR_DRAG     = 1.2;     // units / s^2 when not holding forward
export const COYOTE       = 0.13;    // s of grace after leaving a ledge
export const JUMP_BUFFER  = 0.16;    // s a jump press stays queued
export const JUMP_CUT     = 0.45;    // vy is scaled by this when jump is let go on the way up
export const JUMP_HOLD_MIN= 0.08;    // s of guaranteed rise, so a tap still hops a useful amount
export const MAX_FALL     = 34;      // terminal velocity
export const HAND_H       = 1.95;    // height of the hands above the feet when reaching
export const EDGE_GRACE   = 0.38;    // forgiving landing overhang
export const FALL_LIMIT   = 17;      // units below the spawn before it counts as a fall
export const FLIP_SPEED   = 11.4;    // rad / s (about 1.6 flips per full jump)
export const TRICK_SPIN   = 16;      // rad / s, the fastest an air trick is allowed to turn
export const TRICK_MIN    = 0.34;    // s of airtime below which a trick is a pose only
export const CLIMB_SPEED  = 3.6;
export const RAIL_SPEED   = 4.4;
export const ZIP_ACCEL    = 7.5;     // units / s^2 gained rolling down the wire
export const ZIP_MAX      = 11;      // the trolley never goes faster than this
export const WALL_SPEED   = 6.6;     // units / s running along a wall ride
export const WALL_SAG     = 0.35;    // units / s the feet slip down a wall ride
export const WALL_X       = 1.6;     // a wall ride stands this far out from the path's centre line
export const WALL_FOOT    = 1.15;    // ...and the ninja shifts over this far so her feet touch it
export const WARP_BOOST   = 1.32;    // run speed x this is the speed up the warped wall's arc
export const WARP_PEAK    = 1.03;    // a full-speed run reaches this fraction of the arc (a little past the top)
export const WARP_WINDOW  = 0.75;    // jump from this far up the arc (or higher) to make the ledge
export const WARP_LIP     = 1.8;     // the vertical lip above the curve, up to the ledge she grabs
export const LEDGE_HOLD   = 0.15;    // s the hands hold the ledge before the pull-up starts
export const LEDGE_PULL   = 0.6;     // s the pull-up over the ledge takes
export const LEDGE_STEP   = 0.6;     // how far onto the summit the pull-up lands her
export const RELEASE_LOCK = 0.30;    // s before the player can grab again
export const PEND_DAMP    = 0.12;
export const PUMP         = 2.2;

export const PALETTE = [0xff2e88, 0xa3ff12, 0x00e0ff, 0xff8a00, 0x9b5cff,
                        0xffe200, 0x00ff9d, 0xff4d4d, 0x37f0c2, 0xff66cc];

export const SKY_TOP = 0x2f8ede;
export const SKY_BOT = 0xc8f0ff;
export const FOG_COL = 0x9fdcff;

export function pickColor(): number { return PALETTE[(Math.random() * PALETTE.length) | 0]; }

// game states
export enum State { TITLE = 0, PLAYING = 1, CELEBRATE = 2, FALLING = 3 }

// travel modes: the course either runs in a straight line or spirals up and
// around an (invisible) tower
export const TOWER_R    = 16;    // helix radius; the tower is on the player's left
export const TOWER_RISE = 1.0;   // extra height each obstacle's landing gains, so the coil climbs
export const CAM_OUT    = 1.5;   // the chase camera rides a little outside the coil to see it curve
export const PATH_CHUNK = 2.0;   // long boxes / tubes are split into pieces this long to hug the arc

export type Medal = "gold" | "silver" | "bronze";
export const MEDAL_COL: Record<Medal, string> = { gold: "#ffcf2e", silver: "#dfe6ee", bronze: "#e08a45" };
export const MEDAL_ICON: Record<Medal, string> = { gold: "🥇", silver: "🥈", bronze: "🥉" };
