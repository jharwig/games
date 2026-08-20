// =========================================================================
// constants
// =========================================================================
export const W = 768;
export const H = 480; // logical gameplay size
export const PW = 256;
export const PH = 160; // logical pixel-screen size (3x smaller)
export const FX0 = 16;
export const FY0 = 52;
export const FX1 = W - 16;
export const FY1 = H - 18; // fence rectangle
export const CELL = 12;
export const GW = 64;
export const GH = 40; // pathfinding grid
export const INF = 1e9;
export const OUT = "#3a2a12"; // cartoon outline colour
export const ANIM_NODRAW = 46; // no drawing this close to the animal
export const HONEY_DWELL = 1.5; // seconds a bee drinks
export const TOUCH_R = 30; // bee-hits-animal radius
export const INK_HALF = 5; // half thickness of the ink line

export const ANIMALS = ["DOG", "CAT", "COW", "HEN", "HORSE"];
export const ANIMAL_LONG = ["dog", "cat", "cow", "hen", "horse"];

export const P = {
  grass1: "#6abe30", grass2: "#5aa82a", grass3: "#7ecf3e",
  fence: "#8a5a2b", fenceHi: "#a97843",
  ink: "#2b2b6e", inkHi: "#5c5cc0",
  beeY: "#ffd23e",
  ui: "#0a0a10", uiText: "#ffffff", uiMut: "#bcd6a0", accent: "#ff8f2b",
  flower1: "#ff6b9d", flower2: "#fff26b", flower3: "#ffffff",
  sky: "#a8dcf0",
  dogB: "#a9744a", dogD: "#7c522f", catB: "#8d8d9c", cowW: "#f2f2ee", cowB: "#33333a",
  chW: "#f4f0e2", chR: "#e04b3a", chY: "#f0a028", hoB: "#6e4a2c", hoD: "#3f2a17",
  lock: "#55556a", open: "#3d7a2a", openHi: "#5aa82a"
};
