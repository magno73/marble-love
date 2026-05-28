/**
 *
 *
 * Behavior: for each of the 2 game objects (slot 0 = P1, slot 1 = P2):
 *   3. Anti-wraparound clamp: if |delta| > 0x60 and XOR(prev_delta, delta) >= 0
 *      (when delta was positive). Anti-glitch logic for bad reads.
 *   4. Save delta in obj.+0xC7.
 *   5. Same for Y (previous at +0xC8, delta at +0xC6).
 *
 *
 * Side effects:
 *   - state.workRam[obj+0xC9] = current trackball X (raw)
 *   - state.workRam[obj+0xC7] = delta X (clamped)
 *   - state.workRam[obj+0xC8] = current trackball Y (raw)
 *   - state.workRam[obj+0xC6] = delta Y (clamped)
 *
 * hardware Atari (`atarisys1.cpp:281 trakball_r`: cur[0]=posx+posy,
 */

import type { GameState } from "./state.js";

export const OBJ_BASE_ADDR = 0x400018 as const;
export const OBJ_STRIDE = 0xe2 as const;
export const OBJ_FIELD_TRACKBALL_X = 0xc9 as const; // saved X
export const OBJ_FIELD_DELTA_X = 0xc7 as const;     // delta X
export const OBJ_FIELD_TRACKBALL_Y = 0xc8 as const; // saved Y
export const OBJ_FIELD_DELTA_Y = 0xc6 as const;     // delta Y

/** Sign-extend byte → i32. */
function sext8(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

/**
 * Processes one trackball axis for one object.
 *
 * Replicates the `process X` (and `process Y`) block from FUN_1AC18:
 *   D1 = D0
 *   D0 -= obj[savedField]      // delta byte (.b subtract, signed wrap)
 *   D2 = D0
 *   obj[savedField] = D1        // save current
 *   if D2 > 0x60 SIGNED OR D2 < -0x60 SIGNED:
 *     D0 = obj[deltaField] XOR D2    // sign comparison
 *     if D0 >= 0 SIGNED:        // same sign as previous delta
 *       D2 = (D2 >= 0) ? -0x80 : 0x7F   // saturate to opposite extreme
 *     // else: keep D2 as-is (sign change suggests legit wraparound)
 *   obj[deltaField] = D2
 */
function processAxis(
  state: GameState,
  objBase: number,
  current: number,
  savedFieldOffset: number,
  deltaFieldOffset: number,
): void {
  const cur = current & 0xff;
  const prev = state.workRam[objBase + savedFieldOffset] ?? 0;

  // delta byte = cur - prev (mod 256)
  const deltaUnsigned = (cur - prev) & 0xff;
  let delta = sext8(deltaUnsigned);

  // Save current as new previous
  state.workRam[objBase + savedFieldOffset] = cur;

  // Clamp anti-wraparound: delta out of [-0x60, 0x60] → check XOR with prev_delta.
  // Disasm flow:
  //   if (D2 > 0x60 OR D2 < -0x60):
  //     D0 = prev_delta XOR D2
  //     tst.b D0; bge.b skip       ← skip if XOR >= 0 SIGNED (same sign)
  //     tst.b D2; bge.b D2_pos
  //     D2 = 0x7F                  ← (D2 < 0) saturate positive
  //     bra skip
  //     D2_pos: D2 = -0x80         ← (D2 >= 0) saturate to most negative
  //   skip:
  if (delta > 0x60 || delta < -0x60) {
    const prevDelta = sext8(state.workRam[objBase + deltaFieldOffset] ?? 0);
    const xorSigned = sext8((prevDelta ^ delta) & 0xff);
    if (xorSigned < 0) {
      delta = delta >= 0 ? -0x80 : 0x7f;
    }
    // else: same sign → keep delta as-is
  }

  // Save delta byte
  state.workRam[objBase + deltaFieldOffset] = delta & 0xff;
}

/**
 * Processa input trackball per i 2 game object (P1, P2).
 *
 * @param p1X  byte trackball X player 1 (raw)
 * @param p1Y  byte trackball Y player 1
 * @param p2X  byte trackball X player 2
 * @param p2Y  byte trackball Y player 2
 */
export function trackballInputTick(
  state: GameState,
  p1X: number,
  p1Y: number,
  p2X: number,
  p2Y: number,
): void {
  const xs = [p1X, p2X];
  const ys = [p1Y, p2Y];

  for (let player = 0; player < 2; player++) {
    const objBase = (OBJ_BASE_ADDR - 0x400000) + player * OBJ_STRIDE;

    // Process X
    processAxis(state, objBase, xs[player]!, OBJ_FIELD_TRACKBALL_X, OBJ_FIELD_DELTA_X);

    // Process Y
    processAxis(state, objBase, ys[player]!, OBJ_FIELD_TRACKBALL_Y, OBJ_FIELD_DELTA_Y);
  }
}
