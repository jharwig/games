// =============================================================================
// course generation: platforms, the obstacle rigs, the podium, bunting, the
// near-camera fade and the per-frame rig animations (ropes, pads, stars)
// =============================================================================
import * as THREE from "three";
import {
  CLIMB_SPEED, GRAVITY, HAND_H, PALETTE, RAIL_SPEED, RUN_SPEED, TOWER_RISE, WALL_SPEED, WALL_X, WARP_LIP,
  pickColor
} from "./constants";
import { GEO, box, camera, pathWire, scene, shade, tube } from "./gfx";
import { isTower, pathPos, placeOnPath, tmpV } from "./path";
import { type Grab, type PendGrab, type WarpGrab, type ZipGrab, player } from "./player";
import { clamp, damp, rand } from "./util";

export interface Platform {
  z0: number; z1: number; y: number;
  isPodium?: boolean;
  bounce?: number;       // trampolines: launch speed
  pad?: THREE.Mesh;      // trampolines: the skin mesh that dips
  squash?: number;
}
export interface Blocker { z0: number; z1: number; top: number }   // the podium step you must jump onto
export interface Podium { z: number; y: number; baseY: number; star: THREE.Mesh; starY: number }

export interface Course {
  index: number;
  group: THREE.Group;
  platforms: Platform[];
  grabs: Grab[];
  blockers: Blocker[];
  geos: THREE.BufferGeometry[];
  bunt: { pos: number[]; col: number[] };
  est: number;           // generous walk-through time estimate
  podium: Podium | null;
  startZ: number; startY: number;
  d: number;             // difficulty 0..1
  rise: number;          // extra height every landing gains (0 on a straight course)
  fadeMeshes: THREE.Mesh[];
  parTime: number;
  endZ: number; endY: number;
  spawn: { z: number; y: number };
}

export const courses: Course[] = [];
export const platforms: Platform[] = [];
export const grabs: Grab[] = [];
export const blockers: Blocker[] = [];

export function rebuildWorldLists(): void {
  platforms.length = 0;
  grabs.length = 0;
  blockers.length = 0;
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    for (let j = 0; j < c.platforms.length; j++) platforms.push(c.platforms[j]);
    for (let k = 0; k < c.grabs.length; k++) grabs.push(c.grabs[k]);
    for (let b = 0; b < c.blockers.length; b++) blockers.push(c.blockers[b]);
  }
}

function addPlatform(c: Course, z0: number, z1: number, y: number, w: number, hex: number, isPodium?: boolean): Platform {
  const g = c.group;
  const len = z1 - z0;
  const cz = (z0 + z1) / 2;
  box(g, 0, y - 0.25, cz, w, 0.5, len, hex);                       // bright top slab
  box(g, 0, y - 1.16, cz, w * 0.82, 1.3, len * 0.97, shade(hex, 0.55)); // chunky under body
  // striped end caps make the jump edges easy to read
  // (they protrude 0.02 past the slab ends so no faces are coplanar)
  box(g, 0, y - 0.24, z1 - 0.26, w * 1.02, 0.56, 0.56, 0x16324f);
  box(g, 0, y - 0.24, z0 + 0.26, w * 1.02, 0.56, 0.56, 0x16324f);
  if (len > 5.5) addBunting(c, z0 + 0.6, z1 - 0.6, y, w);
  const p: Platform = { z0: z0, z1: z1, y: y, isPodium: !!isPodium };
  c.platforms.push(p);
  return p;
}

// bunting: one merged, vertex coloured triangle strip down each side of a platform
function addBunting(c: Course, z0: number, z1: number, y: number, w: number): void {
  const pos = c.bunt.pos, col = c.bunt.col;
  const seg = 1.15;
  const n = Math.max(2, Math.floor((z1 - z0) / seg));
  const step = (z1 - z0) / n;
  const top = y + 3.1;
  const col3 = new THREE.Color();
  function vert(s: number, x: number, y: number): void { pathPos(s, x, y, tmpV); pos.push(tmpV.x, tmpV.y, tmpV.z); }
  for (let side = -1; side <= 1; side += 2) {
    const x = side * (w / 2 + 0.35);
    for (let i = 0; i < n; i++) {
      const za = z0 + i * step, zb = za + step;
      const sag = 0.34;
      vert(za, x, top); vert(zb, x, top); vert((za + zb) / 2, x, top - sag - 0.62);
      col3.setHex(PALETTE[(i + (side > 0 ? 3 : 0)) % PALETTE.length]);
      for (let v = 0; v < 3; v++) col.push(col3.r, col3.g, col3.b);
    }
  }
}

