/**
 * helper-1e3e.ts — `FUN_00001E3E` replica (~14 instr, 9 callers).
 *
 *
 * **Disassembly** (0x1E3E..0x1E63, 38 byte):
 *
 *   00001e3e  movem.l {D2 D3},-(SP)      ; save D2, D3 (8 bytes)
 *   00001e42  movea.l (0xc,SP),A0        ; A0 = arg1: dest (long, ptr)
 *   00001e46  move.w  (0x12,SP),D0w      ; D0.w = arg2: startValue (word)
 *   00001e4a  move.l  (0x14,SP),D2       ; D2 = arg3: count (long, signed)
 *   00001e4e  moveq   0x0,D3             ; D3 = 0 (loop counter)
 *   00001e54  addq.w  0x1,D0w            ; D0.w++ (modulo 0x10000)
 *   00001e56  move.w  D1w,(A0)+          ; *A0 = D1.w; A0 += 2
 *   00001e58  addq.l  0x1,D3             ; D3++
 *   00001e5a  cmp.l   D2,D3             ; D3 vs D2
 *   00001e5c  blt.b   0x00001e52         ; loop if D3 < D2 (signed)
 *   00001e5e  movem.l (SP)+,{D2 D3}     ; restore D2, D3
 *   00001e62  rts
 *
 *   SP+0x12  arg2 = startValue (word, low word of a long push)
 *   SP+0x14  arg3 = count (long, signed)
 *
 * **Edge-case behavior**:
 *   - `startValue` wraps modulo 0x10000 (addq.w wraps to 16 bits).
 *
 *   0x1FA8, 0x1FC2, 0x1FDC, 0x1FF6, 0x2010, 0x202A, 0x2148, 0x2162
 *   (8 COMPUTED_CALL + 1 Entry Point = 9 xref totali)
 *
 */

import type { GameState } from "./state.js";

export const HELPER_1E3E_ADDR = 0x00001e3e as const;

// ─── Low-level memory write ──────────────────────────────────────────────────

/**
 */
function writeWord(state: GameState, addr: number, value: number): void {
  const v = value & 0xffff;
  const a = addr >>> 0;
  if (a >= 0x400000 && a < 0x402000) {
    const o = a - 0x400000;
    state.workRam[o]     = (v >>> 8) & 0xff;
    state.workRam[o + 1] = v & 0xff;
  } else if (a >= 0xa02000 && a < 0xa03000) {
    const o = a - 0xa02000;
    state.spriteRam[o]     = (v >>> 8) & 0xff;
    state.spriteRam[o + 1] = v & 0xff;
  } else if (a >= 0xa03000 && a < 0xa04000) {
    const o = a - 0xa03000;
    state.alphaRam[o]     = (v >>> 8) & 0xff;
    state.alphaRam[o + 1] = v & 0xff;
  } else if (a >= 0xb00000 && a < 0xb00800) {
    const o = a - 0xb00000;
    state.colorRam[o]     = (v >>> 8) & 0xff;
    state.colorRam[o + 1] = v & 0xff;
  }
  // Other ranges (PF RAM 0xa00000-0xa02000, cart RAM 0x900000-…, MMIO): ignored.
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Replica `FUN_00001E3E` — `fillSeqWords1E3E`.
 *
 *
 * @param count      Number of words to write (signed long; ≤ 0 → no-op).
 */
export function fillSeqWords1E3E(
  state: GameState,
  destAddr: number,
  startValue: number,
  count: number,
): void {
  const signedCount = count | 0;
  if (signedCount <= 0) return;

  let value = startValue & 0xffff;
  let addr  = destAddr >>> 0;

  for (let d3 = 0; d3 < signedCount; d3++) {
    writeWord(state, addr, value);
    addr  = (addr + 2) >>> 0;
    value = (value + 1) & 0xffff; // addq.w #1,D0w wraps at 16 bit
  }
}

export { fillSeqWords1E3E as FUN_00001E3E };
