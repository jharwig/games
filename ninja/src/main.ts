// =============================================================================
// Ninja Adventure - composition root and all game rules: the run / level flow,
// world queries, grabs and releases, the fixed-step update and the frame loop
// =============================================================================
import {
  applyMute, audio, initAudio, pumpMusic, sfxBounce, sfxFall, sfxGrab, sfxJump, sfxLand,
  sfxMedal, sfxStep, sfxWhoosh, startMusic
} from "./audio";
import { camImpulse, snapCamera, updateCamera } from "./camera";
import {
  AIR_ACCEL, AIR_DRAG, CLIMB_SPEED, COYOTE, EDGE_GRACE, FALL_LIMIT, FLIP_SPEED, GRAVITY,
  HAND_H, JUMP_CUT, JUMP_HOLD_MIN, JUMP_V, LEDGE_HOLD, LEDGE_PULL, LEDGE_STEP, MAX_FALL,
  PEND_DAMP, PUMP, RAIL_SPEED, RELEASE_LOCK, RUN_SPEED, State, WALL_SAG, WALL_SPEED,
  WARP_BOOST, WARP_PEAK, WARP_WINDOW, ZIP_ACCEL, ZIP_MAX, type Medal
} from "./constants";
import {
  type Course, type Platform, animateRopes, blockers, clearCourses, courses, disposeCourse,
  generateCourse, grabs, handleY, handleZ, platforms, rebuildWorldLists, updateNearFade,
  testObstacle, updatePads, updateStars, warpAngleAtY, warpPos, warpSurfaceZ, zipSync
} from "./course";
import { camera, renderer, resizeRenderer, scene, updateSun } from "./gfx";
import { autoForward, input, pressJump, setupInput } from "./input";
import {
  idleNinja, initCharacters, landSquash, poseAir, poseCelebrate, poseClimb, poseHang, poseLedge,
  poseRail, poseRun, poseWallRun, snapshotPose, syncNinja, tickPoseBlend, updateBlob, updatePony
} from "./ninja";
import { burstConfetti, puff, updateConfetti, updateDust } from "./particles";
import { bestKey, getMode, setModeValue } from "./path";
import { type Grab, type LedgeGrab, type WarpGrab, endTrick, player, startTrick, trimTrick } from "./player";
import { initBalloons, initClouds, updateBalloons, updateClouds, updateSky } from "./sky";
import * as ui from "./ui";
import { clamp, damp, roundTo2Pi, smoothstep, storeGet, storeSet } from "./util";

// =============================================================================
// game state
// =============================================================================
let state = State.TITLE;
// testing flags: ?level=N starts the run at that level, ?slow=N scales the
// clock (0.2 is one-fifth speed) so animations can be studied frame by frame
const urlParams = new URLSearchParams(location.search);
const startLevel = clamp(parseInt(urlParams.get("level") || "1", 10) || 1, 1, 10);
let slowMo = clamp(parseFloat(urlParams.get("slow") || "1") || 1, 0.02, 1);
let level = 1;
let podiums = 0;
let best = loadBest();
function loadBest(): number {
  const b = parseInt(storeGet(bestKey(), "0"), 10) || 0;
  return (!isFinite(b) || b < 0) ? 0 : b;
}
let medals: Medal[] = [];
let levelTime = 0;
let celebrateT = 0;
let fallT = 0;
const spawn = { z: 2, y: 0 };
let current: Course | null = null;    // the course being played

function toggleMute(): void {
  initAudio();
  audio.muted = !audio.muted;
  applyMute();
  ui.setMuteLabel(audio.muted);
}

function anyInput(): void {
  initAudio();
  if (state === State.TITLE) startRun();
}

setupInput({
  canvas: renderer.domElement,
  muteBtn: ui.muteBtn,
  titleEl: ui.titleEl,
  isTitle: () => state === State.TITLE,
  anyInput: anyInput,
  toggleMute: toggleMute
});

initCharacters([ui.titleChars, ui.podiumChars], function () {
  // give a moment on the podium to admire the new look
  if (state === State.CELEBRATE) celebrateT = Math.min(celebrateT, 0.4);
});

// =============================================================================
// world queries
// =============================================================================
function platformUnder(z: number, yFrom: number, yTo: number): Platform | null {
  // the highest platform top crossed while moving from yFrom down to yTo
  let bestP: Platform | null = null;
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    if (z < p.z0 - EDGE_GRACE || z > p.z1 + EDGE_GRACE) continue;
    if (yFrom >= p.y - 0.02 && yTo <= p.y + 0.02) {
      if (!bestP || p.y > bestP.y) bestP = p;
    }
  }
  return bestP;
}

