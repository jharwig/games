// =============================================================================
// input.ts — keyboard, on-screen touch buttons and phone-tilt steering.
//
// main.ts reads `input` every frame and calls consumeAbility() / consumeAny()
// once per frame to pick up the edge-triggered flags (reading clears them).
//
//   initInput();     // once, after the DOM exists; starts its own rAF poll
//   each frame: read input.steer / .throttle / .brake, then consumeAbility()
//   and consumeAny() for the edge-triggered flags.
//
// Tilt steering is opt-in: iOS only hands out DeviceOrientation events after
// DeviceOrientationEvent.requestPermission() resolves inside a user gesture,
// so enableTilt() MUST be called straight from a click/tap handler (see
// menu.showTiltPrompt, which does exactly that).
// =============================================================================
import type { InputState } from './types';
import { clamp } from './util';
import { setAbilityHandler } from './hud';

export const input: InputState = {
  steer: 0,
  throttle: 0,
  brake: 0,
  abilityPressed: false,
  anyPressed: false,
  touch: false,
  tilt: false,
  tiltBlocked: false,
};

// ---- tuning ----------------------------------------------------------------
const KEY_STEER_RATE = 7.5;    // how fast keyboard steering ramps (1/s)
const KEY_STEER_BACK = 12;     // how fast it centres again (1/s)
const TILT_FULL = 22;          // degrees of roll for full lock
const TILT_DEAD = 2;           // degrees of dead zone around neutral
const TILT_SMOOTH = 0.25;      // exponential smoothing on the raw reading
const D2R = Math.PI / 180;

// ---- internal state --------------------------------------------------------
const keys = new Set<string>();
let btnLeft = false, btnRight = false, btnGas = false, btnBrake = false;
let started = false;
let lastT = 0;

type Cb = () => void;
const restartCbs: Cb[] = [];
const muteCbs: Cb[] = [];
const pauseCbs: Cb[] = [];

/** R (restart race) — also fired by nothing else. */
export function onRestart(cb: Cb): void { restartCbs.push(cb); }
/** M (mute toggle). */
export function onMute(cb: Cb): void { muteCbs.push(cb); }
/** Escape (back to menu / pause) — main decides what it means. */
export function onPause(cb: Cb): void { pauseCbs.push(cb); }

