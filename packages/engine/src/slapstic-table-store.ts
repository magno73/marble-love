/**
 * slapstic-table-store.ts — replica `FUN_0002FF40` (30 byte).
 *
 * Copies one big-endian 16-bit word from a fixed source in Slapstic ROM to
 * `0x87A48..0x87A4F`, using the low word of a long stack argument as word index.
 *
 * **Disasm 0x2FF40..0x2FF5D** (30 byte):
 *
 *   movea.l A2, A0                ; save A2 -> A0 (preserved for restore)
 *   move.w  (0x6, SP), D0w        ; D0w = low word of long arg @ SP+6
 *                                 ;       (SP+0 = ret addr, SP+4 = arg long)
 *   lea     (0x87A28).l, A1       ; A1 = src word ptr (constant Slapstic ROM)
 *   lea     (0x87A48).l, A2       ; A2 = dst table base (4 word, slapstic ROM)
 *   add.w   D0w, D0w              ; D0w = D0w * 2 (word index -> byte offset, 16-bit add)
 *   lea     (0x0, A2, D0w*0x1), A2; A2 = A2 + sign_extend_16to32(D0w)
 *   move.w  (A1), (A2)            ; *A2 = *A1 (word copy, big-endian)
 *   movea.l A0, A2                ; restore A2
 *   rts
 *
 * **Caller `FUN_0002BC5C`** (event flag dispatcher):
 * **Caller `FUN_00016F6C`** (boot/level init):
 *   - Pushes `sign_extend(*0x400662)` as long -> any signed-16 index.
 *
 * `slapsticBuf` mirrors that region, using offsets relative to `bufferBase`.
 *
 *      e.g. D0w=0x4000 → 0x8000 (overflow not in the low word).
 *      0xFFFF8000 = -32768.
 *
 * `cli/src/test-slapstic-table-store-parity.ts` (500/500 cases).
 */

/** Source address (Slapstic ROM hardware constant). */
export const SRC_ADDR = 0x87a28 as const;

export const DST_BASE_ADDR = 0x87a48 as const;

/**
 *
 * @param slapsticBuf  Mutable buffer mirroring the Slapstic region.
 * @param bufferBase   Absolute M68k address corresponding to `slapsticBuf[0]`.
 *                     For the standard region: `0x80000`.
 * @param indexWord    Low word of the long argument (`D0w`). Only bits 0..15 are used.
 *
 * `DST_BASE_ADDR - bufferBase + sign_extend_16to32((indexWord*2) & 0xFFFF)`.
 */
export function slapsticTableStore(
  slapsticBuf: Uint8Array,
  bufferBase: number,
  indexWord: number,
): void {
  const idxLow = indexWord & 0xffff;
  const doubled = (idxLow + idxLow) & 0xffff;

  // 2. lea (0,A2,D0w*1): sign-extend low word to signed 32-bit.
  const signExt = (doubled << 16) >> 16;

  // 3. Absolute destination address. Mask to 32-bit; M68k uses 24-bit, but
  //    Musashi masks/wraps similarly for these parity cases.
  const dstAddr = (DST_BASE_ADDR + signExt) >>> 0;

  const srcOff = (SRC_ADDR - bufferBase) >>> 0;
  const dstOff = (dstAddr - bufferBase) >>> 0;

  if (srcOff + 1 >= slapsticBuf.length) return;
  if (dstOff + 1 >= slapsticBuf.length) return;

  // 5. move.w (A1), (A2) — copy word, big-endian (byte-by-byte).
  slapsticBuf[dstOff] = slapsticBuf[srcOff] ?? 0;
  slapsticBuf[dstOff + 1] = slapsticBuf[srcOff + 1] ?? 0;
}