function standingOn(z: number, y: number): Platform | null {
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    if (z < p.z0 - EDGE_GRACE || z > p.z1 + EDGE_GRACE) continue;
    if (Math.abs(y - p.y) < 0.06) return p;
  }
  return null;
}

// closest point on a grab and its distance from the hands
function grabDistance(g: Grab, hz: number, hy: number): number {
  if (g.kind === "pend") {
    if (g.ropeLen > 0.4) {
      // closest point on the rope segment, from the pivot down to the handle
      const ex = handleZ(g), ey = handleY(g);
      const dz = ex - g.pz, dy = ey - g.py;
      const t = clamp(((hz - g.pz) * dz + (hy - g.py) * dy) / (dz * dz + dy * dy || 1), 0, 1);
      const cz = g.pz + dz * t, cy = g.py + dy * t;
      return Math.hypot(hz - cz, hy - cy);
    }
    return Math.hypot(hz - g.pz, hy - g.py);
  }
  if (g.kind === "rail") {
    const z = clamp(hz, g.z0, g.z1);
    return Math.hypot(hz - z, hy - g.y);
  }
  if (g.kind === "climb") {
    const y = clamp(hy, g.y0, g.y1);
    return Math.hypot(hz - g.z, hy - y);
  }
  if (g.kind === "zip") {
    const cz2 = g.zA + (g.zB - g.zA) * g.t;
    const cy2 = g.yA + (g.yB - g.yA) * g.t - g.hang;
    return Math.hypot(hz - cz2, hy - cy2);
  }
  if (g.kind === "wall") {
    // a surface, not a handle: the feet stick when they reach the front of
    // the wall inside its height band, still running forward
    if (!input.forward || player.vz < 0.5) return Infinity;
    if (hz < g.z0 - 0.3 || hz > g.z0 + 2.0) return Infinity;
    const fy = hy - HAND_H;
    const k = clamp((hz - g.z0) / (g.z1 - g.z0), 0, 1);
    if (fy < g.y0 + g.rise * k || fy > g.y1 + g.rise * k) return Infinity;
    return 0;
  }
  return Infinity;   // the warped wall is reached by contact in updateFree, never grabbed
}

function grabZ(g: Grab): number {
  if (g.kind === "climb") return g.z;
  if (g.kind === "rail" || g.kind === "wall") return (g.z0 + g.z1) / 2;
  if (g.kind === "zip") return g.zA + (g.zB - g.zA) * g.t;
  if (g.kind === "warp") return g.z0 + g.r / 2;
  if (g.kind === "ledge") return g.z;
  return g.pz;
}

function tryGrab(radius: number): boolean {
  if (player.hang || player.releaseLock > 0) return false;
  const hz = player.z, hy = player.y + HAND_H;
  let bestG: Grab | null = null, bestD = radius;
  for (let i = 0; i < grabs.length; i++) {
    const g = grabs[i];
    if (Math.abs(grabZ(g) - hz) > 24) continue;   // cheap reject far away rigs
    const d = grabDistance(g, hz, hy);
    if (d < bestD) { bestD = d; bestG = g; }
  }
  if (!bestG) return false;
  attach(bestG);
  return true;
}

