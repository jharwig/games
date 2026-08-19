import type { InputState } from './types';

export function createInput(): InputState {
  const state: InputState = {
    left: false,
    right: false,
    up: false,
    down: false,
    pumpPressed: false,
    throwPressed: false,
    mutePressed: false,
    anyPressed: false,
  };

  const setHeld = (code: string, down: boolean): void => {
    if (code === 'ArrowLeft' || code === 'KeyA') state.left = down;
    else if (code === 'ArrowRight' || code === 'KeyD') state.right = down;
    else if (code === 'ArrowUp' || code === 'KeyW') state.up = down;
    else if (code === 'ArrowDown' || code === 'KeyS') state.down = down;
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    setHeld(e.code, true);
    if (e.code === 'Space') state.pumpPressed = true;
    if (e.code === 'Enter' || e.code === 'KeyF') state.throwPressed = true;
    if (e.code === 'KeyM') state.mutePressed = true;
    state.anyPressed = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => setHeld(e.code, false));

  // Held keys must not latch across a focus loss (alt-tab mid-hold).
  window.addEventListener('blur', () => {
    state.left = state.right = state.up = state.down = false;
  });

  return state;
}

/** Clear one-frame edge flags; call at the end of every frame. */
export function clearFrameInput(state: InputState): void {
  state.pumpPressed = false;
  state.throwPressed = false;
  state.mutePressed = false;
  state.anyPressed = false;
}
