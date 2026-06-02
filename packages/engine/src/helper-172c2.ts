/**
 * Bit-perfect port of `FUN_000172C2`.
 *
 * Scans seven slot records starting at `0x401482` with a stride of `0x42`
 * bytes. For each record it tests byte `+0x18`; whenever that byte is zero,
 * D3 is updated to the slot's absolute address. The final D3 value is returned,
 * or `0xffffffff` if no inactive slot was observed.
 *
 * **Callers**:
 *   - `FUN_00028F28` (string-trim.ts) @ `0x28F28`
 *   - second caller to identify with find_xrefs
 *
 * Disassembly sketch:
 *
 *   000172c2    movem.l {D3 D2},-(SP)          ; save D2, D3
 *
 *   ; ── LOOP ───────────────────────────────────────────────────────────────
 *   000172ca    move.b D2b,D0b                 ; D0b = D2b
 *   000172cc    ext.w  D0w                     ; sign-extend byte → word
 *   000172ce    ext.l  D0                      ; sign-extend word → long
 *   000172d0    add.l  D0,D0                   ; D0 = D2 * 2
 *   000172d2    move.l D0,D1                   ; D1 = D2 * 2
 *   000172d4    asl.l  #0x5,D0                 ; D0 = D2 * 2 * 32 = D2 * 64
 *   000172d6    add.l  D1,D0                   ; D0 = D2*64 + D2*2 = D2*66 = D2*0x42
 *   000172de    tst.b  (0x18,A0,D0*0x1)        ; test [0x401482 + D2*0x42 + 0x18]
 *
 *   ; ── SAVE ADDRESS ────────────────────────────────────────────────────────
 *   000172e4    move.b D2b,D0b                 ; (recompute offset — idempotent)
 *   000172e6    ext.w  D0w
 *   000172e8    ext.l  D0
 *   000172ea    add.l  D0,D0
 *   000172ec    move.l D0,D1
 *   000172ee    asl.l  #0x5,D0
 *   000172f0    add.l  D1,D0
 *   000172f2    movea.l #0x401482,A0
 *   000172f8    adda.l D0,A0                   ; A0 = 0x401482 + D2*0x42
 *
 *   ; ── LOOP CONTROL ────────────────────────────────────────────────────────
 *   000172fc    addq.b 0x1,D2b                 ; D2b++
 *   000172fe    cmpi.b #0x7,D2b                ; D2b == 7?
 *   00017302    bne.b  0x000172ca              ; no → back to loop
 *
 *   ; ── EPILOGUE ────────────────────────────────────────────────────────────
 *   00017306    movem.l (SP)+,{D2 D3}
 *   0001730a    rts
 *
 * Details:
 *   - Entry count: 7 (loop 0..6, stop when D2b == 7)
 *   - Stride: `0x42` byte (= 66 = 2 + 64 = slot width)
 *
 */

import type { GameState } from "./state.js";

export const HELPER_172C2_ADDR = 0x000172c2 as const;

const SLOT_ARRAY_BASE = 0x401482 as const;

/** Byte stride between consecutive slots (= 2 + 64 = 0x42). */
const SLOT_STRIDE = 0x42 as const;

const SLOT_COUNT = 7 as const;

const SLOT_ACTIVE_OFFSET = 0x18 as const;

/**
 * Return the last inactive slot address, or `0xffffffff` when none match.
 */
export function helper172C2(state: GameState): number {
  const r = state.workRam;
  const baseOff = (SLOT_ARRAY_BASE - 0x400000) >>> 0;

  // D3 = 0xFFFFFFFF  (moveq -0x1,D3)
  let d3 = 0xffffffff;

  // D2b = 0  (clr.b D2b)
  for (let d2b = 0; d2b < SLOT_COUNT; d2b++) {
    const slotOff = (d2b * SLOT_STRIDE) >>> 0;

    // `tst.b (0x18,A0,D0*1)`: test base+slotOff+0x18.
    const byteAt18 = r[baseOff + slotOff + SLOT_ACTIVE_OFFSET] ?? 0;

    if (byteAt18 === 0) {
      // adda.l D0,A0  →  A0 = 0x401482 + slotOff
      d3 = (SLOT_ARRAY_BASE + slotOff) >>> 0;
    }

  }

  // move.l D3,D0 → return
  return d3 >>> 0;
}
