/**
 * Bit-perfect port of `FUN_00026196`.
 *
 * The routine reads a flag byte at `structPtr + 0x1A`, selects magnitude
 * `0x40000` for flag clear or `0x50000` for flag set, then dispatches to the
 * inner `FUN_000261BC(structPtr, magnitude)` routine.
 *
 * **Disasm 0x26196..0x261BB** (38 byte):
 *
 *   00026196   movea.l (0x4,SP),A0          ; A0 = arg1 (struct ptr)
 *   0002619a   tst.b   (0x1a,A0)            ; flag byte @ struct+0x1A
 *   0002619e   bne.b   0x000261A8           ; bit set → big magnitude
 *   000261a0   move.l  #0x40000,D0          ; flag==0 → magnitude = 0x40000
 *   000261a6   bra.b   0x000261AE
 *   000261a8   move.l  #0x50000,D0          ; flag!=0 → magnitude = 0x50000
 *   000261ae   move.l  D0,-(SP)             ; push magnitude
 *   000261b0   move.l  A0,-(SP)             ; push struct ptr
 *   000261b2   jsr     0x000261BC.l         ; FUN_261BC(structPtr, magnitude)
 *   000261b8   addq.l  #0x8,SP              ; clean up 2 long args
 *   000261ba   rts                          ; return whatever D0 inner left
 *
 * Only the wrapper selection and call convention live here. The larger inner
 * routine belongs to the `sub-261bc` port and is injected for parity tests.
 */

import type { GameState } from "./state.js";

/** Offset of the flag byte inside the struct passed as arg1. */
const STRUCT_FLAG_BYTE_OFF = 0x1a;

export const MAGNITUDE_FLAG_CLEAR = 0x40000 as const;

export const MAGNITUDE_FLAG_SET = 0x50000 as const;

/** Work RAM base (`0x400000..0x401FFF`). */
const WORK_RAM_BASE = 0x400000;

/**
 * Callback model for `FUN_000261BC`.
 * It receives the original struct pointer and the selected long magnitude,
 * then returns the D0 value left by the inner routine.
 */
export type DispatchInner = (structPtr: number, magnitude: number) => number;

/**
 * Port of `FUN_00026196`, the flag-scaled magnitude dispatch wrapper.
 */
export function flagScaledMagnitudeDispatch(
  state: GameState,
  structPtr: number,
  inner: DispatchInner,
  flagByteOverride?: number,
): number {
  // Tests can override the flag byte without building a full work RAM struct.
  let flagByte: number;
  if (flagByteOverride !== undefined) {
    flagByte = flagByteOverride & 0xff;
  } else {
    const off = ((structPtr - WORK_RAM_BASE) >>> 0) + STRUCT_FLAG_BYTE_OFF;
    flagByte = state.workRam[off] ?? 0;
  }

  const magnitude =
    flagByte !== 0 ? MAGNITUDE_FLAG_SET : MAGNITUDE_FLAG_CLEAR;

  const d0 = inner(structPtr >>> 0, magnitude >>> 0);
  return d0 >>> 0;
}

/**
 * Expose the constant selection without running the inner dispatch. Useful for
 * traces and tests that need just the `tst.b (0x1A,A0)` behavior.
 */
export function selectMagnitude(flagByte: number): number {
  return (flagByte & 0xff) !== 0
    ? MAGNITUDE_FLAG_SET
    : MAGNITUDE_FLAG_CLEAR;
}
