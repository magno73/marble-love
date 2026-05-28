/**
 * Bit-perfect port of `FUN_00003F78`.
 *
 * The historical name came from an early "EEPROM commit/check tick" label in
 * `main-tick.ts`. The routine does not access EEPROM or MMIO. It drains the
 * work RAM counter at `0x401FF7` into `0x401FF5`, clamps the accumulator to
 * 0x19, then scales it by 12 divided by a player-struct rate.
 *
 * The internal `FUN_3F3E` helper reads the pointer stored at `0x401FFC`,
 * validates `ptr+0xA` against the complement byte at `ptr+0xB`, and returns
 * either 0 or `(status & 3) + 1`. A 0 rate is an early exit returning 0x18.
 * Parity is covered by `test-eeprom-commit-parity.ts`.
 */

import type { GameState } from "./state.js";

/** WorkRam offsets (RAM base 0x400000). */
const ACC_FF5_OFF = 0x1ff5; // (A2) — accumulator drained-from-FF7
const COUNTER_FF7_OFF = 0x1ff7; // drain source counter
const PTR_FFC_OFF = 0x1ffc; // long pointer to player struct

/** RAM base used to convert absolute 68k pointers to work RAM offsets. */
const WORK_RAM_BASE = 0x400000;

/** Status threshold at which the helper returns 0. */
const STATUS_EXIT_THRESHOLD = 0xe0;

/** Upper clamp for `0x401FF5` after draining. */
const ACC_CLAMP_MAX = 0x19;

/** Final scale multiplier from `muls.w #0xC`. */
const SCALE_MUL = 0xc;

/** Early-exit return value when the helper yields 0. */
const EARLY_EXIT_RESULT = 0x18;

/**
 * Bit-perfect port of the internal `FUN_00003F3E` helper.
 *
 * The helper is read-only: it loads the player struct pointer, validates the
 * status/complement pair, and returns 0 or a divisor in the range 1..4.
 */
function helperFun3F3E(state: GameState): number {
  const r = state.workRam;

  // D1 = *(0x401FFC) (long, big-endian).
  const ptr =
    (((r[PTR_FFC_OFF] ?? 0) << 24) |
      ((r[PTR_FFC_OFF + 1] ?? 0) << 16) |
      ((r[PTR_FFC_OFF + 2] ?? 0) << 8) |
      (r[PTR_FFC_OFF + 3] ?? 0)) >>>
    0;
  const ptrOff = (ptr - WORK_RAM_BASE) >>> 0;

  // D2.b = *(ptr + 0xA); D0.b = ~*(ptr + 0xB)
  let d2 = (r[ptrOff + 0xa] ?? 0) & 0xff;
  const notB = ~(r[ptrOff + 0xb] ?? 0) & 0xff;
  // cmp.b D0b, D2b; beq keep else clr.b D2b
  if (d2 !== notB) d2 = 0;

  // cmpi.b #-0x20 (= 0xE0), D2b; bcs small (D2.b < 0xE0 unsigned)
  if (d2 >= STATUS_EXIT_THRESHOLD) {
    return 0;
  }
  // D1 = (D2.b & 3) + 1
  return (d2 & 3) + 1;
}

/**
 * Bit-perfect port of `FUN_00003F78`.
 *
 * Called by `mainTick` via thunk 0x160. It has no arguments and returns D0 as
 * an unsigned long: 0x18 on the early-exit path, otherwise the zero-extended
 * quotient `(clampedAcc * 12) / divisor`.
 */
export function eepromCommit(state: GameState): number {
  const r = state.workRam;

  // `jsr FUN_3F3E`: D0 is the helper return, then copied into D1.w.
  const helperRet = helperFun3F3E(state) & 0xffff;

  // `bne work`: D1.w == 0 takes the 0x18 early exit and leaves counters alone.
  if (helperRet === 0) {
    return EARLY_EXIT_RESULT;
  }

  // D1.w is in 1..4 here by construction.
  const divisor = helperRet; // semantic alias

  // Drain loop:
  //   while (byte@0x401FF7 >= divisor.w unsigned):
  //     byte@0x401FF7 -= divisor.b
  //     byte@0x401FF5 += divisor.b
  //
  // Note bit-perfect:
  //   - `sub.b` and `add.b` wrap at 8 bits; the later clamp handles a wrapped
  //     accumulator exactly as the original code does.
  //   - cmp.w D1w, D0w (D0 word, divisor word, both small positives):
  //     exit when D0.w < divisor.w.
  let counter = (r[COUNTER_FF7_OFF] ?? 0) & 0xff; // byte zero-ext word
  let acc = (r[ACC_FF5_OFF] ?? 0) & 0xff; // byte
  while (counter >= divisor) {
    counter = (counter - divisor) & 0xff; // sub.b
    acc = (acc + divisor) & 0xff; // add.b (wrap byte)
  }
  // Persist the counters. Writing the same value on a zero-iteration path is
  // observationally equivalent to the original loop.
  r[COUNTER_FF7_OFF] = counter;
  r[ACC_FF5_OFF] = acc;

  // Clamp acc to 0x19 (`cmpi.b` + `bls` + `move.b #0x19,(A2)`).
  if (acc > ACC_CLAMP_MAX) {
    acc = ACC_CLAMP_MAX;
    r[ACC_FF5_OFF] = acc;
  }

  // D0 = acc zero-extended long; `muls.w #0xC` yields 0..300.
  const product = (acc * SCALE_MUL) | 0;

  // `divs.w divisor.w,D0`: all operands are positive and the quotient fits in
  // a signed word, so truncation matches 68k signed integer division.
  const quotient = Math.trunc(product / divisor) & 0xffff;

  // moveq #0,D0; move.w D1w,D0w -> D0 = quotient zero-ext long.
  return quotient >>> 0;
}
