// Keyboard + mouse (pointer lock), touch (drag to look + buttons), and the
// optional phone gyroscope. Produces look deltas and edge/held flags that
// main.ts consumes every frame.
import * as THREE from 'three';
import { canvas } from './gfx';
import { GYRO_KEY, GYRO_SMOOTH, GYRO_YAW_GAIN, MOUSE_SENS, PITCH_LIMIT, TOUCH_SENS } from './constants';
import { angDiff, clamp, isTouch, loadStr, saveStr } from './util';

export const input = {
  dYaw: 0, dPitch: 0,         // accumulated look delta, consumed per frame
  turnLeft: false, turnRight: false,
  fireHeld: false, firePressed: false,
  reloadPressed: false, swapPressed: false,
  anyPressed: false,          // any "start"-worthy press this frame
  locked: false,
  touch: isTouch(),
  gyro: false,
  gyroBlocked: false,         // the OS refused orientation access
};

export function consume() {
  input.dYaw = 0; input.dPitch = 0;
  input.firePressed = false; input.reloadPressed = false; input.swapPressed = false; input.anyPressed = false;
}

// ---- pointer lock ----
export function requestLock() {
  if (input.touch) return;
  try { const p = (canvas as any).requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()); }
  catch { try { canvas.requestPointerLock(); } catch { /* unsupported */ } }
}
export function exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
document.addEventListener('pointerlockchange', () => { input.locked = document.pointerLockElement === canvas; });

document.addEventListener('mousemove', e => {
  if (!input.locked) return;
  input.dYaw -= e.movementX * MOUSE_SENS;
  input.dPitch -= e.movementY * MOUSE_SENS;
});
canvas.addEventListener('mousedown', e => {
  if (input.touch) return;
  if (e.button === 0) { input.fireHeld = true; input.firePressed = true; input.anyPressed = true; }
});
window.addEventListener('mouseup', e => { if (e.button === 0) input.fireHeld = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---- keyboard ----
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': input.turnLeft = true; break;
    case 'ArrowRight': case 'KeyD': input.turnRight = true; break;
    case 'Space': input.firePressed = true; input.fireHeld = true; input.anyPressed = true; e.preventDefault(); break;
    case 'KeyR': input.reloadPressed = true; break;
    case 'KeyQ': case 'Digit1': case 'Digit2': case 'KeyE': input.swapPressed = true; break;
    case 'Enter': input.anyPressed = true; break;
  }
});
window.addEventListener('keyup', e => {
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': input.turnLeft = false; break;
    case 'ArrowRight': case 'KeyD': input.turnRight = false; break;
    case 'Space': input.fireHeld = false; break;
  }
});
window.addEventListener('blur', () => { input.turnLeft = input.turnRight = input.fireHeld = false; });

// ---- touch ----
if (input.touch) {
  document.body.classList.add('touch');
  let lookId: number | null = null, lx = 0, ly = 0;
  canvas.addEventListener('touchstart', e => {
    for (const t of Array.from(e.changedTouches)) {
      if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === lookId) {
        input.dYaw -= (t.clientX - lx) * TOUCH_SENS; input.dPitch -= (t.clientY - ly) * TOUCH_SENS;
        lx = t.clientX; ly = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId) lookId = null; };
  canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);

  const btn = (id: string, down: () => void, up?: () => void) => {
    const el = document.getElementById(id)!;
    el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); down(); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); up && up(); }, { passive: false });
    el.addEventListener('touchcancel', () => up && up());
  };
  btn('btnFire', () => { input.fireHeld = true; input.firePressed = true; input.anyPressed = true; }, () => { input.fireHeld = false; });
  btn('btnSwap', () => { input.swapPressed = true; });
  btn('btnReload', () => { input.reloadPressed = true; });
}

// ---- gyroscope (opt-in) ----
// Aim by turning the phone: the phone IS the gun. deviceorientation's
// alpha/beta/gamma are Z-X'-Y'' Euler angles; differencing them directly
// falls apart exactly where you hold a phone to aim (upright, beta ~ 90
// degrees is a gimbal singularity) and means nothing in landscape. So build
// the device quaternion the way three's DeviceOrientationControls did, turn
// it into the direction the BACK of the phone points and read that
// direction's yaw/pitch. (Screen rotation only rolls about the view axis, so
// portrait and landscape come out the same.)
//
// The mapping is absolute + calibrated: view = phone * gain + offset, where
// the offset is captured at enable and at every run start (so wherever the
// phone points then = wherever the view looks then). Dragging rotates the
// offset, which is how you aim behind you from a couch and how you shrug off
// drift. A light exponential smoothing takes the sensor shimmer off the
// crosshair.
const D2R = Math.PI / 180;
const gEuler = new THREE.Euler(), gQuat = new THREE.Quaternion(), gFwd = new THREE.Vector3();
const Q_BACK = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // look out the back of the device
const phone = { yaw: 0, pitch: 0 };   // smoothed direction the phone points (three yaw convention)
const offset = { yaw: 0, pitch: 0 };  // view = phone*gain + offset
let gHave = false;                    // at least one reading since enabling
let pendingCal: { yaw: number; pitch: number } | null = null;
const dbg = new URLSearchParams(location.search).has('debug') ? document.getElementById('dbg') : null;
if (dbg) dbg.classList.remove('hidden');