function attach(g: Grab): void {
  const preZ = player.z, preY = player.y;
  player.hang = g;
  // keep the leftover part of a flip; the hang pose damps it out smoothly
  // instead of snapping the body upright in one frame
  player.flip -= roundTo2Pi(player.flip);
  endTrick();            // no tricks while hanging, swinging or climbing
  snapshotPose();        // the arms swing up to the bar instead of popping
  player.hangT = 0;
  player.jumpBuf = 0;         // the press that grabbed must not also let go
  player.jumpCut = false;     // a grab ends the jump, so the lache is never cut
  // running onto the warped wall is just footsteps, and the ledge plays its
  // grab when the hands actually catch it at the top of the leap
  if (g.kind !== "warp" && g.kind !== "ledge") sfxGrab();
  if (g.kind === "pend") {
    const dz = player.z - g.pz;
    const dy = (player.y + HAND_H) - g.py;
    let th = Math.atan2(dz, -dy);
    if (!isFinite(th)) th = 0;
    player.theta = clamp(th, -1.3, 1.3);
    // carry the incoming speed into the swing
    const tz = Math.cos(player.theta), ty = Math.sin(player.theta);
    player.omega = clamp((player.vz * tz + player.vy * ty) / g.len, -4.5, 4.5);
    if (g.swing) g.theta = player.theta;
    applyPendulum(g);
  } else if (g.kind === "rail") {
    player.z = clamp(player.z, g.z0, g.z1);
    player.y = g.y - HAND_H;
  } else if (g.kind === "climb") {
    player.z = g.z;
    player.y = clamp(player.y, g.y0 - HAND_H + 0.4, g.y1 - HAND_H);
  } else if (g.kind === "zip") {
    // carry the run speed into the trolley
    g.speed = Math.max(2.5, player.vz * 0.8);
    zipSync(g, true);
  } else if (g.kind === "wall") {
    const len = g.z1 - g.z0;
    player.z = Math.max(player.z, g.z0);
    const k = clamp((player.z - g.z0) / len, 0, 1);
    player.y = clamp(player.y, g.y0 + g.rise * k + 0.2, g.y1 + g.rise * k - 0.2);
    player.omega = 0;
  } else if (g.kind === "warp") {
    // onto the arc at the point level with the feet; g.u was set by the caller
    g.p = warpAngleAtY(g, player.y) / (Math.PI / 2);
    warpPos(g, g.p, player);
    player.omega = 0;
  } else if (g.kind === "ledge") {
    player.omega = 0;   // the leap starts from where she is; updateLedge moves her
  }
  player.vz = 0; player.vy = 0;
  player.onGround = false;
  player.lastGroundY = Math.max(player.lastGroundY, player.y);
  // the grab can snap the body up to the grab radius in one step; keep the
  // difference as a visual offset that eases out, so the reach looks smooth
  player.visOffZ = clamp(preZ - player.z, -2.5, 2.5);
  player.visOffY = clamp(preY - player.y, -2.5, 2.5);
}

function applyPendulum(g: { pz: number; py: number; len: number }): void {
  player.z = g.pz + g.len * Math.sin(player.theta);
  player.y = g.py - g.len * Math.cos(player.theta);
}

function release(boost: boolean): void {
  const g = player.hang;
  if (!g) return;
  if (g.kind === "pend") {
    const vz = g.len * player.omega * Math.cos(player.theta);
    const vy = g.len * player.omega * Math.sin(player.theta);
    player.vz = vz * 1.3 + (vz > 0 ? 1.0 : 0);
    player.vy = vy * 1.3 + 2.0;
    if (g.ropeLen < 0.4) {
      // a weak lache still gets a usable hop to the next bar
      player.vz = Math.max(player.vz, 4.6);
      player.vy = Math.max(player.vy, 3.4);
    }
  } else if (g.kind === "rail") {
    player.vz = 5.8;
    player.vy = 4.6;
  } else if (g.kind === "climb") {
    player.vz = 5.8;
    player.vy = 6.2;
  } else if (g.kind === "zip") {
    player.vz = clamp(g.speed * 1.05 + 0.8, 4.5, 12);
    player.vy = 3.2;
  } else if (g.kind === "wall") {
    // a jump leaps off the wall; otherwise she is carried off the end at run speed
    if (boost) { player.vz = 6.6; player.vy = 5.6; }
    else { player.vz = WALL_SPEED; player.vy = 0; }
  } else if (g.kind === "warp") {
    player.vz = 0.5; player.vy = 3.0;   // a hop off the curve (the vault is handled in updateWarp)
  }
  if (boost) { player.vz += 0.4; player.vy += 0.4; }
  player.vz = clamp(player.vz, -6, 15);
  player.vy = clamp(player.vy, -14, 14);
  player.hang = null;
  endTrick();            // a lache keeps its own tumble, it is not a free jump
  snapshotPose();        // the hang pose folds into the tumble
  player.releaseLock = RELEASE_LOCK;
  player.air = 0.05;     // small, so the tumble winds up instead of snapping on
  sfxWhoosh();
}

// =============================================================================
// run / level flow
// =============================================================================
function startRun(): void {
  state = State.PLAYING;
  level = startLevel;
  podiums = 0;
  medals = [];
  levelTime = 0;
  clearCourses();
  current = generateCourse(level, 0, 0);
  courses.push(current);
  rebuildWorldLists();
  spawn.z = current.spawn.z;
  spawn.y = current.spawn.y;
  respawn();
  initClouds(0, player.y);
  initBalloons(0, player.y);

  ui.showPlayScreen();
  ui.renderMedals(medals);
  ui.updateHud(level, best, levelTime);
  startMusic();
  ui.showTip("Hold forward, jump the gaps - and run up the warped wall at the end!", 3.6);
  // snap the camera behind the player right away
  snapCamera(spawn.z - 8.4, spawn.y + 3.4, spawn.z + 5.0, spawn.y + 1.4);
}

