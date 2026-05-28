/**
 * array-9-clear-and-dispatch.ts - mirror of `FUN_000190EE` (62 bytes).
 *
 * "Fan-out" iterator over array-9 (`0x401890`, stride `0x28`, 9 entries; see
 * `slot-array-init.ts` for bulk init and `proximity-check.ts` for another
 * consumer of the same layout). For each entry:
 *   1. Clears byte offset `0x18` (typical "active/state" flag).
 *   2. Reads `[entry+0x19]` and `[entry+0x25]` as sign-extended long bytes,
 *      pushes them as longs on the stack, and calls `FUN_00018F46`.
 *   3. Advances A2 by `0x28` to the next entry.
 *
 * **Caller**: `FUN_000144E4` (1 xref @ 0x000145FC). This is a "reset and
 * notify" routine for the 9 entries, likely used during a level change or
 * global state reset.
 *
 * **Disasm 0x190EE..0x1912B** (62 byte):
 *
 *   movem.l {D2,A2},-(SP)            ; save D2/A2 (8 bytes)
 *   movea.l #0x401890,A2             ; A2 = base array-9
 *   clr.b   D2b                      ; D2 = 0 (loop counter, 9 entry)
 *   ; loop @ 0x190FA:
 *   clr.b   (0x18,A2)                ; entry[0x18] = 0
 *   move.b  (0x19,A2),D0b            ; D0.b = entry[0x19]
 *   ext.w   D0w                      ; D0.w = sign-extend
 *   ext.l   D0                       ; D0   = sign-extend
 *   move.l  D0,-(SP)                 ; push arg2 (long)
 *   move.b  (0x25,A2),D0b            ; D0.b = entry[0x25]
 *   ext.w   D0w                      ; D0.w = sign-extend
 *   ext.l   D0                       ; D0   = sign-extend
 *   move.l  D0,-(SP)                 ; push arg1 (long)
 *   jsr     0x00018f46.l             ; FUN_18F46(arg1, arg2)
 *   moveq   #0x28,D0                 ; D0 = stride
 *   adda.l  D0,A2                    ; A2 += 0x28
 *   addq.l  #8,SP                    ; pop 2 long args
 *   addq.b  #1,D2b                   ; D2++
 *   cmpi.b  #9,D2b                   ; cmp D2,#9
 *   bne.b   0x190FA                  ; if D2 != 9, loop
 *   movem.l (SP)+,{A2,D2}            ; restore
 *   rts
 *
 * **FUN_18F46 stack layout** (after the 2 pushes):
 *   SP+0x00: ret addr (4 bytes) - pushed by `jsr`
 *   SP+0x04: arg1 long = sign-extend(entry[0x25])
 *   SP+0x08: arg2 long = sign-extend(entry[0x19])
 * `FUN_18F46` reads `(0x13,SP).b` (= arg1 low byte) and `(0x17,SP).b`
 * (= arg2 low byte), with `movem.l {A3,A2,D2},-(SP)` in the callee prologue
 * adding 12 bytes -> SP+12 = arg1 low byte = entry[0x25]; SP+16 = arg2 low
 * byte = entry[0x19]. The sign-extension is cosmetic for the callee, but it
 * must be mirrored for bit-perfect stack-frame parity.
 *
 * **Side effects** on work RAM (excluding `FUN_18F46` side effects):
 *   - `workRam[0x1890 + i*0x28 + 0x18] = 0` for i in [0..8].
 *
 * **Call order**: i = 0, 1, 2, ..., 8 (sequential and deterministic).
 *
 * **Return**: no meaningful value; the binary does not set D0 before `rts`,
 * and caller `FUN_144E4` does not read D0 after the `jsr`.
 *
 * Bit-perfect verification:
 * `cli/src/test-array-9-clear-and-dispatch-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Base address of array-9 (9 entries x 0x28 bytes) in work RAM. */