function onOrient(e: DeviceOrientationEvent) {
  if (!input.gyro || e.alpha === null || e.beta === null || e.gamma === null) return;
  gEuler.set(e.beta * D2R, e.alpha * D2R, -e.gamma * D2R, 'YXZ');
  gQuat.setFromEuler(gEuler).multiply(Q_BACK);
  gFwd.set(0, 0, -1).applyQuaternion(gQuat);
  const y = Math.atan2(-gFwd.x, -gFwd.z);                 // three's yaw convention (rotation.y)
  const p = Math.asin(clamp(gFwd.y, -1, 1));
  if (!gHave) { phone.yaw = y; phone.pitch = p; gHave = true; }
  else { phone.yaw += angDiff(phone.yaw, y) * GYRO_SMOOTH; phone.pitch += (p - phone.pitch) * GYRO_SMOOTH; }
  if (pendingCal) { calibrateGyro(pendingCal.yaw, pendingCal.pitch); pendingCal = null; }
  if (dbg) dbg.textContent = `α ${e.alpha.toFixed(0)} β ${e.beta.toFixed(0)} γ ${e.gamma.toFixed(0)}\nphone yaw ${(phone.yaw / D2R).toFixed(0)} pitch ${(phone.pitch / D2R).toFixed(0)}\nscreen ${(screen as any).orientation?.type ?? '?'}`;
}
/** Make the phone's current direction correspond to this view yaw/pitch. */
export function calibrateGyro(viewYaw: number, viewPitch: number) {
  if (!input.gyro) return;
  if (!gHave) { pendingCal = { yaw: viewYaw, pitch: viewPitch }; return; }
  offset.yaw = viewYaw - phone.yaw * GYRO_YAW_GAIN;
  offset.pitch = viewPitch - phone.pitch;
}
/** The absolute look the phone asks for, or null when gyro is off / has no
 *  reading yet. Drag deltas rotate the offset; the pitch offset can't be
 *  dragged past what PITCH_LIMIT allows at the current tilt, so holding a
 *  drag at the top never winds up an invisible surplus. */
export function gyroLook(dYaw: number, dPitch: number): { yaw: number; pitch: number } | null {
  if (!input.gyro || !gHave) return null;
  offset.yaw += dYaw;
  offset.pitch = clamp(offset.pitch + dPitch, -PITCH_LIMIT - phone.pitch, PITCH_LIMIT - phone.pitch);
  return { yaw: phone.yaw * GYRO_YAW_GAIN + offset.yaw, pitch: phone.pitch + offset.pitch };
}
export const gyroAvailable = () => typeof DeviceOrientationEvent !== 'undefined' && input.touch;
/** Turn the gyro on (asks iOS for permission — must run inside a user
 *  gesture) or off. Resolves to whether it's on; `input.gyroBlocked` is set
 *  when the OS refused. */
export async function setGyro(on: boolean): Promise<boolean> {
  if (!on) { input.gyro = false; saveStr(GYRO_KEY, '0'); window.removeEventListener('deviceorientation', onOrient); return false; }
  try {
    const D = DeviceOrientationEvent as any;
    if (typeof D.requestPermission === 'function') {
      const r = await D.requestPermission();
      if (r !== 'granted') { input.gyroBlocked = true; saveStr(GYRO_KEY, '0'); return false; }
    }
    gHave = false; pendingCal = null;
    window.addEventListener('deviceorientation', onOrient);
    input.gyro = true; input.gyroBlocked = false; saveStr(GYRO_KEY, '1');
    return true;
  } catch { input.gyroBlocked = true; return false; }
}
/** Remembered choice: 'on' | 'off' | null when never asked. */
export function gyroPref(): 'on' | 'off' | null { const v = loadStr(GYRO_KEY, ''); return v === '1' ? 'on' : v === '0' ? 'off' : null; }