function respawn(): void {
  player.z = spawn.z;
  player.y = spawn.y;
  player.vz = 0; player.vy = 0;
  player.hang = null;
  player.onGround = true;
  player.coyote = COYOTE;
  player.jumpBuf = 0;
  player.flip = 0;
  player.twist = 0;
  endTrick();
  snapshotPose();
  player.visOffZ = 0; player.visOffY = 0;
  player.releaseLock = 0;
  player.air = 0;
  player.lastGroundY = spawn.y;
  // any used zipline trolleys ride back up to their start towers
  for (let i = 0; i < grabs.length; i++) {
    const g = grabs[i];
    if (g.kind === "zip") { g.t = 0; g.speed = 0; zipSync(g, false); }
  }
  levelTime = 0;
  state = State.PLAYING;
  ui.fallMsg.classList.remove("visible");
}

function completeLevel(): void {
  const c = current!;
  const t = levelTime;
  const par = c.parTime;
  const kind: Medal = t < par ? "gold" : (t < par * 1.5 ? "silver" : "bronze");
  medals.push(kind);
  podiums++;
  if (podiums > best) {
    best = podiums;
    storeSet(bestKey(), String(best));
  }
  ui.renderMedals(medals);
  ui.updateHud(level, best, levelTime);

  state = State.CELEBRATE;
  celebrateT = 0;
  player.vz = 0; player.vy = 0;
  player.hang = null;
  player.flip = 0;
  endTrick();
  snapshotPose();

  const p = c.podium!;
  burstConfetti(0, p.y + 1.0, p.z);
  camImpulse(0.45);
  sfxMedal(kind);
  ui.showBanner(kind, podiums, t, par);

  // the next course starts right off the back of the podium
  const next = generateCourse(level + 1, p.z + 1.15, p.y);
  courses.push(next);
  if (courses.length > 2) disposeCourse(courses.shift()!);
  rebuildWorldLists();
  current = next;
  spawn.z = p.z;
  spawn.y = p.y;
}

function endCelebrate(): void {
  ui.hideBanner();
  snapshotPose();   // the cheer pose blends back into the run
  level++;
  levelTime = 0;
  player.z = spawn.z;
  player.y = spawn.y;
  player.vy = 0; player.vz = 0;
  player.onGround = true;
  player.coyote = COYOTE;
  player.air = 0;
  player.lastGroundY = spawn.y;
  state = State.PLAYING;
  ui.updateHud(level, best, levelTime);
  if (level === 2) ui.showTip("Level 2 - ropes, trampolines and wall rides: keep running, then jump off!", 3.4);
  else if (level === 3) ui.showTip("Level 3 - lache bars and rope climbs", 3.0);
  else if (level === 4) ui.showTip("Level 4 - jump for the zipline handle!", 3.0);
}

function startFall(): void {
  state = State.FALLING;
  fallT = 0;
  endTrick();
  snapshotPose();
  player.hang = null;
  camImpulse(0.3);
  sfxFall();
  ui.fallMsg.classList.add("visible");
}

// =============================================================================
// per frame update
// =============================================================================
function update(dt: number): void {
  const jumpPressed = input.jumpEdge;
  input.jumpEdge = false;

  if (state === State.TITLE) {
    idleNinja(dt);
    return;
  }

  if (state === State.CELEBRATE) {
    celebrateT += dt;
    // a happy little bounce on the top step
    player.z = damp(player.z, spawn.z, 8, dt);
    player.y = spawn.y + Math.abs(Math.sin(celebrateT * 6.2)) * 0.5;
    poseCelebrate(dt, celebrateT);
    if (celebrateT > 2.5) endCelebrate();
    return;
  }

  if (state === State.FALLING) {
    fallT += dt;
    player.air += dt;   // keeps the tumble wind-up going in poseAir
    player.vy = Math.max(player.vy - GRAVITY * dt, -MAX_FALL);
    player.y += player.vy * dt;
    player.z += player.vz * dt;
    player.flip += FLIP_SPEED * 0.55 * dt;
    poseAir(dt);
    if (fallT > 1.15) respawn();
    return;
  }

  // ---------------- PLAYING ----------------
  levelTime += dt;
  if (player.releaseLock > 0) player.releaseLock -= dt;
  if (player.jumpBuf > 0) player.jumpBuf -= dt;

  if (player.hang) {
    updateHanging(dt, jumpPressed);
  } else {
    updateFree(dt, jumpPressed);
  }

  // fell off the world?
  if (!player.hang && player.y < player.lastGroundY - FALL_LIMIT) startFall();
}