function finishBunting(c: Course): void {
  if (!c.bunt.pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(c.bunt.pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(c.bunt.col, 3));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, buntMat);
  m.frustumCulled = true;
  c.group.add(m);
  c.geos.push(g);
}
const buntMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
const starMat = new THREE.MeshLambertMaterial({ color: 0xffe200, emissive: 0x8a6a00 });

// ---- obstacle builders. Each returns the new { z, y } cursor. c.rise is the
// extra height every landing gains (0 on a straight course). ----
interface Cursor { z: number; y: number }
type Builder = (c: Course, z: number, y: number, d: number) => Cursor;

function buildGap(c: Course, z: number, y: number, d: number): Cursor {
  // a rising landing needs a slightly shorter gap to stay jumpable at high d
  const gap = 2.2 + d * 2.6 + rand(0, 0.6) - c.rise * 0.5 * d;
  const ny = y + c.rise + (Math.random() - 0.38) * 1.6 * d;
  const len = 7.5 - d * 3.6 + rand(0, 2);
  addPlatform(c, z + gap, z + gap + len, ny, Math.max(2.2, 3.4 - d * 1.2), pickColor());
  c.est += 1.15 + len / RUN_SPEED;
  return { z: z + gap + len, y: ny };
}

function buildRail(c: Course, z: number, y: number, d: number): Cursor {
  const gap = 1.9 + d * 0.7;
  const railLen = 6 + d * 6 + rand(0, 3);
  const barY = y + 3.1;
  const z0 = z + gap, z1 = z0 + railLen;
  const hex = pickColor();
  const frame = shade(hex, 0.5);
  // two side rails + rungs
  tube(c.group, -1.5, barY + 0.22, (z0 + z1) / 2, 0.11, railLen, frame, "z");
  tube(c.group,  1.5, barY + 0.22, (z0 + z1) / 2, 0.11, railLen, frame, "z");
  const rungs = Math.max(2, Math.round(railLen / 1.15));
  for (let i = 0; i <= rungs; i++) {
    tube(c.group, 0, barY, z0 + (railLen * i) / rungs, 0.1, 3.0, PALETTE[i % PALETTE.length], "x");
  }
  // support posts at each end
  tube(c.group, -1.5, barY + 1.0, z0, 0.13, 1.6, frame);
  tube(c.group,  1.5, barY + 1.0, z0, 0.13, 1.6, frame);
  tube(c.group, -1.5, barY + 1.0, z1, 0.13, 1.6, frame);
  tube(c.group,  1.5, barY + 1.0, z1, 0.13, 1.6, frame);
  c.grabs.push({ kind: "rail", z0: z0, z1: z1, y: barY });

  const lz = z1 + 1.8;
  const len = 7 - d * 2.6 + rand(0, 2);
  addPlatform(c, lz, lz + len, y + c.rise, Math.max(2.4, 3.4 - d * 1.0), pickColor());
  c.est += 1.4 + railLen / RAIL_SPEED + len / RUN_SPEED;
  return { z: lz + len, y: y + c.rise };
}

function buildSwing(c: Course, z: number, y: number, d: number): Cursor {
  const n = 1 + (d > 0.42 ? 1 : 0) + (d > 0.82 ? 1 : 0);
  const spacing = 5.0 + d * 0.8;
  const anchorY = y + 5.0;
  const ropeLen = 3.0;
  const hex = pickColor();
  // the beam the ropes hang from
  const beamZ0 = z + 1.6, beamZ1 = z + 2.4 + (n - 1) * spacing + 1.6;
  tube(c.group, 0, anchorY + 0.35, (beamZ0 + beamZ1) / 2, 0.16, beamZ1 - beamZ0, shade(hex, 0.5), "z");
  for (let i = 0; i < n; i++) {
    const rz = z + 2.4 + i * spacing;
    const pivot = new THREE.Group();
    pivot.rotation.order = "YXZ";       // heading from the path first, then the swing
    placeOnPath(pivot, rz, 0, anchorY);
    c.group.add(pivot);
    const rc = PALETTE[(i * 3 + 1) % PALETTE.length];
    tube(pivot, 0, -ropeLen / 2, 0, 0.075, ropeLen, 0xf0e2c0);   // rope
    box(pivot, 0, -ropeLen - 0.16, 0, 0.9, 0.32, 0.32, rc);      // fat handle
    box(pivot, 0, -ropeLen * 0.55, 0, 0.24, 0.5, 0.24, rc);      // colour knot
    c.grabs.push({ kind: "pend", pz: rz, py: anchorY, ropeLen: ropeLen, len: ropeLen + HAND_H, node: pivot, swing: true, theta: 0 });
  }
  const lastZ = z + 2.4 + (n - 1) * spacing;
  const lz = lastZ + 5.6 + d * 0.8;
  const len = 7 - d * 2.4 + rand(0, 2);
  addPlatform(c, lz, lz + len, y + c.rise, Math.max(2.4, 3.4 - d * 1.0), pickColor());
  c.est += 1.6 + n * 2.3 + len / RUN_SPEED;
  return { z: lz + len, y: y + c.rise };
}

