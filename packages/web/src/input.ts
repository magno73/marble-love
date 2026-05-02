/**
 * input.ts — input mapping browser → engine InputSnapshot.
 *
 * Mappature:
 *  - Mouse: movimento → trackball delta (cumulato fino al consume del frame).
 *  - Tastiera: WASD/frecce → emulano trackball delta (PRD §4 mobile/desktop).
 *  - Gamepad: stick destro → trackball delta.
 *  - Touch (mobile): drag su canvas → trackball delta.
 *
 * Phase 7: implementare anche pulsanti virtuali e accelerometro mobile.
 */

const KEYBOARD_TRACKBALL_EQUIV = 15; // cfr. lavoro precedente (`marble-madness-2026`)

export interface InputState {
  buttons: number;
  consumeDx(): number;
  consumeDy(): number;
}

export function initInput(): InputState {
  let dx = 0;
  let dy = 0;
  let buttons = 0;

  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    keys.add(e.key.toLowerCase());
    if (e.key === " " || e.key === "Enter") buttons |= 0x01;
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.key.toLowerCase());
    if (e.key === " " || e.key === "Enter") buttons &= ~0x01;
  });

  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement) {
      dx += e.movementX | 0;
      dy += e.movementY | 0;
    }
  });
  window.addEventListener("click", () => {
    if (!document.pointerLockElement) document.body.requestPointerLock?.();
  });

  let lastTouch: { x: number; y: number } | null = null;
  window.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (t) lastTouch = { x: t.clientX, y: t.clientY };
  });
  window.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (t && lastTouch) {
      dx += (t.clientX - lastTouch.x) | 0;
      dy += (t.clientY - lastTouch.y) | 0;
      lastTouch = { x: t.clientX, y: t.clientY };
    }
  });
  window.addEventListener("touchend", () => {
    lastTouch = null;
  });

  return {
    get buttons() {
      return buttons;
    },
    consumeDx() {
      // Tastiera: integra come delta fittizio
      if (keys.has("arrowleft") || keys.has("a")) dx -= KEYBOARD_TRACKBALL_EQUIV;
      if (keys.has("arrowright") || keys.has("d")) dx += KEYBOARD_TRACKBALL_EQUIV;
      // Gamepad
      const gp = navigator.getGamepads?.()[0];
      if (gp) dx += Math.round((gp.axes[2] ?? 0) * KEYBOARD_TRACKBALL_EQUIV);
      const v = Math.max(-127, Math.min(127, dx)); // signed 8-bit
      dx = 0;
      return v;
    },
    consumeDy() {
      if (keys.has("arrowup") || keys.has("w")) dy -= KEYBOARD_TRACKBALL_EQUIV;
      if (keys.has("arrowdown") || keys.has("s")) dy += KEYBOARD_TRACKBALL_EQUIV;
      const gp = navigator.getGamepads?.()[0];
      if (gp) dy += Math.round((gp.axes[3] ?? 0) * KEYBOARD_TRACKBALL_EQUIV);
      const v = Math.max(-127, Math.min(127, dy));
      dy = 0;
      return v;
    },
  };
}