function updateHanging(dt: number, jumpPressed: boolean): void {
  const g = player.hang!;
  player.hangT += dt;

  if (g.kind === "pend") {
    // pendulum + a little pumping while the run key is held
    const alpha = -(GRAVITY / g.len) * Math.sin(player.theta) - PEND_DAMP * player.omega;
    player.omega += alpha * dt;
    if (input.forward && Math.abs(player.theta) < 1.15) {
      // bare bars (the lache) get a stronger kip than the long ropes
      const pump = PUMP * (g.ropeLen < 0.4 ? 1.7 : 1);
      player.omega += pump * Math.sign(player.omega || 1) * dt;
    }
    player.omega = clamp(player.omega, -5, 5);
    player.theta += player.omega * dt;
    player.theta = clamp(player.theta, -1.45, 1.45);
    if (g.swing) g.theta = player.theta;
    applyPendulum(g);
    poseHang(dt, player.theta * 0.5);
  } else if (g.kind === "rail") {
    if (input.forward) {
      player.z += RAIL_SPEED * dt;
      if (player.z > g.z1) {
        player.z = g.z1;
        // drop off the far end automatically so nobody gets stuck
        release(false);
        return;
      }
    }
    player.y = g.y - HAND_H;
    poseRail(dt);
  } else if (g.kind === "climb") {
    if (input.forward) {
      player.y += CLIMB_SPEED * dt;
      if (player.y > g.y1 - HAND_H) player.y = g.y1 - HAND_H;
    }
    player.z = g.z;
    poseClimb(dt);
  } else if (g.kind === "zip") {
    // the trolley rolls downhill on its own and only ever speeds up
    g.speed = Math.min(ZIP_MAX, g.speed + ZIP_ACCEL * dt);
    g.t += (g.speed * dt) / g.wireLen;
    if (g.t >= 1) {
      g.t = 1;
      zipSync(g, true);
      // fly off the end of the wire onto the landing pad
      release(false);
      return;
    }
    zipSync(g, true);
    poseHang(dt, 0.3);
  } else if (g.kind === "wall") {
    if (!input.forward) {
      // stopped running: the feet peel off the wall
      release(false);
      player.vz = 3.0;
      return;
    }
    const len = g.z1 - g.z0;
    player.z += WALL_SPEED * dt;
    player.y += (WALL_SPEED * g.rise / len - WALL_SAG) * dt;   // climbs with the coil, slips a little
    const k = clamp((player.z - g.z0) / len, 0, 1);
    if (player.z > g.z1 || player.y < g.y0 + g.rise * k) {
      // carried off the far end, or slipped off the bottom of the wall
      release(false);
      return;
    }
    poseWallRun(dt, 0.28, g.side * 0.45, WALL_SPEED, 1);
  } else if (g.kind === "warp") {
    updateWarp(g, dt, jumpPressed);
    return;
  } else if (g.kind === "ledge") {
    updateLedge(g, dt);
    return;
  }

  if (player.hangT > 0.12 && (jumpPressed || player.jumpBuf > 0)) {
    player.jumpBuf = 0;
    release(true);
  }
}

// the warped wall: a run up the arc that slows as it climbs. A full-speed
// run just reaches the top; jump from the upper part to vault the ledge, or
// slide back down to the base and go again
function updateWarp(g: WarpGrab, dt: number, jumpPressed: boolean): void {
  const L = g.r * Math.PI / 2;
  const u0 = RUN_SPEED * WARP_BOOST;
  const A = (u0 * u0) / (2 * L * WARP_PEAK);   // the slow-down that lets a full run reach the top
  let decel = A;
  if (g.u > 0 && !input.forward) decel = A * 3;   // stopped running: the wall wins quickly
  else if (g.u < 0) decel = A * 0.7;             // the slide back is a little gentler
  g.u -= decel * dt;
  g.p += g.u * dt / L;
  if (g.p >= 1) { g.p = 1; if (g.u > 0) g.u = 0; }

  if (g.p <= 0 && g.u <= 0) {
    // slid back down to the base: back on the run-up, ready for another go
    const preZ = player.z;
    player.hang = null;
    player.z = g.z0 - 0.9;
    player.y = g.y0;
    player.vz = -2.0; player.vy = 0;
    player.onGround = true;
    player.coyote = COYOTE;
    player.air = 0;
    player.lastGroundY = g.y0;
    player.releaseLock = RELEASE_LOCK;
    player.visOffZ = clamp(preZ - player.z, -2.5, 2.5);
    endTrick();
    snapshotPose();
    landSquash(0.12, 0.4);
    puff(0, g.y0, player.z, 6, 0.35, 1.6);
    sfxLand();
    return;
  }

  warpPos(g, g.p, player);
  const a = g.p * Math.PI / 2;
  // the feet stand a touch off the surface along its normal, so the body
  // never sinks into the ramp as it steepens
  player.z -= 0.22 * Math.sin(a);
  player.y += 0.22 * Math.cos(a);
  // a sprint lean at the bottom; higher up the torso may lean forward only
  // as far as the wall's tangent, so it stays just clear of the surface.
  // The stride shortens too, or the forward foot would swing into the wall
  const lean = Math.min(0.3, Math.PI / 2 - a - 0.2);
  const stride = clamp(1 - g.p * 0.7, 0.3, 1);
  poseWallRun(dt, lean, 0, g.u, stride);

  if (player.hangT > 0.12 && (jumpPressed || player.jumpBuf > 0)) {
    player.jumpBuf = 0;
    if (g.p >= WARP_WINDOW) {
      // high enough: leap up, catch the ledge with both hands and pull up
      startLedge(g);
    } else {
      // too early: a little hop off the curve, and gravity brings her back onto it
      player.vz = 0.5; player.vy = 3.0;
      leaveWarp();
      sfxWhoosh();
    }
  }
}