function buildLache(c: Course, z: number, y: number, d: number): Cursor {
  const n = 2 + (d > 0.5 ? 1 : 0) + (d > 0.85 ? 1 : 0);
  const spacing = 3.3 + d * 0.7;
  const barY = y + 3.2;
  const hex = pickColor();
  for (let i = 0; i < n; i++) {
    const bz = z + 2.3 + i * spacing;
    const bc = PALETTE[(i * 2 + 4) % PALETTE.length];
    tube(c.group, 0, barY, bz, 0.11, 3.0, bc, "x");
    // uprights that hold the bar
    tube(c.group, -1.45, barY + 1.1, bz, 0.12, 2.2, shade(hex, 0.5));
    tube(c.group,  1.45, barY + 1.1, bz, 0.12, 2.2, shade(hex, 0.5));
    box(c.group, -1.45, barY + 2.24, bz, 0.4, 0.28, 0.4, bc);
    box(c.group,  1.45, barY + 2.24, bz, 0.4, 0.28, 0.4, bc);
    c.grabs.push({ kind: "pend", pz: bz, py: barY, ropeLen: 0, len: HAND_H, node: null, swing: false, theta: 0 });
  }
  const lastZ = z + 2.3 + (n - 1) * spacing;
  const lz = lastZ + 3.4;
  const len = 7 - d * 2.4 + rand(0, 2);
  addPlatform(c, lz, lz + len, y + c.rise, Math.max(2.4, 3.4 - d * 1.0), pickColor());
  c.est += 1.4 + n * 1.7 + len / RUN_SPEED;
  return { z: lz + len, y: y + c.rise };
}

function buildClimb(c: Course, z: number, y: number, d: number): Cursor {
  const rise = 3.0 + d * 2.6 + c.rise;
  const rz = z + 2.6;
  const yTop = y + rise + 2.4;
  const yBot = y + 0.2;
  const hex = pickColor();
  // gantry
  tube(c.group, -1.7, (y + yTop + 0.6) / 2, rz, 0.15, yTop + 0.6 - y, shade(hex, 0.5));
  tube(c.group,  1.7, (y + yTop + 0.6) / 2, rz, 0.15, yTop + 0.6 - y, shade(hex, 0.5));
  tube(c.group, 0, yTop + 0.4, rz, 0.15, 3.6, hex, "x");
  // the rope, with colourful knots along it
  tube(c.group, 0, (yTop + yBot) / 2, rz, 0.085, yTop - yBot, 0xf0e2c0);
  const knots = Math.max(2, Math.round((yTop - yBot) / 1.1));
  for (let i = 0; i <= knots; i++) {
    box(c.group, 0, yBot + ((yTop - yBot) * i) / knots, rz, 0.34, 0.2, 0.34, PALETTE[i % PALETTE.length]);
  }
  c.grabs.push({ kind: "climb", z: rz, y0: yBot, y1: yTop });

  const lz = rz + 2.0;
  const len = 7.5 - d * 2.4 + rand(0, 2);
  addPlatform(c, lz, lz + len, y + rise, Math.max(2.4, 3.4 - d * 1.0), pickColor());
  c.est += 2.4 + rise / CLIMB_SPEED + len / RUN_SPEED;
  return { z: lz + len, y: y + rise };
}

function buildBounce(c: Course, z: number, y: number, d: number): Cursor {
  const gap = 1.8 + d * 0.8;
  const rise = 3.2 + d * 2.2 + c.rise;
  const padZ = z + gap + 1.45;
  const hex = pickColor();
  const frame = shade(hex, 0.5);
  // trampoline drum: a dark springy skin inside a bright rim on a squat base
  const skin = tube(c.group, 0, y - 0.14, padZ, 1.5, 0.28, 0x1c2740);
  tube(c.group, 0, y - 0.3, padZ, 1.66, 0.34, hex);
  tube(c.group, 0, y - 0.95, padZ, 1.15, 1.0, frame);
  // enough launch to clear the high ledge with a little to spare
  const v = Math.sqrt(2 * GRAVITY * (rise + 2.2));
  c.platforms.push({ z0: padZ - 1.45, z1: padZ + 1.45, y: y, bounce: v, pad: skin, squash: 0 });

  const lz = padZ + 2.6 + d * 0.6;
  // stays long at high difficulty, or the launch can overshoot the far edge
  const len = 7 - d * 1.2 + rand(0, 2);
  addPlatform(c, lz, lz + len, y + rise, Math.max(2.4, 3.4 - d * 1.0), pickColor());
  c.est += 2.6 + len / RUN_SPEED;
  return { z: lz + len, y: y + rise };
}

