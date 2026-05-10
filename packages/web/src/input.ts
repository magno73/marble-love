/**
 * input.ts — input mapping browser → engine MMIO trackball values.
 *
 * Modello MMIO MAME: il trackball P1/P2 è un encoder relativo che
 * `processAxis` (engine/trackball-input.ts) legge come BYTE assoluto 0..255
 * con wrap-around. Il delta è ricavato 68k-side via `cur - prev` (mod 256).
 *
 * Quindi il browser deve **integrare** i delta (mouse/keyboard/gamepad/touch)
 * in un valore ABSOLUTE 0..255, non passare il delta diretto. Questo evita
 * il bug "primo frame": cur=0 vs prev=0xff (seed MAME) → delta=1 → write
 * spurious. Mantenendo cur=0xff stabile quando nessun input → delta=0.
 *
 * Phase 7: implementare anche pulsanti virtuali e accelerometro mobile.
 */

const KEYBOARD_TRACKBALL_EQUIV = 4; // tarato per gameplay piacevole

export interface InputState {
  buttons: number;
  consumeP1X(): number; // 0..255 absolute
  consumeP1Y(): number;
  consumeP2X(): number;
  consumeP2Y(): number;
}

export function initInput(): InputState {
  // Stato assoluto trackball (= valore MMIO 0xF20001 etc.). Inizializzato a
  // 0xff (= MMIO stable in MAME attract mode con processAxis seed prev=0xff).
  let p1X = 0xff;
  let p1Y = 0xff;
  let p2X = 0xff;
  let p2Y = 0xff;
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
      p1X = (p1X + (e.movementX | 0)) & 0xff;
      p1Y = (p1Y + (e.movementY | 0)) & 0xff;
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
      p1X = (p1X + ((t.clientX - lastTouch.x) | 0)) & 0xff;
      p1Y = (p1Y + ((t.clientY - lastTouch.y) | 0)) & 0xff;
      lastTouch = { x: t.clientX, y: t.clientY };
    }
  });
  window.addEventListener("touchend", () => {
    lastTouch = null;
  });

  function pollKeyboardAndGamepad(): void {
    let dx = 0, dy = 0;
    if (keys.has("arrowleft")  || keys.has("a")) dx -= KEYBOARD_TRACKBALL_EQUIV;
    if (keys.has("arrowright") || keys.has("d")) dx += KEYBOARD_TRACKBALL_EQUIV;
    if (keys.has("arrowup")    || keys.has("w")) dy -= KEYBOARD_TRACKBALL_EQUIV;
    if (keys.has("arrowdown")  || keys.has("s")) dy += KEYBOARD_TRACKBALL_EQUIV;
    const gp = navigator.getGamepads?.()[0];
    if (gp) {
      dx += Math.round((gp.axes[2] ?? 0) * KEYBOARD_TRACKBALL_EQUIV);
      dy += Math.round((gp.axes[3] ?? 0) * KEYBOARD_TRACKBALL_EQUIV);
    }
    p1X = (p1X + dx) & 0xff;
    p1Y = (p1Y + dy) & 0xff;
  }

  return {
    get buttons() { return buttons; },
    consumeP1X() { pollKeyboardAndGamepad(); return p1X; },
    consumeP1Y() { return p1Y; },
    consumeP2X() { return p2X; },
    consumeP2Y() { return p2Y; },
  };
}