function leaveWarp(): void {
  player.hang = null;
  endTrick();
  snapshotPose();
  player.releaseLock = RELEASE_LOCK;
  player.air = 0.05;
}

// the ledge: from high on the arc she leaps straight up the wall, the hands
// catch the edge right at the top of the leap, she holds the grip for a beat
// and pulls herself up and over onto the summit. The whole thing is scripted
// (no free flight), so the catch always lands on the edge
function startLedge(w: WarpGrab): void {
  const zEdge = w.z0 + w.r, top = w.y0 + w.r + w.lip;
  const zL = player.z, yL = player.y;
  // the hands catch the edge. From the window the body ends up hanging under
  // it with the arms straight; from the very top of the curve, where the
  // chest is nearly level with the ledge already, it is a short hop and a
  // catch at chest height
  const yH = Math.max(top - HAND_H, yL + 0.35);
  const zH = warpSurfaceZ(w, yH) - 0.3;   // the body just clear of the lip under the edge
  const vy = Math.sqrt(2 * GRAVITY * (yH - yL));
  const g: LedgeGrab = {
    kind: "ledge", z: zEdge, y: top, t: 0,
    zL: zL, yL: yL, zH: zH, yH: yH, leapT: vy / GRAVITY, vy: vy
  };
  attach(g);
  sfxJump();
}

function updateLedge(g: LedgeGrab, dt: number): void {
  const t0 = g.t;
  g.t += dt;
  const t = g.t;
  if (t < g.leapT) {
    // the leap: a ballistic rise that peaks where the hands meet the edge
    const k = t / g.leapT;
    player.z = g.zL + (g.zH - g.zL) * k;
    player.y = g.yL + g.vy * t - 0.5 * GRAVITY * t * t;
    poseLedge(dt, g.z - player.z, g.y - player.y, -1);
    return;
  }
  if (t0 < g.leapT) {
    // the catch: the hands take the weight and the body sags into the hang
    player.z = g.zH; player.y = g.yH;
    player.visOffY = 0.14;
    sfxGrab();
  }
  const m = clamp((t - g.leapT - LEDGE_HOLD) / LEDGE_PULL, 0, 1);
  // the body pulls up first, then swings forward over the edge
  const up = smoothstep(clamp(m / 0.65, 0, 1));
  const over = smoothstep(clamp((m - 0.5) / 0.5, 0, 1));
  player.y = g.yH + (g.y - g.yH) * up;
  player.z = g.zH + (g.z + LEDGE_STEP - g.zH) * over;
  poseLedge(dt, g.z - player.z, g.y - player.y, m);
  if (m >= 1) {
    // on her feet on the summit
    player.hang = null;
    player.onGround = true;
    player.vz = input.forward ? RUN_SPEED * 0.6 : 1.0;
    player.vy = 0;
    player.coyote = COYOTE;
    player.air = 0;
    player.lastGroundY = g.y;
    player.releaseLock = 0;
    endTrick();
    snapshotPose();
    landSquash(0.1, 0.3);
    puff(0, g.y + 0.02, player.z, 4, 0.3, 1.2);
    sfxStep();
  }
}