function buildZip(c: Course, z: number, y: number, d: number): Cursor {
  const hex = pickColor();
  const frame = shade(hex, 0.5);
  const towerZ = z + 1.6;
  const topY = y + 4.4;
  const span = 9 + d * 5 + rand(0, 2);
  const drop = 2.4 + d * 1.2 - c.rise;   // a shallower wire lands the rise higher
  const endZ = towerZ + span;
  const endY = topY - drop;
  const landY = endY - 2.9;

  // start tower on the platform behind you, end tower on the landing pad
  tube(c.group, -1.3, (y + topY + 0.6) / 2, towerZ, 0.14, topY + 0.6 - y, frame);
  tube(c.group,  1.3, (y + topY + 0.6) / 2, towerZ, 0.14, topY + 0.6 - y, frame);
  tube(c.group, 0, topY + 0.3, towerZ, 0.13, 2.9, hex, "x");
  tube(c.group, -1.3, (landY + endY + 0.6) / 2, endZ, 0.14, endY + 0.6 - landY, frame);
  tube(c.group,  1.3, (landY + endY + 0.6) / 2, endZ, 0.14, endY + 0.6 - landY, frame);
  tube(c.group, 0, endY + 0.3, endZ, 0.13, 2.9, hex, "x");

  // the wire, tilted to run bar to bar
  const wireLen = Math.hypot(span, drop);
  pathWire(c.group, towerZ, topY + 0.3, endZ, endY + 0.3, 0.05, 0xf0e2c0);

  // the trolley: wheel block, rope, fat handle
  const trolley = new THREE.Group();   // its parts are local, placed by zipSync
  c.group.add(trolley);
  box(trolley, 0, 0.04, 0, 0.36, 0.3, 0.46, hex);
  tube(trolley, 0, -0.5, 0, 0.06, 1.0, 0xf0e2c0);
  box(trolley, 0, -1.05, 0, 0.9, 0.28, 0.28, PALETTE[3]);

  const g: ZipGrab = { kind: "zip", zA: towerZ + 0.35, yA: topY + 0.28, zB: endZ, yB: endY + 0.3,
                       hang: 1.05, wireLen: wireLen, t: 0, speed: 0, node: trolley };
  zipSync(g, false);
  c.grabs.push(g);

  const lz = endZ - 1.5;
  const len = 7.5 - d * 2.2 + rand(0, 2);
  addPlatform(c, lz, lz + len, landY, Math.max(2.4, 3.4 - d * 1.0), pickColor());
  c.est += 1.8 + wireLen / 7 + len / RUN_SPEED;
  return { z: lz + len, y: landY };
}

// wall ride: a plank wall beside the path over a gap. Jump at it holding
// forward and you stick and run along it; jump again to leap off the end
function buildWall(c: Course, z: number, y: number, d: number): Cursor {
  const gap = 1.5 + d * 0.5;
  const len = 6 + d * 5 + rand(0, 1.5);
  const z0 = z + gap, z1 = z0 + len;
  // the straight course alternates sides; on the tower the wall is always on
  // the outside of the coil (-x is away from the tower)
  const side = isTower() ? -1 : (Math.random() < 0.5 ? -1 : 1);
  const rise = c.rise;
  const yb = y - 1.6, yt = y + 3.2;      // the band of foot heights that sticks
  const hex = pickColor();
  const frame = shade(hex, 0.5);
  const tilt = Math.atan2(rise, len);    // the tower's wall climbs with the coil
  // short plank panels so only the piece next to the lens fades, never the
  // stretch the ninja is running on
  const n = Math.max(1, Math.ceil(len / 1.9));
  const seg = len / n;
  // the wall stands out at the edge of the path; the ninja shifts over to it
  const wx = side * WALL_X;
  for (let i = 0; i < n; i++) {
    const zc = z0 + seg * (i + 0.5);
    const yc = rise * (i + 0.5) / n;
    box(c.group, wx, (yb + yt) / 2 + yc, zc, 0.3, yt - yb, seg + 0.04, hex).rotateX(-tilt);
    // three dark plank lines on the face the ninja runs on
    for (let s = 1; s <= 3; s++) {
      box(c.group, wx - side * 0.17, yb + 1.2 * s + yc, zc, 0.06, 0.1, seg + 0.04, frame).rotateX(-tilt);
    }
  }
  // posts at each end
  tube(c.group, wx, (yb + yt) / 2, z0, 0.16, yt - yb + 0.8, frame);
  tube(c.group, wx, (yb + yt) / 2 + rise, z1, 0.16, yt - yb + 0.8, frame);
  c.grabs.push({ kind: "wall", z0: z0, z1: z1, y0: yb, y1: yt, rise: rise, side: side });

  // the landing sits a little low so an easy wall can be run straight off;
  // the gap after it grows with d until only a jump-off makes it
  const lz = z1 + 0.8 + d * 1.8;
  const ly = y - 0.7 + rise;
  const landLen = 7 - d * 2.4 + rand(0, 2);
  addPlatform(c, lz, lz + landLen, ly, Math.max(2.4, 3.4 - d * 1.0), pickColor());
  c.est += 1.2 + len / WALL_SPEED + landLen / RUN_SPEED;
  return { z: lz + landLen, y: ly };
}

