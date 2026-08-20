// =============================================================================
// input: keyboard + touch / mouse (hold the left half to run, tap / hold the
// right half to jump). Edge-triggered jump presses are queued on the player.
// =============================================================================
import { JUMP_BUFFER } from "./constants";
import { player } from "./player";

export const input = { forward: false, jump: false, jumpEdge: false };
let keyForward = false, touchForward = false;
let keyJump = false;
const jumpPointers = new Set<number>();
const forwardPointers = new Set<number>();

function setForward(): void { input.forward = keyForward || touchForward; }
function setJump(): void { input.jump = keyJump || jumpPointers.size > 0; }

export function pressJump(): void {
  input.jumpEdge = true;
  player.jumpBuf = JUMP_BUFFER;
}

// the hidden ?auto demo holds the run key down
export function autoForward(): void { keyForward = true; setForward(); }

export interface InputHooks {
  canvas: HTMLElement;
  muteBtn: HTMLElement;
  titleEl: HTMLElement;
  isTitle: () => boolean;
  anyInput: () => void;      // any press: wakes audio and starts a run from the title
  toggleMute: () => void;
}

function pointerSide(e: PointerEvent): "L" | "R" {
  const w = window.innerWidth || document.documentElement.clientWidth;
  return e.clientX < w * 0.5 ? "L" : "R";
}

export function setupInput(h: InputHooks): void {
  window.addEventListener("keydown", function (e) {
    if (e.repeat) {
      if (e.key === " " || e.code === "Space") e.preventDefault();
      return;
    }
    const k = e.key;
    if (k === "w" || k === "W" || k === "ArrowUp") {
      keyForward = true; setForward(); e.preventDefault(); h.anyInput();
    } else if (k === " " || e.code === "Space" || k === "ArrowRight" || k === "Enter") {
      keyJump = true; setJump(); pressJump(); e.preventDefault(); h.anyInput();
    } else if (k === "m" || k === "M") {
      h.toggleMute(); e.preventDefault();
    } else {
      h.anyInput();
    }
  }, { passive: false });

  window.addEventListener("keyup", function (e) {
    const k = e.key;
    if (k === "w" || k === "W" || k === "ArrowUp") { keyForward = false; setForward(); }
    else if (k === " " || e.code === "Space" || k === "ArrowRight" || k === "Enter") {
      keyJump = false; setJump();
    }
  }, { passive: true });

  h.canvas.addEventListener("pointerdown", function (e) {
    h.anyInput();
    if (h.isTitle()) return;
    if (pointerSide(e) === "L") {
      forwardPointers.add(e.pointerId);
      touchForward = true;
      setForward();
    } else {
      jumpPointers.add(e.pointerId);
      setJump();
      pressJump();
    }
    if (e.pointerType !== "mouse") e.preventDefault();
  }, { passive: false });

  function endPointer(e: PointerEvent): void {
    if (forwardPointers.delete(e.pointerId)) {
      touchForward = forwardPointers.size > 0;
      setForward();
    }
    if (jumpPointers.delete(e.pointerId)) setJump();
  }
  window.addEventListener("pointerup", endPointer, { passive: true });
  window.addEventListener("pointercancel", endPointer, { passive: true });
  window.addEventListener("blur", function () {
    forwardPointers.clear();
    touchForward = false; keyForward = false; setForward();
    jumpPointers.clear();
    keyJump = false; setJump();
  }, { passive: true });

  // stop the page from scrolling / zooming around the canvas
  (["touchstart", "touchmove", "touchend", "gesturestart", "contextmenu"] as const).forEach(function (n) {
    document.addEventListener(n, function (e) {
      const t = e.target as Node | null;
      if (t === h.muteBtn || (t && h.muteBtn.contains(t))) return;
      if (!h.isTitle() || n === "touchmove" || n === "gesturestart") e.preventDefault();
    }, { passive: false });
  });

  h.muteBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    h.toggleMute();
  });
  h.muteBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); }, { passive: true });

  h.titleEl.addEventListener("pointerdown", function (e) { e.preventDefault(); h.anyInput(); }, { passive: false });
}