function updateFree(dt: number, jumpPressed: boolean): void {
  // horizontal
  if (player.onGround) {
    player.vz = input.forward ? damp(player.vz, RUN_SPEED, 14, dt) : damp(player.vz, 0, 9, dt);
  } else {
    if (input.forward) player.vz = Math.min(RUN_SPEED, player.vz + AIR_ACCEL * dt);
    else player.vz = Math.max(0, player.vz - AIR_DRAG * dt);
  }

  // jump
  if ((jumpPressed || player.jumpBuf > 0) && (player.onGround || player.coyote > 0)) {
    player.vy = JUMP_V;
    player.onGround = false;
    player.coyote = 0;
    player.jumpBuf = 0;
    player.air = 0;
    player.jumpCut = true;   // a short press can still cut this rise short
    player.jumpHold = 0;
    startTrick(JUMP_V);      // a fresh random trick for every free jump
    snapshotPose();          // the run stride blends into the take off pose
    sfxJump();
    puff(0, player.y + 0.05, player.z, 5, 0.3, 1.4);
  } else if (jumpPressed || player.jumpBuf > 0) {
    // in the air: space reaches out for a rope or bar
    if (tryGrab(2.3 - 0.35 * (current ? current.d : 0))) {
      player.jumpBuf = 0;
      return;
    }
  }

  // variable jump height: hold for the full arc, let go early for a hop
  if (player.jumpCut) {
    player.jumpHold += dt;
    if (player.vy <= 0) {
      player.jumpCut = false;
    } else if (!input.jump && player.jumpHold >= JUMP_HOLD_MIN) {
      player.vy *= JUMP_CUT;
      player.jumpCut = false;
      trimTrick(player.vy);  // a hop gets a quick trick, or just a pose
    }
  }

  const prevY = player.y;
  if (!player.onGround) {
    player.vy = Math.max(player.vy - GRAVITY * dt, -MAX_FALL);
    player.air += dt;
  }
  player.y += player.vy * dt;
  player.z += player.vz * dt;

  // podium blocks: you must jump onto them, not through them
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    if (player.y < b.top - 0.2 && player.z + 0.34 > b.z0 && player.z < b.z1) {
      player.z = b.z0 - 0.34;
      if (player.vz > 0) player.vz = 0;
    }
  }

  // forgiving auto-grab so bars catch you even without a perfect press
  if (!player.onGround && player.air > 0.14) {
    tryGrab(1.45 - 0.3 * (current ? current.d : 0));
    if (player.hang) return;
  }

  // landing
  if (player.vy <= 0) {
    const p = platformUnder(player.z, prevY, player.y);
    if (p && p.bounce) {
      // trampoline: never lands, just fires the ninja back up
      player.y = p.y;
      player.vy = p.bounce;
      player.onGround = false;
      player.coyote = 0;
      player.jumpBuf = 0;
      player.jumpCut = false;
      player.air = 0;
      player.lastGroundY = p.y;
      p.squash = 1;              // the skin dips, then springs back
      sfxBounce();
      puff(0, p.y, player.z, 10, 0.5, 2.2);
      landSquash(0.18, 1);
      camImpulse(0.3);
      startTrick(player.vy);     // a huge launch earns a huge trick
      snapshotPose();
    } else if (p) {
      const impact = -player.vy;   // captured before the landing zeroes it
      player.y = p.y;
      player.vy = 0;
      if (!player.onGround) {
        sfxLand();
        puff(0, p.y, player.z, 8, 0.4, 2.0);
        landSquash(0.16, clamp(impact / 14, 0.25, 1));
        // only a hard landing moves the camera; a hop does not
        camImpulse(clamp((impact - 8) / 14, 0, 0.9));
        endTrick();          // poseRun eases the body back upright from here
        snapshotPose();      // the air pose blends into the run cycle
      }
      player.onGround = true;
      player.lastGroundY = p.y;
      player.coyote = COYOTE;
      player.air = 0;
      // the flag is cleared so standing on the podium cannot score it twice
      if (p.isPodium) { p.isPodium = false; completeLevel(); return; }
    } else {
      if (player.onGround) {
        // walked off an edge
        const still = standingOn(player.z, player.y);
        if (!still) { player.onGround = false; player.coyote = COYOTE; }
      }
    }
  } else {
    player.onGround = false;
  }

  if (player.onGround) {
    const still2 = standingOn(player.z, player.y);
    if (!still2) { player.onGround = false; player.coyote = COYOTE; }
  }
  if (!player.onGround && player.coyote > 0) player.coyote -= dt;

  // the warped wall: running onto its base starts the run up; flying into the
  // curve (or the back of it, under the ledge) sticks the feet to it and she
  // slides back down
  for (let i = 0; i < grabs.length; i++) {
    const g = grabs[i];
    if (g.kind !== "warp") continue;
    if (player.z < g.z0 || player.z > g.z0 + g.r + 1.5) continue;
    const top = g.y0 + g.r;
    if (player.onGround) {
      if (player.y > g.y0 + 0.1) continue;   // standing on the summit, not the run-up
      // the speed up the arc comes from the run; not holding forward is a weak start
      g.u = Math.max(0, player.vz) * WARP_BOOST * (input.forward ? 1 : 0.5);
      attach(g);
      return;
    }
    // in the air. Not right after leaving the wall - that is the vault (or the
    // hop) on its way up, and it must clear the surface first
    if (player.releaseLock > 0) continue;
    if (player.y >= top - 0.05 || player.y < g.y0 - 2.0) continue;
    const yy = Math.max(player.y, g.y0);   // under the base counts as the base
    const zs = warpSurfaceZ(g, yy);
    if (player.z < zs - 0.02) continue;
    const a = warpAngleAtY(g, yy);
    if (player.vy > 0 && a > 1.25) continue;   // rising past the ledge, not hitting the wall
    player.z = zs;
    player.y = yy;
    // whatever speed was along the surface carries on along it
    const tangent = player.vz * Math.cos(a) + player.vy * Math.sin(a);
    g.u = clamp(tangent * (input.forward ? 0.9 : 0.3), -RUN_SPEED * WARP_BOOST, RUN_SPEED * WARP_BOOST);
    attach(g);
    return;
  }

  // pose
  if (player.onGround) poseRun(dt);
  else poseAir(dt);
}