export const ARRAY_BASE = 0x00401890 as const;
/** Stride between consecutive entries. */
export const ARRAY_STRIDE = 0x28 as const;
/** Number of iterated entries. */
export const ARRAY_COUNT = 9 as const;
/** Offset of the byte cleared in each entry. */
export const FLAG_OFFSET = 0x18 as const;
/** Offset of the byte read as the first field (pushed as arg2 long). */
export const FIELD_19_OFFSET = 0x19 as const;
/** Offset of the byte read as the second field (pushed as arg1 long). */
export const FIELD_25_OFFSET = 0x25 as const;

/**
 * Stub injection for the JSR to `FUN_00018F46` (binary callee).
 *
 * `fun_18F46(arg1, arg2, state)`: invoked 9 times, once for each entry.
 *   - `arg1`: sign-extended long from `entry[0x25]` (byte -> word -> long).
 *     Range: [-128, 127], represented as a long (0xFF -> -1 -> 0xFFFFFFFF).
 *   - `arg2`: sign-extended long from `entry[0x19]`; same range/semantics.
 *   - `state`: passed for convenience because the binary callee mutates work RAM.
 *
 * **Note**: the binary pushes both values with `move.l D0,-(SP)` after
 * sign-extension. For stack-frame parity, pass both values as `>>> 0` if the
 * callback treats longs as unsigned. A callback can also ignore the
 * sign-extension and read only the low byte, which is what `FUN_18F46` does.
 *
 * Default no-op, matching the `rts` patch used by the parity test.
 */
export interface Array9ClearAndDispatchSubs {
  /** FUN_18F46(arg1Long, arg2Long, state). Default no-op. */
  fun_18f46?: (arg1Long: number, arg2Long: number, state: GameState) => void;
}

/**
 * Bit-perfect mirror of `FUN_000190EE`: clear flag 0x18 and dispatch
 * `FUN_18F46(entry[0x25], entry[0x19])` for each of the 9 entries in the
 * array @ 0x401890 stride 0x28.
 *
 * @param state  GameState. Writes `workRam[0x1890 + i*0x28 + 0x18] = 0` for
 *               i in [0..8] before the corresponding call, then reads
 *               `workRam[entry+0x19]` and `workRam[entry+0x25]` as signed
 *               bytes sign-extended to longs.
 * @param subs   Stub injection for the JSR to `FUN_18F46`. If omitted, the 9
 *               calls are no-ops and only the flag-clearing side effect remains.
 *
 * **Order**: clear-then-dispatch for entries 0, 1, 2, ..., 8 in strict
 * sequence. This matters for parity: the binary clears entry i and then calls
 * the callback with fields from that same entry. The 0x18 clear is already
 * visible to the callback, while 0x19 and 0x25 are not touched by the clear.
 */
export function array9ClearAndDispatch(
  state: GameState,
  subs?: Array9ClearAndDispatchSubs,
): void {
  const cb = subs?.fun_18f46;
  const r = state.workRam;
  let entryAddr = ARRAY_BASE >>> 0;
  for (let i = 0; i < ARRAY_COUNT; i++) {
    const off = (entryAddr - 0x400000) >>> 0;

    // clr.b (0x18, A2)
    r[off + FLAG_OFFSET] = 0;

    // move.b (0x19,A2),D0b ; ext.w D0w ; ext.l D0 -> push sign-extended long.
    const byte19 = r[off + FIELD_19_OFFSET] ?? 0;
    const arg2Long = byte19 & 0x80 ? (byte19 | 0xffffff00) >>> 0 : byte19;

    // move.b (0x25,A2),D0b ; ext.w D0w ; ext.l D0 -> push sign-extended long.
    const byte25 = r[off + FIELD_25_OFFSET] ?? 0;
    const arg1Long = byte25 & 0x80 ? (byte25 | 0xffffff00) >>> 0 : byte25;

    // jsr 0x00018F46.l - order: arg1 (entry[0x25]) pushed second,
    //                       so SP+4=arg1, SP+8=arg2 inside callee.
    cb?.(arg1Long, arg2Long, state);

    // adda.l #0x28, A2
    entryAddr = (entryAddr + ARRAY_STRIDE) >>> 0;
  }
}
