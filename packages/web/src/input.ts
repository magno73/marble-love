/**
 * input.ts — input mapping browser → engine MMIO trackball values.
 *
 * Modello MMIO MAME: il trackball P1/P2 è un encoder relativo che
 * `processAxis` (engine/trackball-input.ts) legge come BYTE assoluto 0..255
 * con wrap-around. Il delta è ricavato 68k-side via `cur - prev` (mod 256).
 *
 * MAME ruota i due assi fisici Marble a 45 gradi (`trakball_r`):
 *   F20000 = rawX + rawY
 *   F20002 = rawX - rawY
 *
 * Il replay/oracle usa questa rotazione per restare fedele al trackball MAME.
 * Per il controllo umano live invece frecce/mouse sono screen-space: destra
 * deve muovere un solo asse orizzontale, non diventare diagonale. Il browser
 * quindi integra i delta live gia' nello spazio MMIO ruotato, con X invertito
 * rispetto al DOM e Y DOM invertito, mantenendo comunque valori ABSOLUTE
 * 0..255. Questo evita il bug "primo frame": cur=0 vs prev=0xff
 * (seed MAME) → delta=1 → write spurious. Mantenendo cur=0xff stabile quando
 * nessun input → delta=0.
 *
 * Phase 7: implementare anche pulsanti virtuali e accelerometro mobile.
 */

const DEFAULT_KEYBOARD_TRACKBALL_EQUIV = 32;
const MAX_KEYBOARD_TRACKBALL_EQUIV = 64;
const DEFAULT_POINTER_TRACKBALL_SCALE = 2;
const MIN_POINTER_TRACKBALL_SCALE = 0.25;
const MAX_POINTER_TRACKBALL_SCALE = 8;
const TRACKBALL_KEYS = new Set([
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
  "a",
  "d",
  "w",
  "s",
]);
const START_KEYS = new Set([" ", "enter"]);
const COIN_KEYS = new Set(["5", "c"]);
const POINTER_LOCK_UI_SELECTOR = "button,a,input,select,textarea,[role='button'],[data-no-pointer-lock]";

export interface InputState {
  buttons: number;
  inputMmio: number;
  consumeCoinPulses(): number;
  consumeStartPulses(): number;
  setP1Absolute(x: number, y: number): void;
  consumeP1X(): number; // 0..255 absolute
  consumeP1Y(): number;
  consumeP2X(): number;
  consumeP2Y(): number;
  /** Touch/UI helper: simula 1 pulse coin (= keydown "5"). */
  triggerCoinPulse(): void;
  /** Touch/UI helper: simula 1 pulse start (= keydown "Enter"). */
  triggerStartPulse(): void;
}

export interface InputOptions {
  keyboardTrackballStep?: number;
  pointerTrackballScale?: number;
}

export function normalizeKeyboardTrackballStep(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_KEYBOARD_TRACKBALL_EQUIV;
  return Math.max(1, Math.min(MAX_KEYBOARD_TRACKBALL_EQUIV, Math.round(value)));
}

export function normalizePointerTrackballScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_POINTER_TRACKBALL_SCALE;
  return Math.max(MIN_POINTER_TRACKBALL_SCALE, Math.min(MAX_POINTER_TRACKBALL_SCALE, value));
}

export function rotateMarbleTrackballDelta(dx: number, dy: number): { x: number; y: number } {
  const rawX = dx | 0;
  const rawY = dy | 0;
  return {
    x: rawX + rawY,
    y: rawX - rawY,
  };
}

export function mapLiveScreenDeltaToTrackballDelta(dx: number, dy: number): { x: number; y: number } {
  const screenX = dx | 0;
  const screenY = dy | 0;
  return {
    x: screenX === 0 ? 0 : -screenX,
    y: screenY === 0 ? 0 : -screenY,
  };
}

export function isCoinKey(key: string): boolean {
  return COIN_KEYS.has(key.toLowerCase());
}

export function isStartKey(key: string): boolean {
  return START_KEYS.has(key.toLowerCase());
}

function isPointerLockUiTarget(target: EventTarget | null): boolean {
  const closest = (target as { closest?: (selector: string) => unknown } | null)?.closest;
  return typeof closest === "function" && closest.call(target, POINTER_LOCK_UI_SELECTOR) !== null;
}

function ignorePointerLockRejection(result: void | Promise<void>): void {
  if (result !== undefined) void result.catch(() => undefined);
}

