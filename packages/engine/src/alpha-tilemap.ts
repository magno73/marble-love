/**
 * alpha-tilemap.ts - utilities for writing and clearing tiles in the
 * alpha tilemap @ 0xA03000 (4 KB).
 *
 * The alpha tilemap is organized as 64 columns x 30 rows = 1920 (0x780)
 * one-word tiles. It is used for the HUD overlay: score, time, and similar
 * text layers.
 *
 * Verified bit-perfect against the binary via
 * `cli/src/test-alpha-tilemap-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Total number of tiles in the alpha tilemap (64 columns x 30 rows). */
export const ALPHA_TILE_COUNT = 0x780 as const;

/** Tiles per row (= columns). */
export const ALPHA_TILES_PER_ROW = 64 as const;

// ─── setAlphaWord (FUN_383A) ──────────────────────────────────────────────

/**
 * `FUN_0000383A` replica — `setAlphaWord(index, value)`.
 *
 * Disassembly (5 instructions):
 *   move.l (0x4,SP),D0      ; D0 = arg1 long (tile index)
 *   move.w (0xa,SP),D1w      ; D1w = low word of arg2 long (tile value)
 *   movea.l #0xA03000,A0
 *   add.l   D0,D0            ; D0 *= 2 (word stride)
 *   adda.l  D0,A0
 *   move.w  D1w,(A0)         ; *(alpha + index*2) = D1.w
 *   rts
 *
 * **Note:** `add.l D0,D0` is a signed shift; for indexes in [0, 0x780) the
 * calculation is natural. Negative indexes or indexes > 0x800 wrap the
 * address at 32 bits.
 *
 * @param state Game state (alpha RAM)
 * @param index Tile index (long; normally 0..0x77F)
 * @param value Tile value (word, written big-endian)
 */
export function setAlphaWord(state: GameState, index: number, value: number): void {
  const v = value & 0xffff;
  // 32-bit unsigned add: 0xA03000 + (index*2) wraps modulo 2^32
  const addr = (0xa03000 + ((index | 0) * 2)) >>> 0;
  if (addr >= 0xa03000 && addr < 0xa04000) {
    const off = addr - 0xa03000;
    state.alphaRam[off] = (v >>> 8) & 0xff;
    state.alphaRam[off + 1] = v & 0xff;
  }
  // Out-of-range writes target other regions (PF/MO RAM). They are ignored for
  // now, matching array-helpers.writeMemoryU16. Normal gameplay should not hit
  // this path.
}

// ─── clearAlphaTilesFromIndex (FUN_28C7E) ─────────────────────────────────

/**
 * `FUN_00028C7E` replica — clearAlphaTilesFromIndex(startRow).
 *
 * Disassembly (10 instructions):
 *   move.l  D2,-(SP)             ; save D2
 *   move.w  (0xa,SP),D0w          ; D0w = low word of arg1 long
 *   asl.w   #0x6,D0w              ; D0w <<= 6 (= startRow * 64)
 *   move.w  D0w,D2w               ; D2w = counter
 *   bra.b   loop_check
 *   loop_body:
 *     clr.l   -(SP)               ; arg2 = 0
 *     move.w  D2w,D0w
 *     ext.l   D0                  ; sext_l(D2w)
 *     move.l  D0,-(SP)            ; arg1 = sext counter
 *     jsr     FUN_021E.l          ; → setAlphaWord(counter, 0)
 *     addq.l  0x8,SP              ; clean 2 args
 *     addq.w  0x1,D2w
 *   loop_check:
 *     cmpi.w  #0x780,D2w
 *     bne.b   loop_body
 *   move.l  (SP)+,D2
 *   rts
 *
 * Logic: clear alpha tilemap tiles from index `startRow * 64` up to 0x780
 * exclusive. When `startRow * 64 >= 0x780`, the function is a no-op because
 * the first loop check exits immediately.
 *
 * **68k edge case**: the counter is word-wide. If `startRow * 64 (& 0xFFFF)`
 * never reaches 0x780 while counting forward modulo 0x10000, the loop iterates
 * until a full wrap. In normal use (startRow in [0, 30]) the counter starts in
 * [0, 0x780], so the degenerate case does not occur.
 *
 * @param state    Game state
 * @param startRow Starting row (0..30 in normal use)
 */