// the warped wall: every level's finale. A flat run-up, then a quarter-circle
// ramp you run up, topped by a short vertical lip; jump near the top of the
// curve to grab the ledge and pull up onto the summit. Returns the far end
// of the summit, where the podium goes.
function buildWarp(c: Course, z: number, y: number): Cursor {
  const d = c.d;
  y += c.rise;
  const runZ0 = z + 2.0 + d * 1.4;
  const runLen = 10;
  const z0 = runZ0 + runLen;             // the base of the curve
  const r = 4.5 + d * 2.0;               // height (and depth) of the curve
  const z1 = z0 + r;
  const top = y + r;                     // the top of the curve; the ledge is WARP_LIP higher
  const ledge = top + WARP_LIP;
  // the run-up carries on a touch under the base so the feet are still on
  // the ground when they reach it
  addPlatform(c, runZ0, z0 + 0.4, y, 4.0, pickColor());

  const hex = 0xff4d4d;                  // the classic red
  const body = shade(hex, 0.42);
  const L = r * Math.PI / 2;
  // the curved skin: short slabs, each tilted to the arc's tangent and pushed
  // half their thickness out from the arc so the surface is the arc itself
  const n = Math.max(10, Math.round(L / 0.5));
  const seg = L / n;
  const h = 0.5;
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * Math.PI / 2;
    const zc = z0 + r * Math.sin(a) + (h / 2) * Math.sin(a);
    const yc = y + r * (1 - Math.cos(a)) - (h / 2) * Math.cos(a);
    box(c.group, 0, yc, zc, 4.0, h, seg + 0.06, hex).rotateX(-a);
    // pale edge rails down both sides
    box(c.group, -1.92, yc + 0.25, zc, 0.18, 0.08, seg + 0.06, 0xfff2f2).rotateX(-a);
    box(c.group,  1.92, yc + 0.25, zc, 0.18, 0.08, seg + 0.06, 0xfff2f2).rotateX(-a);
  }
  // the body under the skin: stepped dark columns up to the curve. Each stops
  // at the surface height of its *rear* edge, where the curve is lowest, so
  // no step pokes up through the skin where the wall steepens
  const m = 16;
  const dz = r / m;
  const bottom = y - 1.4;
  const arc: WarpGrab = { kind: "warp", z0: z0, y0: y, r: r, lip: WARP_LIP, p: 0, u: 0 };
  for (let j = 0; j < m; j++) {
    const zc = z0 + (j + 0.5) * dz;
    const ys = warpSurfaceY(arc, zc - dz / 2) - 0.2;
    const ch = ys - bottom;
    if (ch > 0.15) box(c.group, 0, bottom + ch / 2, zc, 3.6, ch, dz + 0.02, body);
  }
  // the lip: a vertical face from the top of the curve up to the ledge, with
  // the same pale rails, and a dark column filling in under the summit's edge
  box(c.group, 0, top + WARP_LIP / 2, z1 + h / 2, 4.0, WARP_LIP + 0.04, h, hex);
  box(c.group, -1.92, top + WARP_LIP / 2, z1 - 0.03, 0.18, WARP_LIP - 0.1, 0.08, 0xfff2f2);
  box(c.group,  1.92, top + WARP_LIP / 2, z1 - 0.03, 0.18, WARP_LIP - 0.1, 0.08, 0xfff2f2);
  box(c.group, 0, (bottom + ledge - 0.5) / 2, z1 + 0.7, 3.6, ledge - 0.5 - bottom, 1.2, body);
  c.grabs.push(arc);

  // the summit, starting right at the ledge (flush with the lip's face, so
  // nothing overhangs the hands and head during the hang)
  const sumLen = 5.5;
  addPlatform(c, z1, z1 + sumLen, ledge, 4.0, pickColor());
  c.est += 1.2 + (runLen + 0.4) / RUN_SPEED + 2.8 + 1.4 + sumLen / RUN_SPEED;   // 1.4: the leap, catch and pull-up
  return { z: z1 + sumLen, y: ledge };
}