export function initInput(options: InputOptions = {}): InputState {
  const keyboardTrackballStep = normalizeKeyboardTrackballStep(options.keyboardTrackballStep);
  const pointerTrackballScale = normalizePointerTrackballScale(options.pointerTrackballScale);

  // Stato assoluto trackball (= valore MMIO 0xF20001 etc.). Inizializzato a
  // 0xff (= MMIO stable in MAME attract mode con processAxis seed prev=0xff).
  let p1X = 0xff;
  let p1Y = 0xff;
  let p2X = 0xff;
  let p2Y = 0xff;
  let buttons = 0;
  let coinPulses = 0;
  let startPulses = 0;

  const keys = new Set<string>();
  const addP1ScreenDelta = (dx: number, dy: number, scale = 1): void => {
    const scaledX = Math.round(dx * scale);
    const scaledY = Math.round(dy * scale);
    const mapped = mapLiveScreenDeltaToTrackballDelta(scaledX, scaledY);
    p1X = (p1X + mapped.x) & 0xff;
    p1Y = (p1Y + mapped.y) & 0xff;
  };

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    keys.add(key);
    if (TRACKBALL_KEYS.has(key)) e.preventDefault();
    if (isStartKey(e.key)) {
      buttons |= 0x01;
      if (!e.repeat) startPulses += 1;
    }
    if (isCoinKey(e.key)) {
      buttons |= 0x04;
      if (!e.repeat) coinPulses += 1;
    }
  });
  window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    keys.delete(key);
    if (isStartKey(e.key)) buttons &= ~0x01;
    if (isCoinKey(e.key)) buttons &= ~0x04;
  });

  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement) {
      addP1ScreenDelta(e.movementX | 0, e.movementY | 0, pointerTrackballScale);
    }
  });
  window.addEventListener("click", (e) => {
    if (document.pointerLockElement || isPointerLockUiTarget(e.target)) return;
    ignorePointerLockRejection(document.body.requestPointerLock?.());
  });

  let lastTouch: { x: number; y: number } | null = null;
  window.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (t) lastTouch = { x: t.clientX, y: t.clientY };
  });
  window.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (t && lastTouch) {
      addP1ScreenDelta(
        (t.clientX - lastTouch.x) | 0,
        (t.clientY - lastTouch.y) | 0,
        pointerTrackballScale,
      );
      lastTouch = { x: t.clientX, y: t.clientY };
    }
  });
  window.addEventListener("touchend", () => {
    lastTouch = null;
  });

  function pollKeyboardAndGamepad(): void {
    let dx = 0, dy = 0;
    if (keys.has("arrowleft")  || keys.has("a")) dx -= keyboardTrackballStep;
    if (keys.has("arrowright") || keys.has("d")) dx += keyboardTrackballStep;
    if (keys.has("arrowup")    || keys.has("w")) dy -= keyboardTrackballStep;
    if (keys.has("arrowdown")  || keys.has("s")) dy += keyboardTrackballStep;
    const gp = navigator.getGamepads?.()[0];
    if (gp) {
      dx += Math.round((gp.axes[2] ?? 0) * keyboardTrackballStep);
      dy += Math.round((gp.axes[3] ?? 0) * keyboardTrackballStep);
    }
    addP1ScreenDelta(dx, dy);
  }

  return {
    get buttons() { return buttons; },
    get inputMmio() {
      let value = 0x6f;
      if ((buttons & 0x01) !== 0) value &= ~0x01;
      if ((buttons & 0x02) !== 0) value &= ~0x02;
      return value & 0xff;
    },
    consumeCoinPulses() {
      const out = coinPulses;
      coinPulses = 0;
      return out;
    },
    consumeStartPulses() {
      const out = startPulses;
      startPulses = 0;
      return out;
    },
    setP1Absolute(x: number, y: number) {
      p1X = x & 0xff;
      p1Y = y & 0xff;
    },
    consumeP1X() { pollKeyboardAndGamepad(); return p1X; },
    consumeP1Y() { return p1Y; },
    consumeP2X() { return p2X; },
    consumeP2Y() { return p2Y; },
    triggerCoinPulse() {
      coinPulses += 1;
      buttons |= 0x04;
      // Auto-release dopo 1 frame: buttons clear via consumeP1X poll? No,
      // poll non resetta. Lascio buttons bit set; ricomincia da clear su
      // keydown/keyup. Per browser coin pulse, basta pulse counter.
      setTimeout(() => { buttons &= ~0x04; }, 50);
    },
    triggerStartPulse() {
      startPulses += 1;
      buttons |= 0x01;
      setTimeout(() => { buttons &= ~0x01; }, 50);
    },
  };
}
