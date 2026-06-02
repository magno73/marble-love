/**
 * dispatch-table-1eea0.ts — replica `FUN_00011AD8` (64 byte).
 *
 *   - `arg1Long` = sign-extend(D2.b) (byte -> word -> long, 68000 `ext.w/ext.l`)
 *
 * After the prologue `movem`, SP+12 is arg1 long and SP+15 is its low byte
 * in 68000 big-endian stack layout. If the caller pushes `pea $XXX`, the low byte of `XXX`
 *
 * entryPtrLong)`. The TS replica injects it as a default no-op stub.
 *
 * **Disasm 0x11AD8..0x11B17** (64 byte):
 *
 *   movem.l {D3,D2},-(SP)         ; save D2/D3 (8 byte)
 *   move.b  (0xF, SP), D1.b       ; D1.b = low byte of arg1 long (SP+12 + 3)
 *   move.b  D1.b, D0.b
 *   ext.w   D0.w
 *   ext.l   D0                    ; D0 = signExt(argIdx)
 *   asl.l   #3, D0                ; D0 = signExt(argIdx) * 8
 *   addi.l  #0x1EEA0, D0          ; D0 = 0x1EEA0 + signExt(argIdx)*8
 *   move.b  D1.b, D2.b            ; D2.b = argIdx (loop counter byte)
 *   bra.b   0x11B0C               ; test
 *   ; loop @ 0x11AF4:
 *     addq.l  #8, D3              ; D3 += 8 (next entry)
 *     move.l  D0, -(SP)           ; push arg2 = current pointer (long)
 *     move.b  D2.b, D0.b          ; D0.b = D2.b
 *     ext.w   D0.w
 *     ext.l   D0                  ; D0 = signExt(D2.b)
 *     move.l  D0, -(SP)           ; push arg1 = signExt(D2.b) (long)
 *     jsr     0x1B4.l             ; FUN_0000428E (via thunk @0x1B4 -> 0x428E)
 *     addq.l  #8, SP              ; pop 2 long
 *     addq.b  #1, D2.b            ; D2.b++ (byte add: wraps 0xFF to 0x00)
 *   ; test @ 0x11B0C:
 *     cmpi.b  #0x0A, D2.b         ; D2.b == 0x0A?
 *     bne.b   0x11AF4             ; no, loop
 *   movem.l (SP)+, {D2,D3}        ; restore
 *   rts
 *
 *     starts at 0x1EEA0 + signExt(0x0B)*8 = 0x1EEF8 and advances by 8 each
 *     iteration. The pointer does not use the sign extension of later D2 bytes;
 *     only arg1 does.
 *   - argIdx = 0xFF (signed -1): D3 starts at 0x1EEA0 - 8 = 0x1EE98, and ASL preserves
 *     (D2.b: 0xFF,0x00,...,0x09).
 *
 * **Known callers**: `FUN_0001464A` with two `jsr 0x11AD8.l` sites at 0x148F8 and 0x14918,
 * pattern "score/initials register" (post-game register-name screen).
 *
 *
 */

import type { GameState } from "./state.js";

export const TABLE_BASE = 0x0001eea0 as const;
/** Stride between consecutive entries (`asl.l #3` = x8). */
export const ENTRY_STRIDE = 8 as const;
export const LOOP_SENTINEL = 0x0a as const;

/**
 * thunk `jmp` @ `0x1B4`).
 *
 * Binary signature: two longs on the stack. The callee reads arg1's low byte
 * and a pointer to the entry at `0x1EEA0 + i*8`.
 *
 * Default: no-op, matching the `rts` patch used by parity tests.
 */
export interface DispatchTable1EEA0Subs {
  /**
   * `FUN_428E(arg1Long, arg2Long, state)`.
   *
 * - `arg1Long`: sign-extend(D2.b) as a long, for example 0xFF -> 0xFFFFFFFF.
 *   The pointer uses sign extension of the original argIdx for its base.
   */
  fun_428e?: (arg1Long: number, arg2Long: number, state: GameState) => void;
}

/**
 * Sign-extend a byte to a 32-bit long, matching `ext.w D0w; ext.l D0`.
 */
function signExtByte(b: number): number {
  return ((b & 0x80) !== 0 ? (b | 0xffffff00) : (b & 0xff)) >>> 0;
}

/**
 * up to exclusive sentinel `0x0A`, with byte wrap if `argIdxByte > 0x0A`, calling
 * `FUN_0000428E(signExt(D2.b), basePtr + k*8)` for each k = 0,1,...
 *
 * @param argIdxByte Low byte of the caller's arg1 long. `0x0A` produces zero
 *                   calls; values above `0x0A` wrap as bytes.
 */
export function dispatchTable1EEA0(
  state: GameState,
  argIdxByte: number,
  subs?: DispatchTable1EEA0Subs,
): void {
  const cb = subs?.fun_428e;

  // D1.b = (0xF, SP).b: start byte.
  const argByte = argIdxByte & 0xff;

  // D0 = ext.l(ext.w(D1.b)); D0 *= 8; D0 += 0x1EEA0; D3 = D0
  // signed, then `addi.l` to 0x1EEA0. TS uses modulo-2^32 arithmetic via `>>> 0`.
  const baseSignExt = signExtByte(argByte);
  // ASL.L #3 on a long is `(x << 3)` modulo 2^32.
  const baseShifted = (baseSignExt << 3) >>> 0;
  let ptr = (baseShifted + TABLE_BASE) >>> 0;

  let counterByte = argByte;

  // hard-cap at 256 + 1 for safety.
  for (let safety = 0; safety <= 256; safety++) {
    if (counterByte === LOOP_SENTINEL) return;

    // jsr 0x1B4 -> FUN_428E. Args (RTL push):
    //   arg1Long = signExt(D2.b)
    //              `move.l D3, D0; addq.l #8, D3; move.l D0, -(SP)`).
    const arg1Long = signExtByte(counterByte);
    const arg2Long = ptr;
    cb?.(arg1Long, arg2Long, state);

    ptr = (ptr + ENTRY_STRIDE) >>> 0;

    // addq.b #1, D2.b (byte add with wrap)
    counterByte = (counterByte + 1) & 0xff;
  }

  /* c8 ignore next */
  throw new Error("dispatchTable1EEA0: safety loop exceeded");
}