// ---- warped wall geometry. The arc is a quarter circle centred on
// (z0, y0 + r): a = p * pi/2 runs from the flat base to the vertical top ----
export function warpPos(g: WarpGrab, p: number, out: { z: number; y: number }): void {
  const a = p * Math.PI / 2;
  out.z = g.z0 + g.r * Math.sin(a);
  out.y = g.y0 + g.r * (1 - Math.cos(a));
}
// height of the surface at distance z along the base
export function warpSurfaceY(g: WarpGrab, z: number): number {
  const dz = clamp(z - g.z0, 0, g.r);
  return g.y0 + g.r - Math.sqrt(Math.max(0, g.r * g.r - dz * dz));
}
// how far along the base the surface is at height y
export function warpSurfaceZ(g: WarpGrab, y: number): number {
  const dy = clamp(g.y0 + g.r - y, 0, g.r);
  return g.z0 + Math.sqrt(Math.max(0, g.r * g.r - dy * dy));
}
// arc angle of the surface point at height y
export function warpAngleAtY(g: WarpGrab, y: number): number {
  return Math.acos(clamp((g.y0 + g.r - y) / g.r, -1, 1));
}

// puts the trolley (and optionally the player) at the wire position for g.t
export function zipSync(g: ZipGrab, withPlayer: boolean): void {
  const cz = g.zA + (g.zB - g.zA) * g.t;
  const cy = g.yA + (g.yB - g.yA) * g.t;
  if (g.node) placeOnPath(g.node, cz, 0, cy);
  if (withPlayer) {
    player.z = cz;
    player.y = cy - g.hang - HAND_H;
  }
}

// ---- the podium ----
function buildPodium(c: Course, z: number, y: number): Cursor {
  const g = c.group;
  const pz = z + 3.2;                     // centre of the gold block
  const baseY = y;
  const goldTop = baseY + 2.2;

  // base plate the player runs onto
  addPlatform(c, z, pz + 1.1, baseY, 8, 0x2f7fd0);
  // the three steps (2nd, 1st, 3rd) sitting on the plate
  box(g, -2.7, baseY + 0.8, pz, 2.3, 1.6, 2.2, 0xd8e2ec, true);   // silver
  box(g,  2.7, baseY + 0.55, pz, 2.3, 1.1, 2.2, 0xd07a34, true);  // bronze
  box(g,  0,   baseY + 1.1, pz, 2.3, 2.2, 2.2, 0xffcf2e, true);   // gold
  box(g, -2.7, baseY + 1.63, pz, 2.42, 0.14, 2.32, 0xf6fbff);
  box(g,  2.7, baseY + 1.13, pz, 2.42, 0.14, 2.32, 0xf0a666);
  box(g,  0,   baseY + 2.23, pz, 2.42, 0.14, 2.32, 0xfff0a8);

  // finish arch with a chequered banner
  for (let s = -1; s <= 1; s += 2) {
    tube(g, s * 4.4, baseY + 2.6, pz - 1.4, 0.18, 5.2, 0xff2e88);
    box(g, s * 4.4, baseY + 5.3, pz - 1.4, 0.6, 0.6, 0.6, 0xffe200, true);
  }
  box(g, 0, baseY + 4.9, pz - 1.4, 8.8, 0.9, 0.24, 0x16324f);
  for (let i = 0; i < 11; i++) {
    box(g, -4.0 + i * 0.8, baseY + 4.9, pz - 1.35, 0.8, 0.42, 0.1, i % 2 ? 0xffffff : 0x16324f);
    box(g, -4.0 + i * 0.8, baseY + 4.9 - 0.42, pz - 1.35, 0.8, 0.42, 0.1, i % 2 ? 0x16324f : 0xffffff);
  }

  // the gold top is the goal
  c.platforms.push({ z0: pz - 1.15, z1: pz + 1.15, y: goldTop, isPodium: true });
  // and the block itself stops you running straight through
  c.blockers.push({ z0: pz - 1.15, z1: pz + 1.15, top: goldTop });

  // a spinning gold star marks the goal
  const star = new THREE.Mesh(GEO.oct, starMat);
  placeOnPath(star, pz, 0, goldTop + 1.7);
  star.scale.setScalar(0.6);
  g.add(star);
  c.podium = { z: pz, y: goldTop, baseY: baseY, star: star, starY: goldTop + 1.7 };

  return { z: pz + 1.1, y: goldTop };
}