// =============================================================================
// frame loop
// =============================================================================
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0.016;
  if (dt > 0.1) dt = 0.1;      // never tunnel after a stall
  dt *= slowMo;

  // fixed-ish steps keep the physics stable on slow frames
  acc += dt;
  let guard = 0;
  while (acc >= 1 / 120 && guard++ < 8) {
    update(1 / 120);
    acc -= 1 / 120;
  }

  tickPoseBlend(dt);
  updatePony(dt, state === State.FALLING);
  syncNinja(dt);
  animateRopes(now, dt);
  updatePads(dt);
  updateCamera(dt);
  updateSky();
  updateSun(player.z, player.y);
  updateNearFade(dt);
  updateClouds(player.z, player.y);
  updateBalloons(now, player.z, player.y);
  updateStars(now);
  updateDust(dt);
  updateBlob(platforms);
  updateConfetti(dt);
  pumpMusic();

  if (state !== State.TITLE) ui.updateHud(level, best, levelTime);
  ui.tickTip(dt);

  renderer.render(scene, camera);
}

window.addEventListener("resize", resizeRenderer, { passive: true });
window.addEventListener("orientationchange", function () { setTimeout(resizeRenderer, 250); }, { passive: true });
if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeRenderer, { passive: true });

// =============================================================================
// boot: a small showcase course behind the title card
// =============================================================================
// a decorative course so the title screen is not empty; rebuilt when the
// course mode is switched so the choice shows right away
function showDemo(): void {
  clearCourses();
  const demo = generateCourse(2, 0, 0);
  courses.push(demo);
  current = demo;
  rebuildWorldLists();
  player.z = 4; player.y = 0;
  initClouds(0, player.y);
  initBalloons(0, player.y);
  snapCamera(-8.4, 4.6, 9, 1.4);
  syncNinja(0.016);
}

function setMode(m: string): void {
  const mode = setModeValue(m);
  best = loadBest();
  ui.refreshTitleBest(best);
  ui.selectModeButton(mode);
  if (state === State.TITLE) showDemo();
}

ui.wireModeButtons(setMode);

function boot(): void {
  resizeRenderer();
  applyMute();
  ui.setMuteLabel(audio.muted);
  setMode(getMode());      // selects the button, shows the demo course and the best
  requestAnimationFrame(frame);
}

boot();

// ?test=<rig> (see course.ts) skips the title and drops straight onto a course
// that is just that rig; ?auto is the hidden demo mode that runs and jumps by
// itself (for screenshots and testing)
if (testObstacle) {
  // hooks for a test harness: read the player state, drive the input, slow the clock
  (window as unknown as { __ninja: unknown }).__ninja = {
    player: player, pressJump: pressJump, autoForward: autoForward,
    setSlow: function (s: number) { slowMo = clamp(s, 0.02, 1); }
  };
  if (!urlParams.has("auto")) startRun();
}
if (urlParams.has("auto")) {
  startRun();
  autoForward();
  // a blind metronome everywhere, except on the warped wall, where it waits
  // for the jump window so the demo clears the finale (and holds its fire
  // through the pull-up over the ledge)
  setInterval(function () {
    const g = player.hang;
    if (!(g && (g.kind === "warp" || g.kind === "ledge"))) pressJump();
  }, 900);
  setInterval(function () {
    const g = player.hang;
    if (g && g.kind === "warp" && g.p >= WARP_WINDOW + 0.05 && player.hangT > 0.12) pressJump();
  }, 100);
}
