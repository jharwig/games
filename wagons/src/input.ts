// Keyboard + mouse (pointer lock), touch (drag to look + buttons), and the
// optional phone gyroscope. Produces look deltas and edge/held flags that
// main.ts consumes every frame.
import { canvas } from './gfx';
import { GYRO_KEY, MOUSE_SENS, TOUCH_SENS } from './constants';
import { isTouch, loadStr, saveStr } from './util';

export const input = {
  dYaw: 0, dPitch: 0,         // accumulated look delta, consumed per frame
  turnLeft: false, turnRight: false,
  fireHeld: false, firePressed: false,
  reloadPressed: false, swapPressed: false,
  anyPressed: false,          // any "start"-worthy press this frame
  locked: false,
  touch: isTouch(),
  gyro: false,
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
let lastAlpha: number | null = null, lastBeta: number | null = null;
function onOrient(e: DeviceOrientationEvent) {
  if (!input.gyro || e.alpha === null || e.beta === null) return;
  if (lastAlpha !== null && lastBeta !== null) {
    let da = e.alpha - lastAlpha; if (da > 180) da -= 360; if (da < -180) da += 360;
    const db = e.beta - lastBeta;
    // portrait: alpha is compass yaw; turning the phone left increases alpha
    input.dYaw += da * Math.PI / 180;
    input.dPitch += db * Math.PI / 180 * (window.innerWidth > window.innerHeight ? 0 : 1);
  }
  lastAlpha = e.alpha; lastBeta = e.beta;
}
export const gyroAvailable = () => typeof DeviceOrientationEvent !== 'undefined' && input.touch;
export async function setGyro(on: boolean): Promise<boolean> {
  if (!on) { input.gyro = false; saveStr(GYRO_KEY, '0'); window.removeEventListener('deviceorientation', onOrient); return false; }
  try {
    const D = DeviceOrientationEvent as any;
    if (typeof D.requestPermission === 'function') {
      const r = await D.requestPermission(); if (r !== 'granted') return false;
    }
    lastAlpha = lastBeta = null;
    window.addEventListener('deviceorientation', onOrient);
    input.gyro = true; saveStr(GYRO_KEY, '1');
    return true;
  } catch { return false; }
}
export const gyroWanted = () => loadStr(GYRO_KEY, '0') === '1';
