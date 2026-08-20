// =============================================================================
// the chase camera. It works in course coordinates (distance along, height)
// and is mapped to the world at the end, so it rides around the tower with
// the player.
// =============================================================================
import { CAM_OUT, RUN_SPEED } from "./constants";
import { camera } from "./gfx";
import { isTower, pathPos, tmpV } from "./path";
import { player } from "./player";
import { clamp, damp } from "./util";

let camLookY = 0, camLookZ = 0, started = false;
let camBaseY = 0, camBaseZ = 0;   // smoothed position, kept apart from the shake
let camFov = 58, camT = 0;
let shakeT = 0, shakeAmp = 0, camDip = 0;

// the camera rides a little outside the coil so the path ahead curves in view
function camLat(): number { return isTower() ? -CAM_OUT : 0; }

// a short impact: the camera dips and shakes, scaled by amp 0..1
export function camImpulse(amp: number): void {
  if (amp <= 0) return;
  shakeT = 0.35;
  shakeAmp = Math.max(shakeAmp, amp);
  camDip = Math.max(camDip, amp * 0.55);
}

// put the chase camera straight at a course position, no easing
export function snapCamera(backZ: number, y: number, lookZ: number, lookY: number): void {
  camBaseZ = backZ;
  camBaseY = y;
  camLookZ = lookZ;
  camLookY = lookY;
  pathPos(camBaseZ, camLat(), camBaseY, camera.position);
  camera.lookAt(pathPos(camLookZ, 0, camLookY, tmpV));
}

export function updateCamera(dt: number): void {
  camT += dt;
  const tz = player.z - 8.4;
  const ty = player.y + 3.4;
  const lambda = started ? 7 : 60;
  camBaseZ = damp(camBaseZ, tz, lambda, dt);
  camBaseY = damp(camBaseY, ty, lambda * 0.75, dt);

  // impact shake and dip
  let sx = 0, sy = 0;
  if (shakeT > 0) {
    shakeT -= dt;
    const k = Math.max(shakeT / 0.35, 0);
    const s = shakeAmp * k * k;
    sx = Math.sin(camT * 71) * s * 0.14;
    sy = Math.sin(camT * 57 + 1.3) * s * 0.1;
    if (shakeT <= 0) shakeAmp = 0;
  }
  camDip = damp(camDip, 0, 9, dt);
  pathPos(camBaseZ, camLat() + sx, camBaseY - camDip + sy, camera.position);

  // the view widens a little with speed, and with a big swing
  const speedK = clamp(player.vz / RUN_SPEED, 0, 1.4);
  const swingK = (player.hang && player.hang.kind === "pend") ? Math.abs(player.omega) * 1.1 : 0;
  camFov = damp(camFov, 58 + speedK * 4 + swingK, 6, dt);
  if (Math.abs(camFov - camera.fov) > 0.02) {
    camera.fov = camFov;
    camera.updateProjectionMatrix();
  }

  camLookY = damp(camLookY, player.y + 1.4, 6, dt);
  camLookZ = damp(camLookZ, player.z + 5.0 + speedK * 1.5, 8, dt);
  camera.lookAt(pathPos(camLookZ, 0, camLookY, tmpV));
  started = true;
}
