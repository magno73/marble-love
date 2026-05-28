/**
 * slapstic-word-copy-2ff28.ts — `FUN_0002FF28` replica (24 bytes).
 *
 *
 * **Disasm 0x02FF28..0x02FF40** (24 byte):
 *
 *   movea.l A2, A0              ; save A2 in A0 (caller save)
 *   lea     (0x87A28).l, A1     ; A1 = constant src address
 *   move.w  (A1), (A2)          ; *A2 ← *A1 (copy word BE)
 *   movea.l A0, A2              ; restore A2
 *   rts
 *
 * (implicit zero index).
 *
 *
 * `cli/src/test-slapstic-word-copy-2ff28-parity.ts` (500/500 cases).
 */

/** Source address (slapstic ROM, hardware constant). */
export const SRC_ADDR = 0x87a28 as const;

/** Destination address (slapstic ROM, hardware constant — fixed index 0). */
export const DST_ADDR = 0x87a48 as const;

/**
 *
 * @param slapsticBuf  Mutable buffer that mirrors the slapstic region.
 *                     Typically 8 KB (0x80000..0x87FFF).
 * @param bufferBase   Absolute M68k address corresponding to
 *                     `slapsticBuf[0]`. For the standard region: `0x80000`.
 *
 * `DST_ADDR - bufferBase` copiandoli da `SRC_ADDR - bufferBase`.
 */
export function slapsticWordCopy2FF28(
  slapsticBuf: Uint8Array,
  bufferBase: number,
): void {
  const srcOff = (SRC_ADDR - bufferBase) >>> 0;
  const dstOff = (DST_ADDR - bufferBase) >>> 0;

  if (srcOff + 1 >= slapsticBuf.length) return;
  if (dstOff + 1 >= slapsticBuf.length) return;

  // move.w (A1),(A2) — copy word big-endian byte-by-byte
  slapsticBuf[dstOff] = slapsticBuf[srcOff] ?? 0;
  slapsticBuf[dstOff + 1] = slapsticBuf[srcOff + 1] ?? 0;
}
