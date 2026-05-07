/**
 * slapstic-word-copy-2ff28.ts — replica `FUN_0002FF28` (24 byte).
 *
 * Copia un singolo word (16 bit big-endian) dalla sorgente fissa
 * `0x87A28` verso la destinazione fissa `0x87A48` dentro la regione
 * slapstic ROM. Non usa l'argomento stack (D0w caricato ma mai usato).
 *
 * **Disasm 0x02FF28..0x02FF40** (24 byte):
 *
 *   movea.l A2, A0              ; salva A2 in A0 (caller save)
 *   move.w  (0x6, SP), D0w      ; D0w = word arg dallo stack — NON usato
 *   lea     (0x87A28).l, A1     ; A1 = src address costante
 *   lea     (0x87A48).l, A2     ; A2 = dst address costante (nessun indice)
 *   move.w  (A1), (A2)          ; *A2 ← *A1 (copy word BE)
 *   movea.l A0, A2              ; ripristina A2
 *   rts
 *
 * La differenza rispetto a `FUN_0002FF40` (slapstic-table-store.ts) è che
 * manca l'`add.w D0w,D0w` + la LEA indicizzata: il dst è sempre `0x87A48`
 * (indice zero implicito).
 *
 * **Caller**: `FUN_00016F14` (dentro `FUN_00016EC6`, UNCONDITIONAL_CALL).
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-slapstic-word-copy-2ff28-parity.ts` (500/500 cases).
 */

/** Address sorgente (slapstic ROM, costante hardware). */
export const SRC_ADDR = 0x87a28 as const;

/** Address destinazione (slapstic ROM, costante hardware — indice 0 fisso). */
export const DST_ADDR = 0x87a48 as const;

/**
 * Replica `FUN_0002FF28` — copia word costante src→dst nella slapstic ROM.
 *
 * @param slapsticBuf  Buffer mutabile che rispecchia la regione slapstic.
 *                     Tipicamente 8 KB (0x80000..0x87FFF).
 * @param bufferBase   Address assoluto (M68k) che corrisponde a
 *                     `slapsticBuf[0]`. Per la regione standard: `0x80000`.
 *
 * Side effect: scrive 2 byte in `slapsticBuf` all'offset
 * `DST_ADDR - bufferBase` copiandoli da `SRC_ADDR - bufferBase`.
 * Se src o dst cadono fuori dal buffer: no-op (graceful, no throw).
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