// =============================================================================
// setup
// =============================================================================
export function initInput(): void {
  if (started) return;
  started = true;

  const forced = new URLSearchParams(location.search).has('touch');
  input.touch = forced
    || (window.matchMedia?.('(pointer: coarse)').matches ?? false)
    || navigator.maxTouchPoints > 0;
  document.body.classList.toggle('touch', input.touch);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);

  bindHold('btn-gas', (d) => { btnGas = d; });
  bindHold('btn-brake', (d) => { btnBrake = d; });
  bindHold('btn-left', (d) => { btnLeft = d; });
  bindHold('btn-right', (d) => { btnRight = d; });

  // The HUD ability panel is the ability button on touch devices.
  setAbilityHandler(() => { input.abilityPressed = true; input.anyPressed = true; });

  // Never let the page pan/zoom while driving, but keep the menu scrollable.
  document.addEventListener('touchmove', (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('#menu, #results, #tilt-prompt')) return;
    e.preventDefault();
  }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault());
  }
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => {
    if (e.target instanceof Element && e.target.closest('#touch-controls, #app')) e.preventDefault();
  });

  window.addEventListener('orientationchange', () => { tiltNeutral = null; });
  lastT = performance.now();
  const loop = () => { poll(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

function bindHold(id: string, set: (down: boolean) => void): void {
  const el = document.getElementById(id);
  if (!el) return;
  const down = (e: Event) => {
    e.preventDefault();
    set(true);
    input.anyPressed = true;
    el.classList.add('held');
  };
  const up = (e: Event) => { e.preventDefault(); set(false); el.classList.remove('held'); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
  // Safari fires touch events too; preventing them stops the synthetic 300ms
  // click and the magnifying-glass callout without breaking pointer events.
  el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  el.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
}

// =============================================================================
// keyboard
// =============================================================================
const STEER_L = ['ArrowLeft', 'KeyA'];
const STEER_R = ['ArrowRight', 'KeyD'];
const GAS = ['ArrowUp', 'KeyW'];
const BRAKE = ['ArrowDown', 'KeyS'];
const DRIVE = [...STEER_L, ...STEER_R, ...GAS, ...BRAKE, 'Space'];

function typingInButton(e: KeyboardEvent): boolean {
  // Let Space / Enter activate a focused menu button instead of the car.
  const t = e.target;
  return t instanceof HTMLElement
    && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.isContentEditable);
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const focusedButton = typingInButton(e);
  if (!focusedButton && DRIVE.includes(e.code)) e.preventDefault();

  if (!e.repeat) {
    input.anyPressed = true;
    if (e.code === 'Space' && !focusedButton) input.abilityPressed = true;
    if (e.code === 'KeyR') for (const cb of restartCbs) cb();
    if (e.code === 'KeyM') for (const cb of muteCbs) cb();
    if (e.code === 'Escape') for (const cb of pauseCbs) cb();
  }
  keys.add(e.code);
}

function onKeyUp(e: KeyboardEvent): void { keys.delete(e.code); }

function releaseAll(): void {
  keys.clear();
  btnGas = btnBrake = btnLeft = btnRight = false;
  for (const id of ['btn-gas', 'btn-brake', 'btn-left', 'btn-right']) {
    document.getElementById(id)?.classList.remove('held');
  }
}

const anyKey = (list: string[]) => list.some((k) => keys.has(k));

// =============================================================================
// tilt steering
// =============================================================================
let tiltRaw = 0;          // smoothed roll in degrees (screen-relative)
let tiltNeutral: number | null = null;  // captured on the first reading
let tiltHave = false;

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };

export function tiltAvailable(): boolean {
  return typeof DeviceOrientationEvent !== 'undefined' && input.touch;
}

/**
 * Turn tilt steering on. Must be called from inside a user gesture on iOS
 * (that is where requestPermission is allowed). Resolves to whether tilt is
 * now active; sets input.tiltBlocked when the OS said no.
 */
export async function enableTilt(): Promise<boolean> {
  if (!tiltAvailable()) { input.tilt = false; return false; }
  try {
    const D = DeviceOrientationEvent as OrientationCtor;
    if (typeof D.requestPermission === 'function') {
      const res = await D.requestPermission();
      if (res !== 'granted') {
        input.tilt = false; input.tiltBlocked = true;
        document.body.classList.remove('tilt-on');
        return false;
      }
    }
  } catch {
    input.tilt = false; input.tiltBlocked = true;
    document.body.classList.remove('tilt-on');
    return false;
  }
  tiltHave = false; tiltNeutral = null; tiltRaw = 0;
  window.addEventListener('deviceorientation', onOrient);
  input.tilt = true; input.tiltBlocked = false;
  document.body.classList.add('tilt-on');
  return true;
}

export function disableTilt(): void {
  window.removeEventListener('deviceorientation', onOrient);
  input.tilt = false;
  tiltHave = false; tiltNeutral = null; tiltRaw = 0;
  document.body.classList.remove('tilt-on');
}

/** Take the phone's current attitude as "straight ahead" (call at race start). */
export function recalibrateTilt(): void { tiltNeutral = null; }

/** screen.orientation.angle, falling back to the legacy window.orientation. */
function screenAngle(): number {
  const a = screen.orientation?.angle;
  if (typeof a === 'number') return a;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

function onOrient(e: DeviceOrientationEvent): void {
  if (!input.tilt || e.beta === null || e.gamma === null) return;
  const b = e.beta * D2R, g = e.gamma * D2R;
  // Gravity in device coordinates from the ZXY euler angles, then projected
  // onto the screen's right axis — one formula that is correct in portrait and
  // in both landscapes (screen right, in device space, is (cos t, -sin t, 0)).
  const t = screenAngle() * D2R;
  const dot = Math.sin(g) * Math.cos(b) * Math.cos(t) + Math.sin(b) * Math.sin(t);
  const deg = Math.asin(clamp(dot, -1, 1)) / D2R;
  if (tiltNeutral === null) tiltNeutral = clamp(deg, -45, 45);
  const rel = deg - tiltNeutral;
  tiltRaw = tiltHave ? tiltRaw + (rel - tiltRaw) * TILT_SMOOTH : rel;
  tiltHave = true;
}

function tiltSteer(): number {
  if (!input.tilt || !tiltHave) return 0;
  const a = Math.abs(tiltRaw);
  if (a <= TILT_DEAD) return 0;
  const mag = Math.min(1, (a - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
  return tiltRaw < 0 ? -mag : mag;
}

// =============================================================================
// per-frame reads
// =============================================================================
function poll(): void {
  const now = performance.now();
  const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
  lastT = now;

  const kl = anyKey(STEER_L) || btnLeft;
  const kr = anyKey(STEER_R) || btnRight;

  if (!kl && !kr && input.tilt && tiltHave) {
    input.steer = tiltSteer();          // analogue: follow the phone directly
  } else {
    // digital steering ramps in and springs back to centre
    const target = (kr ? 1 : 0) - (kl ? 1 : 0);
    const toward = target - input.steer;
    const rate = (target === 0 || target * input.steer < 0) ? KEY_STEER_BACK : KEY_STEER_RATE;
    const step = rate * dt;
    input.steer = Math.abs(toward) <= step
      ? target
      : clamp(input.steer + Math.sign(toward) * step, -1, 1);
  }

  input.throttle = (anyKey(GAS) || btnGas) ? 1 : 0;
  input.brake = (anyKey(BRAKE) || btnBrake) ? 1 : 0;
}

/**
 * Edge-triggered: true on the frame the ability key/button went down.
 * Reading it clears it, so call it exactly once per frame.
 */
export function consumeAbility(): boolean {
  const v = input.abilityPressed;
  input.abilityPressed = false;
  return v;
}

/** Edge-triggered "any key/tap this frame" — reading clears it. */
export function consumeAny(): boolean {
  const v = input.anyPressed;
  input.anyPressed = false;
  return v;
}

/**
 * Optional: clears both edge flags at the end of a frame. Not needed when
 * main calls consumeAbility()/consumeAny() every frame, but harmless.
 */
export function endFrame(): void {
  input.abilityPressed = false;
  input.anyPressed = false;
}
