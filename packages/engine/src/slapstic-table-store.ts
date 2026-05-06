/**
 * slapstic-table-store.ts — replica `FUN_0002FF40` (30 byte).
 *
 * Sub helper chiamata da `FUN_00016F6C` e `FUN_0002BC5C`. Copia un word
 * (16 bit big-endian) da una sorgente fissa nella regione slapstic ROM
 * (`0x87A28`) verso una entry indicizzata in una piccola tabella di 4 word
 * (`0x87A48..0x87A4F`), usando il low word di un long passato sullo stack
 * come indice (`D0w`). L'indice è raddoppiato (word→word offset) e poi
 * sign-esteso da 16 a 32 bit per il calcolo dell'address effettivo (LEA con
 * indice word).
 *
 * **Disasm 0x2FF40..0x2FF5D** (30 byte):
 *
 *   movea.l A2, A0                ; salva A2 → A0 (preservato per restore)
 *   move.w  (0x6, SP), D0w        ; D0w = low word del long arg @ SP+6
 *                                 ;       (SP+0 = ret addr, SP+4 = arg long)
 *   lea     (0x87A28).l, A1       ; A1 = src word ptr (slapstic ROM costante)
 *   lea     (0x87A48).l, A2       ; A2 = dst table base (4 word, slapstic ROM)
 *   add.w   D0w, D0w              ; D0w = D0w * 2 (word index → byte offset, 16-bit add)
 *   lea     (0x0, A2, D0w*0x1), A2; A2 = A2 + sign_extend_16to32(D0w)
 *   move.w  (A1), (A2)            ; *A2 = *A1 (word copy, big-endian)
 *   movea.l A0, A2                ; restore A2
 *   rts
 *
 * **Caller `FUN_0002BC5C`** (event flag dispatcher):
 *   - Calcola `D0 = (D2 & 0xC) >> 2` → indice in [0..3].
 *   - Pusha `D0` come long, chiama `FUN_2FF40`, poppa.
 * **Caller `FUN_00016F6C`** (boot/level init):
 *   - Pusha `sign_extend(*0x400662)` come long → indice qualunque (signed 16).
 *
 * **Memoria toccata**: la regione slapstic ROM 0x80000..0x87FFF. Nel binario
 * reale il chip slapstic 103 può intercettare i write per bank-switching, ma
 * nel nostro oracle locale (Musashi) la regione è plain RAM-backed: i write
 * persistono e sono osservabili via `peekMem`. Modelliamo quindi un
 * `Uint8Array` ("slapsticBuf") che rispecchia quel range, con offset
 * relativi alla base passata dal chiamante.
 *
 * **Sign-extension dell'indice** (importante per parità):
 *   1. `add.w D0w,D0w` → 16-bit add: il risultato è troncato a low word.
 *      es. D0w=0x4000 → 0x8000 (overflow non in low word).
 *   2. `lea (0,A2,D0w*1)` → l'index register viene letto come word e
 *      sign-esteso a 32 bit per l'addizione all'address. Quindi 0x8000 →
 *      0xFFFF8000 = -32768.
 *   3. Il dst address calcolato è `(0x87A48 + sext) & 0xFFFFFFFF` (24-bit
 *      M68k bus, ma noi mascheriamo a 32 bit per semplicità).
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-slapstic-table-store-parity.ts` (500/500 cases).
 */

/** Address sorgente (slapstic ROM, costante hardware). */
export const SRC_ADDR = 0x87a28 as const;

/** Address base della tabella destinazione (4 word, slapstic ROM). */
export const DST_BASE_ADDR = 0x87a48 as const;

/**
 * Replica `FUN_0002FF40` — copy-word-indexed dentro la slapstic ROM region.
 *
 * @param slapsticBuf  Buffer mutabile che rispecchia la regione slapstic.
 *                     Tipicamente 8 KB (0x80000..0x87FFF) ma può essere
 *                     un sottoinsieme finché contiene sia src che dst.
 * @param bufferBase   Address assoluto (M68k) che corrisponde a `slapsticBuf[0]`.
 *                     Per la regione standard: `0x80000`.
 * @param indexWord    Low word del long arg (`D0w`). Solo i bit 0..15 sono
 *                     usati; gli alti vengono ignorati come nel binario.
 *                     Il valore *raddoppiato* è poi sign-esteso da 16 a 32 bit
 *                     prima di essere sommato a `DST_BASE_ADDR`.
 *
 * Side effects: scrive 2 byte in `slapsticBuf` all'offset
 * `DST_BASE_ADDR - bufferBase + sign_extend_16to32((indexWord*2) & 0xFFFF)`.
 * Se l'offset cade fuori dal buffer, **no-op** (graceful no-throw, replicando
 * il fatto che il binario originale può scrivere in altre region MMIO con
 * effetti laterali specifici dell'hardware non modellati qui).
 */
export function slapsticTableStore(
  slapsticBuf: Uint8Array,
  bufferBase: number,
  indexWord: number,
): void {
  // 1. add.w D0w, D0w — 16-bit add, risultato tronato a low word.
  const idxLow = indexWord & 0xffff;
  const doubled = (idxLow + idxLow) & 0xffff;

  // 2. lea (0,A2,D0w*1) — sign-extend low word a 32 bit signed.
  const signExt = (doubled << 16) >> 16;

  // 3. dst address assoluto. Mask a 32 bit (l'M68k usa 24 bit ma stiamo
  //    confrontando con Musashi che maschera/wraps in modo simile).
  const dstAddr = (DST_BASE_ADDR + signExt) >>> 0;

  // 4. Calcolo offset nel buffer; se fuori range, no-op.
  const srcOff = (SRC_ADDR - bufferBase) >>> 0;
  const dstOff = (dstAddr - bufferBase) >>> 0;

  if (srcOff + 1 >= slapsticBuf.length) return;
  if (dstOff + 1 >= slapsticBuf.length) return;

  // 5. move.w (A1), (A2) — copy word, big-endian (byte-by-byte).
  slapsticBuf[dstOff] = slapsticBuf[srcOff] ?? 0;
  slapsticBuf[dstOff + 1] = slapsticBuf[srcOff + 1] ?? 0;
}