const BUILDERS = { gap: buildGap, rail: buildRail, swing: buildSwing, lache: buildLache, climb: buildClimb,
                   bounce: buildBounce, zip: buildZip, wall: buildWall } satisfies Record<string, Builder>;
type ObstacleKind = keyof typeof BUILDERS;

// testing: ?test=warp builds a course that is just the run-up and the warped
// wall; ?test=<obstacle> (gap, rail, swing, lache, climb, bounce, zip, wall)
// builds one of that rig and then the finale
const testParam = /[?&]test=(\w+)/.exec(location.search);
export const testObstacle: ObstacleKind | "warp" | null =
  testParam && (testParam[1] === "warp" || testParam[1] in BUILDERS) ? testParam[1] as ObstacleKind | "warp" : null;

export function generateCourse(index: number, startZ: number, startY: number): Course {
  const d = clamp((index - 1) / 9, 0, 1);
  const c: Course = {
    index: index, group: new THREE.Group(), platforms: [], grabs: [], blockers: [],
    geos: [], bunt: { pos: [], col: [] }, est: 0, podium: null,
    startZ: startZ, startY: startY, d: d,
    rise: isTower() ? TOWER_RISE : 0,     // how much each obstacle climbs the coil
    fadeMeshes: [], parTime: 0, endZ: 0, endY: 0, spawn: { z: startZ + 2.0, y: startY }
  };
  c.group.userData.path = true;           // its parts take course coordinates
  scene.add(c.group);

  let z = startZ, y = startY;
  const runLen = index === 1 ? 15 : 10;
  addPlatform(c, z, z + runLen, y, 4.0, index === 1 ? 0x00e0ff : pickColor());
  c.est += runLen / RUN_SPEED;
  z += runLen;

  // which obstacles are unlocked at this level
  const bag: ObstacleKind[] = ["gap", "gap", "gap", "rail"];
  if (index >= 2) bag.push("swing", "gap", "bounce", "wall");
  if (index >= 3) bag.push("lache", "climb", "swing");
  if (index >= 4) bag.push("zip", "bounce");
  if (index >= 5) bag.push("lache", "swing", "rail", "zip", "wall");

  if (testObstacle) {
    // test mode: straight to the rig under test (or to the finale itself)
    if (testObstacle !== "warp") {
      const r = BUILDERS[testObstacle](c, z, y, d);
      z = r.z; y = r.y;
    }
  } else {
    const n = Math.min(12, 5 + Math.floor((index - 1) * 0.8));
    let last: ObstacleKind | "" = "";
    for (let i = 0; i < n; i++) {
      let t = bag[(Math.random() * bag.length) | 0];
      if (t === last && t !== "gap") t = "gap";   // avoid the same rig twice in a row
      last = t;
      const r = BUILDERS[t](c, z, y, d);
      z = r.z; y = r.y;
    }
  }

  // the finale: run up the warped wall, and the podium waits on the summit
  const w = buildWarp(c, z, y);
  const end = buildPodium(c, w.z, w.y);

  finishBunting(c);
  collectFadeMeshes(c);
  // est is a generous walk-through estimate; par sits a little under it so a
  // tidy run earns gold, a normal one silver, and a scrappy one bronze
  c.parTime = c.est * 0.9 + 1.3;
  c.endZ = end.z;
  c.endY = end.y;
  return c;
}

// =============================================================================
// near-camera fade: scenery right in front of the lens turns see-through so it
// never hides the ninja
// =============================================================================
const FADE_START = 5.5;   // metres from the camera where the fade begins
const FADE_END   = 2.0;   // fully faded by here
const FADE_MIN   = 0.12;  // faded things stay faintly visible

