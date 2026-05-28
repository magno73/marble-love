/**
 * string-slot-match-1730c.ts — `FUN_0001730C` replica (58 bytes).
 *
 *
 *
 * **Disasm 0x1730C..0x17345** (58 byte):
 *
 *   0001730c   move.l  D2, -(SP)              ; save D2 (callee-saved)
 *   0001730e   movea.l (0x8, SP), A0          ; A0 = argPtr (SP+8: D2 + ret + arg)
 *   00017312   clr.b   D2b                    ; D2 = 0 ("match found" accumulator)
 *   0001731a   clr.b   D1b                    ; D1 = 0 (loop counter byte)
 *   ; loop @ 0x1731C, i in [0..6]:
 *   0001731c   tst.b   (0x18, A1)             ; slot[i].byte+0x18 (active flag)
 *   00017322   move.l  (0x2, A0), D0          ; D0 = *(argPtr + 0x2) long (ID)
 *   00017326   cmp.l   (0x30, A1), D0         ; cmp slot[i].long+0x30, D0
 *   0001732c   moveq   #1, D2                 ; match → D2 = 1
 *   0001732e   bra.b   0x1733C                ; → epilog (early exit)
 *   00017330   moveq   #0x42, D0              ; stride
 *   00017332   adda.l  D0, A1                 ; A1 += stride
 *   00017334   addq.b  #1, D1b                ; counter++
 *   00017336   cmpi.b  #0x7, D1b
 *   0001733a   bne.b   0x1731C                ; loop while != 7
 *   ; epilog:
 *   0001733c   move.b  D2b, D0b
 *   0001733e   ext.w   D0w
 *   00017340   ext.l   D0                     ; D0 = sign-extend di D2.b (0 o 1)
 *   00017342   move.l  (SP)+, D2              ; restore D2
 *   00017344   rts
 *
 *
 *
 *
 * **Field semantics** (for symmetry with other `slotMatchesPtr_*` helpers):
 *   - `byte+0x18` = active flag (0 = free/inactive, !=0 = occupied).
 *   - `long+0x30` = 32-bit record ID, e.g. pointer-equivalent or handle.
 *   - `argPtr+0x2` = candidate ID (long), same layout as the records.
 *
 */

import type { GameState } from "./state.js";

export const SLOT_BASE_ADDR = 0x401482 as const;
/** Byte stride between consecutive slots (`moveq #0x42, D0`). */
export const SLOT_STRIDE = 0x42 as const;
/** Number of slots iterated by the loop (`cmpi.b #0x7, D1b`). */
export const SLOT_COUNT = 7 as const;
/** Offset del flag "active" within slot (`tst.b (0x18, A1)`). */
export const SLOT_ACTIVE_FLAG_OFF = 0x18 as const;
export const SLOT_ID_LONG_OFF = 0x30 as const;
export const ARG_ID_LONG_OFF = 0x2 as const;

/** WORK RAM base for subtracting absolute 68k addresses. */
const WORK_RAM_BASE = 0x400000;

/**
 */
export type StringSlotMatch1730CSubs = Record<string, never>;

/**
 * Replica `move.l (off, Ax), Dx` del 68k (BE memory).
 */
function readU32BE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

/**
 *
 *
 *                 il long a `argPtr+0x2`.
 * @param _subs    placeholder (FUN_1730C non ha JSR).
 *
 * palette / sprite / alpha RAM sono invariati.
 */
export function stringSlotMatch1730C(
  state: GameState,
  argPtr: number,
  _subs?: StringSlotMatch1730CSubs,
): number {
  // *(argPtr + 0x2) long — ID candidato.
  const argOff = ((argPtr - WORK_RAM_BASE) >>> 0) + ARG_ID_LONG_OFF;
  const targetId = readU32BE(state, argOff);

  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = (SLOT_BASE_ADDR + i * SLOT_STRIDE) - WORK_RAM_BASE;

    // tst.b (0x18, A1): if slot inactive, skip.
    const active = state.workRam[slotOff + SLOT_ACTIVE_FLAG_OFF] ?? 0;
    if (active === 0) continue;

    // cmp.l (0x30, A1), D0
    const slotId = readU32BE(state, slotOff + SLOT_ID_LONG_OFF);
    if (slotId === targetId) {
      // Early exit: bra.b epilog with D2=1.
      return 1;
    }
  }

  return 0;
}