/**
 * Mirrors `FUN_000037E4` - `getAlphaTileAddr(with the, row)`. Computes the alpha
 * tilemap address for `(with the, row)` bytes. Same formula as setAlphaTile, but
 * return-only with no write. Returns a long address.
 */
export function getAlphaTileAddr(state: GameState, rom: { program: Uint8Array }, colByte: number, rowByte: number): number {
  const ROTATION_OFF = 0x1f42;
  const ROM_SHIFT_TABLE = 0x72a4;
  const colSigned = (colByte & 0x80) ? (colByte & 0xff) - 0x100 : (colByte & 0xff);
  const rowSigned = (rowByte & 0x80) ? (rowByte & 0xff) - 0x100 : (rowByte & 0xff);
  const rotation = ((state.workRam[ROTATION_OFF] ?? 0) << 8) | (state.workRam[ROTATION_OFF + 1] ?? 0);
  const rotSigned = rotation & 0x8000 ? rotation - 0x10000 : rotation;

  let d2: number;
  if (rotation !== 0) {
    d2 = (0x29 - rowSigned) | 0;
  } else {
    d2 = (rowSigned << 6) | 0;
  }

  const shiftIdx = rotSigned * 2 + 1;
  const shiftByte = rom.program[(ROM_SHIFT_TABLE + shiftIdx) >>> 0] ?? 0;
  const shiftCount = shiftByte & 0x80 ? shiftByte - 0x100 : shiftByte;

  let d0 = colSigned;
  if (shiftCount >= 32 || shiftCount < 0) {
    d0 = shiftCount < 0 ? d0 : 0;
  } else {
    d0 = (d0 << shiftCount) | 0;
  }
  d0 = ((d0 + d2) * 2) | 0;
  return ((0xa03000 + d0) >>> 0);
}

/**
 * Replica `FUN_00016E8E` — clear alpha tile rows.
 *
 * For each row r in [arg1.b .. 0x1E):
 *   Call getAlphaTileAddr(with the=3, row=r) → addr
 *   Clear 0x24 words from addr
 */
export function clearAlphaRows(
  state: GameState,
  rom: { program: Uint8Array },
  startRow: number,
): void {
  let r = startRow & 0xff;
  while (r !== 0x1E) {
    // Call getAlphaTileAddr(3, r)
    const addr = getAlphaTileAddr(state, rom, 3, r);
    let off = addr - 0xa03000;
    for (let i = 0; i < 0x24; i++) {
      if (off >= 0 && off < 0x1000) {
        state.alphaRam[off] = 0;
        state.alphaRam[off + 1] = 0;
      }
      off += 2;
    }
    r = (r + 1) & 0xff;
  }
}

export function clearAlphaTilesFromIndex(state: GameState, startRow: number): void {
  // Binary calculation: D0w = arg1.w; D0w <<= 6 (word shift, wraps mod 0x10000).
  let counter = ((startRow & 0xffff) << 6) & 0xffff;

  // Loop until counter == 0x780. addq.w wraps modulo 0x10000.
  // For startRow in [0, 0x1E], counter reaches 0x780 without wrapping.
  // Safety limit for the degenerate large-startRow case: max 0x10000 iters.
  let safety = 0x10000;
  while (counter !== 0x780 && safety-- > 0) {
    // sext_l(counter): for counter in [0, 0x8000), the value is positive.
    const idxSigned = counter & 0x8000 ? counter - 0x10000 : counter;
    setAlphaWord(state, idxSigned, 0);
    counter = (counter + 1) & 0xffff;
  }
}
