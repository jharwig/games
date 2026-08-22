// Touch-first pointer input. The whole interaction grammar is two gestures:
// everything reacts on press (tap beings, pick up objects), and a picked-up
// object follows the pointer until release. Single pointer — holding one mess
// through a sweep is a legitimate move, juggling several is not.

import { canvas, toGame } from './gfx';

export interface InputHandlers {
  // Returns true if the press picked something up (a drag is now live).
  onPress(x: number, y: number): boolean;
  onDragMove(x: number, y: number): void;
  onRelease(x: number, y: number): void;
}

export function initInput(h: InputHandlers): void {
  let activeId: number | null = null;
  let dragging = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    const p = toGame(e.clientX, e.clientY);
    dragging = h.onPress(p.x, p.y);
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId || !dragging) return;
    const p = toGame(e.clientX, e.clientY);
    h.onDragMove(p.x, p.y);
    e.preventDefault();
  });

  const finish = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    if (dragging) {
      const p = toGame(e.clientX, e.clientY);
      h.onRelease(p.x, p.y);
      dragging = false;
    }
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}