const fadeBox = new THREE.Box3();
function collectFadeMeshes(c: Course): void {
  c.fadeMeshes = [];
  c.group.updateMatrixWorld(true);
  c.group.traverse(function (o) {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.material === buntMat) return;   // one merged strip spans the course
    m.userData.fadeOp = 1;
    // world-aligned half extents, so parts turned to follow the coil still
    // measure right
    fadeBox.setFromObject(m);
    m.userData.fadeHalf = [
      (fadeBox.max.x - fadeBox.min.x) / 2,
      (fadeBox.max.y - fadeBox.min.y) / 2,
      (fadeBox.max.z - fadeBox.min.z) / 2
    ];
    c.fadeMeshes.push(m);
  });
}

const fadeV = new THREE.Vector3();
export function updateNearFade(dt: number): void {
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    if (!c.fadeMeshes) continue;
    // whole course nowhere near the lens - skip it (the camera trails by 8.4)
    if (player.z < c.startZ - 34 || player.z > c.endZ + 25) continue;
    for (let j = 0; j < c.fadeMeshes.length; j++) {
      const m = c.fadeMeshes[j];
      m.getWorldPosition(fadeV);
      const half = m.userData.fadeHalf as [number, number, number];
      // distance from the camera to the mesh's box, not its centre, so long
      // slabs only fade when their near edge really reaches the lens
      const dx = Math.max(0, Math.abs(fadeV.x - camera.position.x) - half[0]);
      const dy = Math.max(0, Math.abs(fadeV.y - camera.position.y) - half[1]);
      const dz = Math.max(0, Math.abs(fadeV.z - camera.position.z) - half[2]);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let target = clamp((dist - FADE_END) / (FADE_START - FADE_END), 0, 1);
      target = FADE_MIN + (1 - FADE_MIN) * target;
      const op = damp(m.userData.fadeOp, target, 12, dt);
      m.userData.fadeOp = op;
      if (op < 0.995) {
        if (!m.userData.fadeMat) {
          m.userData.baseMat = m.material;
          const fm = (m.material as THREE.Material).clone();
          fm.transparent = true;
          m.userData.fadeMat = fm;
        }
        (m.userData.fadeMat as THREE.Material).opacity = op;
        m.material = m.userData.fadeMat;
      } else if (m.userData.baseMat && m.material !== m.userData.baseMat) {
        m.material = m.userData.baseMat;
      }
    }
  }
}

// geometries and materials are shared, so only the per course merged bunting
// buffer actually needs freeing
export function disposeCourse(c: Course): void {
  scene.remove(c.group);
  for (let i = 0; i < c.geos.length; i++) c.geos[i].dispose();
  c.geos.length = 0;
  if (c.fadeMeshes) {
    for (let f = 0; f < c.fadeMeshes.length; f++) {
      const fm = c.fadeMeshes[f].userData.fadeMat as THREE.Material | undefined;
      if (fm) fm.dispose();
    }
    c.fadeMeshes.length = 0;
  }
  c.group.clear();
  c.platforms.length = 0;
  c.grabs.length = 0;
  c.blockers.length = 0;
}

export function clearCourses(): void {
  for (let i = 0; i < courses.length; i++) disposeCourse(courses[i]);
  courses.length = 0;
}

// =============================================================================
// per-frame rig animation
// =============================================================================
// hanging ropes sway gently on their own, and follow the player when held
export function animateRopes(now: number, dt: number): void {
  for (let i = 0; i < grabs.length; i++) {
    const g = grabs[i];
    if (g.kind !== "pend" || !g.node) continue;
    if (Math.abs(g.pz - player.z) > 70) continue;
    if (player.hang === g) g.theta = player.theta;
    else g.theta = damp(g.theta || 0, Math.sin(now * 0.0012 + g.pz * 0.7) * 0.07, 2.5, dt);
    g.node.rotation.x = -g.theta;
  }
}

// trampoline skins dip on impact and spring back
export function updatePads(dt: number): void {
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    if (!p.pad || !p.squash) continue;
    p.squash = damp(p.squash, 0, 7, dt);
    if (p.squash < 0.01) p.squash = 0;
    p.pad.scale.y = 0.28 * (1 - 0.7 * p.squash);
    p.pad.position.y = p.y - 0.14 - 0.4 * p.squash;
  }
}

export function updateStars(now: number): void {
  for (let i = 0; i < courses.length; i++) {
    const p = courses[i].podium;
    if (!p || !p.star) continue;
    p.star.rotation.y = now * 0.002;
    p.star.position.y = p.starY + Math.sin(now * 0.004 + p.z) * 0.18;
  }
}

// the swing handle position for a pendulum grab (rope or bare bar)
export function handleZ(g: PendGrab): number { return g.pz + g.ropeLen * Math.sin(g.theta || 0); }
export function handleY(g: PendGrab): number { return g.py - g.ropeLen * Math.cos(g.theta || 0); }
