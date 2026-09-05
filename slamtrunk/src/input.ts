// =============================================================================
// pointer input (mouse + touch): drag anywhere to aim, release to shoot, a
// short tap to jump. Deltas are normalised by the shorter screen edge so a
// drag feels the same on a phone and a laptop. y is positive upwards.
// =============================================================================
import type { InputState } from './types';

/** below this (normalised) a pointer press counts as a tap, not a drag */
const DEAD_ZONE = 0.035;
/** a press held longer than this is never a tap, even without moving */
const TAP_MS = 250;

export interface Input {
  state: InputState;
  /** clear the one-frame flags after the game has read them */
  consume(): void;
  dispose(): void;
}

export function createInput(target: HTMLElement): Input {
  target.style.touchAction = 'none';
  (target.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = 'none';
  target.style.userSelect = 'none';

  const state: InputState = { aiming: false, aimDx: 0, aimDy: 0, release: null, tap: false };

  let id = -1;          // active pointer id (-1 = none)
  let x0 = 0, y0 = 0;   // press origin, css px
  let t0 = 0;           // press time
  let moved = false;    // has the drag left the dead zone

  const norm = (): number => Math.max(1, Math.min(innerWidth, innerHeight));

  function setAim(x: number, y: number): void {
    const n = norm();
    state.aimDx = (x - x0) / n;
    state.aimDy = (y0 - y) / n; // screen y grows downwards; aim y grows up
  }

  function down(e: PointerEvent): void {
    if (id !== -1) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = performance.now();
    moved = false;
    state.aiming = false; state.aimDx = 0; state.aimDy = 0;
    try { target.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    e.preventDefault();
  }

  function move(e: PointerEvent): void {
    if (e.pointerId !== id) return;
    setAim(e.clientX, e.clientY);
    if (!moved && Math.hypot(state.aimDx, state.aimDy) > DEAD_ZONE) moved = true;
    state.aiming = moved;
    e.preventDefault();
  }

  function up(e: PointerEvent): void {
    if (e.pointerId !== id) return;
    setAim(e.clientX, e.clientY);
    const far = Math.hypot(state.aimDx, state.aimDy) > DEAD_ZONE;
    const quick = performance.now() - t0 < TAP_MS;
    if (moved || far) state.release = { dx: state.aimDx, dy: state.aimDy };
    else if (quick) state.tap = true;
    id = -1; moved = false;
    state.aiming = false; state.aimDx = 0; state.aimDy = 0;
    try { target.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    e.preventDefault();
  }

  function cancel(e: PointerEvent): void {
    if (e.pointerId !== id) return;
    id = -1; moved = false;
    state.aiming = false; state.aimDx = 0; state.aimDy = 0;
  }

  const stopTouch = (e: Event): void => e.preventDefault();

  target.addEventListener('pointerdown', down);
  // window-level so a drag that leaves the canvas still tracks
  addEventListener('pointermove', move, { passive: false });
  addEventListener('pointerup', up, { passive: false });
  addEventListener('pointercancel', cancel);
  target.addEventListener('touchstart', stopTouch, { passive: false });
  target.addEventListener('touchmove', stopTouch, { passive: false });
  target.addEventListener('gesturestart', stopTouch as EventListener);
  target.addEventListener('contextmenu', stopTouch);

  return {
    state,
    consume(): void { state.release = null; state.tap = false; },
    dispose(): void {
      target.removeEventListener('pointerdown', down);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      target.removeEventListener('touchstart', stopTouch);
      target.removeEventListener('touchmove', stopTouch);
      target.removeEventListener('gesturestart', stopTouch as EventListener);
      target.removeEventListener('contextmenu', stopTouch);
    },
  };
}
