// =============================================================================
// travel modes: the course either runs in a straight line or spirals up and
// around an (invisible) tower. Physics is 1-D either way - player.z is the
// distance along the course - and only the presentation maps that distance,
// a sideways offset and a height to a world position via pathPos().
// =============================================================================
import * as THREE from "three";
import { PATH_CHUNK, TOWER_R } from "./constants";
import { storeGet, storeSet } from "./util";

export type Mode = "straight" | "tower";

let mode: Mode = normalizeMode(storeGet("ninja.mode", "straight"));
(function () {
  const q = /[?&]mode=(\w+)/.exec(location.search);
  if (q) mode = normalizeMode(q[1]);
})();

function normalizeMode(m: string): Mode { return m === "tower" ? "tower" : "straight"; }

export function getMode(): Mode { return mode; }
export function setModeValue(m: string): Mode {
  mode = normalizeMode(m);
  storeSet("ninja.mode", mode);
  return mode;
}
export function isTower(): boolean { return mode === "tower"; }
export function bestKey(): string { return isTower() ? "ninja.best.tower" : "ninja.best"; }

// distance along the course s, sideways x (+x is toward the tower), height y
// -> world position. Straight mode is the identity: x, y, z = s.
export function pathPos(s: number, x: number, y: number, out: THREE.Vector3): THREE.Vector3 {
  if (!isTower()) { out.set(x, y, s); return out; }
  const a = s / TOWER_R, r = TOWER_R - x;
  out.set(TOWER_R - r * Math.cos(a), y, r * Math.sin(a));
  return out;
}
// heading (yaw about Y) of the course at distance s; +Z at s = 0
export function pathYaw(s: number): number { return isTower() ? s / TOWER_R : 0; }
export function placeOnPath<T extends THREE.Object3D>(obj: T, s: number, x: number, y: number): T {
  pathPos(s, x, y, obj.position);
  obj.rotation.y = pathYaw(s);
  return obj;
}
// how many pieces a part of length len needs so it follows the arc
export function pathChunks(len: number): number { return isTower() ? Math.max(1, Math.ceil(len / PATH_CHUNK)) : 1; }

// scratch vector shared by the presentation code (never held across calls)
export const tmpV = new THREE.Vector3();
