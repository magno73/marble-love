/**
 * input.ts - input mapping from browser events to engine MMIO trackball values.
 *
 * MAME MMIO model: the P1/P2 trackball is a relative encoder, but
 * `processAxis` reads it as an absolute byte in the 0..255 range with
 * wrap-around. The 68010 side derives the delta with `cur - prev` modulo 256.
 *
 * MAME rotates Marble Madness' two physical axes by 45 degrees in
 * `trakball_r`:
 *   F20000 = rawX + rawY
 *   F20002 = rawX - rawY
 *
 * Replay/oracle input uses that rotation to match MAME. Live human control is
 * screen-space instead: right should move horizontally, not diagonally. The
 * browser therefore integrates live deltas directly in the rotated MMIO space,
 * with X inverted from DOM coordinates and DOM Y inverted, while still keeping
 * absolute 0..255 values. Keeping the idle value at 0xff also avoids the
 * first-frame `cur=0` vs `prev=0xff` spurious delta.
 *
 * Future mobile work can add virtual buttons and accelerometer input here.
 */

// Keyboard is digital, so — like MAME's `keydelta` for an analog port — a held
// key adds a trackball step every frame. Taps use the base step (default 24,
// tuned by feel; override via ?keyboardStep). A key held beyond a short delay
// ramps the step up to the trackball ceiling: a physical trackball can be
// spun hard, and some spots genuinely need that (the Silly Race counter-slope
// climb is unpassable at a constant 24), so a sustained hold is mapped to a
// sustained hard spin while short presses keep their fine control.
const DEFAULT_KEYBOARD_TRACKBALL_EQUIV = 24;
const MAX_KEYBOARD_TRACKBALL_EQUIV = 64;
const KEYBOARD_RAMP_DELAY_FRAMES = 30; // ~0.5 s at 60 fps before ramping
const KEYBOARD_RAMP_FRAMES = 45; // frames from ramp start to the ceiling
// Pointer (mouse/touch) is analog — the faithful analogue of the physical
// trackball. `scale` is its sensitivity (trackball counts per screen pixel), the
// counterpart of MAME's PORT_SENSITIVITY. Default 1 (1:1) is tuned by feel;
// override via ?trackballScale.
const DEFAULT_POINTER_TRACKBALL_SCALE = 1;
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
  /** Touch/UI helper: simulates one coin pulse (= keydown "5"). */
  triggerCoinPulse(): void;
  /** Touch/UI helper: simulates one start pulse (= keydown "Enter"). */
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

/**
 * Per-frame keyboard trackball step for a direction held `framesHeld` frames:
 * the base step within the tap window, then a linear ramp to the trackball
 * ceiling so long holds deliver a hard sustained spin.
 */
export function keyboardRampStep(baseStep: number, framesHeld: number): number {
  if (framesHeld <= KEYBOARD_RAMP_DELAY_FRAMES || baseStep >= MAX_KEYBOARD_TRACKBALL_EQUIV) {
    return baseStep;
  }
  const t = Math.min(1, (framesHeld - KEYBOARD_RAMP_DELAY_FRAMES) / KEYBOARD_RAMP_FRAMES);
  return Math.round(baseStep + t * (MAX_KEYBOARD_TRACKBALL_EQUIV - baseStep));
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

  // Absolute trackball state (= MMIO value 0xF20001 etc.). Start at 0xff to
  // match MAME attract-mode stability when processAxis also seeds prev=0xff.
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

  const keyboardHeldFrames = { left: 0, right: 0, up: 0, down: 0 };
  function keyboardDirectionStep(active: boolean, dir: keyof typeof keyboardHeldFrames): number {
    keyboardHeldFrames[dir] = active ? keyboardHeldFrames[dir] + 1 : 0;
    return active ? keyboardRampStep(keyboardTrackballStep, keyboardHeldFrames[dir]) : 0;
  }

  function pollKeyboardAndGamepad(): void {
    let dx = 0, dy = 0;
    dx -= keyboardDirectionStep(keys.has("arrowleft") || keys.has("a"), "left");
    dx += keyboardDirectionStep(keys.has("arrowright") || keys.has("d"), "right");
    dy -= keyboardDirectionStep(keys.has("arrowup") || keys.has("w"), "up");
    dy += keyboardDirectionStep(keys.has("arrowdown") || keys.has("s"), "down");
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
      // Auto-release outside the keyboard path; the pulse counter is the
      // authoritative signal for browser UI coin buttons.
      setTimeout(() => { buttons &= ~0x04; }, 50);
    },
    triggerStartPulse() {
      startPulses += 1;
      buttons |= 0x01;
      setTimeout(() => { buttons &= ~0x01; }, 50);
    },
  };
}
