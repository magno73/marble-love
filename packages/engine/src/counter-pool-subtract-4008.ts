/**
 * Bit-perfect replica of `FUN_00004008`.
 *
 * This helper consumes a requested byte count from a sound-dispatch pool made
 * of drain counter `0x401FF7` plus accumulator `0x401FF5`. It drains the
 * counter first, then subtracts the remaining amount from the accumulator.
 *
 * Related audio-pacing helpers:
 *   - `eeprom-commit.ts` (`FUN_3F78`), convert accumulator to scaled output.
 *   - `eeprom-commit-request.ts` (`FUN_3FC6`), increment / scaled decrement.
 *   - this routine (`FUN_4008`), request subtract from the pool.
 *
 * All three call `FUN_3F3E`, which validates the player-struct status byte at
 * `*0x401FFC + 0x0A` and returns either 0 for status >= 0xE0 or
 * `(status & 3) + 1`.
 *
 * **Disasm 0x4008..0x4057** (80 byte / 0x50):
 *
 *   0x4008  movem.l {A2 D2},-(SP)            ; preserve A2, D2 (8 byte)
 *   0x400C  move.l  (0xC,SP),D2              ; D2 = arg1 (long)
 *   0x4010  movea.l #0x401FF7,A2             ; A2 = counter ptr
 *   0x4016  jsr     FUN_3F3E                 ; helper -> D0 = 0 o 1..4
 *   0x401C  tst.l   D0
 *   0x401E  bne.b   0x4024                   ; D0 != 0 -> work
 *   0x4020  moveq   #1,D0                    ; helper=0 -> ret 1 (no-op)
 *   0x4022  bra.b   0x4052                   ; -> epilogue
 *   0x4024  moveq   #0,D0
 *   0x4026  move.b  (A2),D0b                 ; D0 = byte @ 0x401FF7 (zero-ext)
 *   0x4028  moveq   #0,D1
 *   0x402A  move.b  (0x401FF5).l,D1b         ; D1 = byte @ 0x401FF5 (zero-ext)
 *   0x4030  add.l   D1,D0                    ; D0 = counter + acc (long)
 *   0x4032  cmp.l   D2,D0                    ; flags = D0 - D2
 *   0x4034  bcc.b   0x403A                   ; D0 >= D2 unsigned -> drain
 *   0x4036  moveq   #0,D0                    ; pool < arg1 -> ret 0
 *   0x4038  bra.b   0x4052
 *
 *   ; drain loop: drain counter@FF7 while D2 signed > 0 and (A2) != 0.
 *   0x403A: tst.l   D2
 *   0x403C  ble.b   0x4048                   ; D2 <= 0 signed -> after_loop
 *   0x403E  tst.b   (A2)
 *   0x4040  bls.b   0x4048                   ; (A2) <= 0 unsigned -> after_loop
 *                                             ; with tst.b, C=0 so bls = Z
 *   0x4042  subq.l  #1,D2                    ; D2 -= 1
 *   0x4044  subq.b  #1,(A2)                  ; counter@FF7 -= 1
 *   0x4046  bra.b   0x403A                   ; loop
 *
 *   ; after_loop: D2 is the remainder after draining the counter.
 *   0x4048  move.b  D2b,D0b                  ; D0.b = D2.b
 *   0x404A  sub.b   D0b,(0x401FF5).l         ; acc@FF5 -= D2.b (modulo 256)
 *   0x4050  moveq   #1,D0                    ; ret 1 (success)
 *
 *   0x4052: movem.l (SP)+,{D2 A2}
 *   0x4056  rts
 *
 * **Bit-perfect notes**:
 *
 *   1. `cmp.l D2,D0; bcc` is an unsigned long compare. A sign-extended
 *      negative `arg1` therefore fails because the combined pool is at most
 *      0x1FE.
 *   2. `tst.l D2; ble` treats the remaining request as signed. After the
 *      unsigned pre-check, real callers reach the loop with a small positive
 *      or zero value.
 *   3. `tst.b (A2); bls` exits only when the counter byte is zero, because
 *      `tst.b` clears C.
 *   4. Byte and long subtracts are modeled with the same wrap behavior as the
 *      68000 instructions.
 *
 * **Side effects**: only in the "work" path (helper != 0 AND pool >= arg1):
 *   - `0x401FF7` -= min(arg1, initial counter)
 *   - `0x401FF5` -= max(0, arg1 - initial counter)
 *
 * In the "early exit" (helper=0) and "insufficient" (pool < arg1) paths:
 *   - no workRam changes.
 *
 * **Internal JSR**: only `FUN_3F3E`, inlined below like `eeprom-commit.ts`.
 *
 * **MMIO**: none. Only workRam at 0x401FFC, 0x401FF5, 0x401FF7, and bytes at
 * `(*0x401FFC) + 0x0A/0x0B`.
 *
 * **Stack layout** on entry, after the 8-byte `movem`:
 *   SP+0x00..0x07  saved A2, D2 (8 byte)
 *   SP+0x08..0x0B  return PC (4 byte)
 *   SP+0x0C..0x0F  arg1 long (push-RTL bottom arg)
 *
 * **Caller sites**: one xref via thunk @ 0x230.
 *
 * Verified by `test-counter-pool-subtract-4008-parity.ts`.
 */

