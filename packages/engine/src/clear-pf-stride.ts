/**
 * Replica of `FUN_00012186`.
 *
 * The routine clears 64 strided playfield entries. Each entry is 128 bytes:
 * the first 72 bytes after offset +6 are cleared, then 56 bytes are preserved.
 *
 * **Disasm 0x12186..0x121A4** (32 byte, 0 args, 0 ret):
 *
 *   lea     (0x00A00006).l, A0       ; A0 = 0xA00006 (offset +6 in PF RAM)
 *   move.w  #0x3F, D1w               ; outer counter = 64 entry (dbf wrap)
 *   outer:
 *     move.w  #0x11, D0w             ; inner counter = 18 long (dbf wrap)
 *     inner:
 *       clr.l  (A0)+                 ; *(long *)A0 = 0; A0 += 4
 *     dbf D0w, inner                 ; repeat 18 times
 *   dbf D1w, outer                   ; repeat 64 times
 *   rts
 *
 * Verified by `cli/src/test-clear-pf-stride-parity.ts`.
 */

export const PF_RAM_BASE_ADDR = 0xa00000 as const;
export const STRIDE_START_ADDR = 0xa00006 as const;
/** Number of stride entries processed by the outer loop. */
export const STRIDE_ENTRY_COUNT = 64 as const;
/** Byte stride between consecutive entries. */
export const STRIDE_BYTES = 0x80 as const;
/** Bytes cleared per entry: 18 longs = 72 bytes. */
export const STRIDE_CLEAR_BYTES = 72 as const;
/** Bytes preserved per entry. */
export const STRIDE_SKIP_BYTES = 0x38 as const;

/**
 * Clear the strided playfield ranges without writing out of bounds.
 */
export function clearPlayfieldStride(pfRam: Uint8Array): void {
  const startOff = STRIDE_START_ADDR - PF_RAM_BASE_ADDR; // 6
  const len = pfRam.length;

  // Mirror the 68000 loop shape: each outer iteration clears 18 longs.
  let off = startOff;
  for (let entry = 0; entry < STRIDE_ENTRY_COUNT; entry++) {
    // Inner loop: 18 longs = 72 bytes -> 0.
    const end = off + STRIDE_CLEAR_BYTES;
    const writeEnd = end < len ? end : len;
    for (let i = off; i < writeEnd; i++) {
      pfRam[i] = 0;
    }
    // adda.l #0x38, A0
    off = end + STRIDE_SKIP_BYTES;
  }
}