import type { GameState } from "./state.js";

/** WorkRam offsets (RAM base 0x400000). */
const ACC_FF5_OFF = 0x1ff5;
const COUNTER_FF7_OFF = 0x1ff7;
const PTR_FFC_OFF = 0x1ffc;

/** Absolute 68000 work RAM base. */
const WORK_RAM_BASE = 0x400000;

/** Status threshold at which `FUN_3F3E` returns 0. */
const STATUS_EXIT_THRESHOLD = 0xe0;

/** Return code "success / no-op" (`D0 = 1`). */
export const RET_SUCCESS = 1 as const;

/** Return code "pool insufficient" (`D0 = 0`). */
export const RET_INSUFFICIENT = 0 as const;

/**
 * Helper `FUN_3F3E`, same logic as `eeprom-commit.ts`.
 *
 * Reads `*0x401FFC` as the player-struct pointer, validates status byte
 * `ptr+0x0A` against the complement byte at `ptr+0x0B`, and returns:
 *   - 0 if status >= 0xE0.
 *   - `(status & 3) + 1` otherwise.
 *
 * Pure read: no workRam side effects.
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
  if (d2 !== notB) d2 = 0;

  // cmpi.b #-0x20 (= 0xE0), D2b; bcs small (D2.b < 0xE0 unsigned)
  if (d2 >= STATUS_EXIT_THRESHOLD) {
    return 0;
  }
  return (d2 & 3) + 1;
}

/**
 * Bit-perfect replica of `FUN_00004008`, counter-pool subtract.
 *
 * Attempts to subtract `arg1` bytes from `counter@FF7 + acc@FF5`, draining the
 * counter first and the accumulator second. Returns D0 as 0/1.
 *
 * @param state  GameState. Legge:
 *   - `*0x401FFC` (long ptr) e bytes a ptr+0xA / +0xB (via helper)
 *   - `0x401FF7` (counter), `0x401FF5` (acc)
 *
 *   Mutates only on the work path:
 *   - `0x401FF7` -= n  (drain, byte modulo 256)
 *   - `0x401FF5` -= m  (remaining amount, byte modulo 256)
 *
 *   Early-exit and insufficient paths do not mutate work RAM.
 *
 * @param arg1   68000 long amount to subtract from the pool.
 *
 * @returns      D0 long:
 *   - 1 if helper status >= 0xE0 (no-op, early exit)
 *   - 0 if pool < arg1 unsigned (insufficient, no-op)
 *   - 1 if subtraction succeeded
 */
export function counterPoolSubtract4008(
  state: GameState,
  arg1: number,
): number {
  const r = state.workRam;
  const arg1l = arg1 >>> 0;

  // ── 0x4016: jsr FUN_3F3E. ──
  // tst.l D0; bne work; moveq #1,D0; bra epilogue.
  // helper == 0 means status >= 0xE0: early exit with ret 1, no mutation.
  if (helperFun3F3E(state) === 0) {
    return RET_SUCCESS;
  }

  // ── 0x4024..0x4030: D0 = byte@FF7 + byte@FF5 (long, zero-ext). ──
  const counter0 = (r[COUNTER_FF7_OFF] ?? 0) & 0xff;
  const acc0 = (r[ACC_FF5_OFF] ?? 0) & 0xff;
  const pool = (counter0 + acc0) >>> 0;

  // ── 0x4032..0x4038: cmp.l D2,D0; bcc drain; ret 0. ──
  // bcc = D0 >= D2 unsigned. If pool < arg1 unsigned, return insufficient.
  if (pool < arg1l) {
    return RET_INSUFFICIENT;
  }

  // ── 0x403A..0x4046: drain loop. ──
  // tst.l D2 (signed); ble after_loop.
  // tst.b (A2); bls after_loop.  (bls = Z su tst.b, cioe' counter == 0)
  // Loop body: D2 -= 1 (long); counter -= 1 (byte).
  //
  // D2 is a small positive value here, so `tst.l + ble` acts like `while > 0`.
  let d2 = arg1l | 0; // signed view (i32) per il check `ble` (D2 <= 0 signed).
  let counter = counter0;
  while (d2 > 0 && counter !== 0) {
    d2 = (d2 - 1) | 0;
    counter = (counter - 1) & 0xff;
  }

  // ── 0x4048..0x4050: sub.b D2b,(0x401FF5); ret 1. ──
  // D2 is the remainder; `sub.b` is modulo 256.
  const d2b = d2 & 0xff;
  const accNew = (acc0 - d2b) & 0xff;

  // Persist the two mutated bytes.
  r[COUNTER_FF7_OFF] = counter;
  r[ACC_FF5_OFF] = accNew;

  return RET_SUCCESS;
}
