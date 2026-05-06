/**
 * render-glyph-loop-1e64.ts — replica `FUN_00001E64` (70 byte).
 *
 * **Semantica**: itera `count` volte (low word di arg2) un *glyph render
 * helper* (FUN_32BA), avanzando un puntatore `bufPtr` (D4) tra una
 * chiamata e l'altra di **2 byte** se il code-point (D3.w) è in
 * `[0x26, 0x2D]` inclusivo (range "narrow", che in ASCII copre `&'()*+,-`)
 * altrimenti **4 byte** (range "wide"). Il code-point viene incrementato
 * di 1 ad ogni iterazione, quindi la sequenza è
 * `(startCode, startCode+1, ..., startCode+count-1)`.
 *
 * **Disasm 0x1E64..0x1EA9** (70 byte):
 *
 *   00001e64    movem.l {D4 D3 D2},-(SP)         ; salva D2/D3/D4 (12 byte)
 *   00001e68    move.l  (0x10,SP),D4              ; D4 = arg1 long (bufPtr)
 *   00001e6c    move.w  (0x16,SP),D3w             ; D3.w = arg2 low word (startCode)
 *   00001e70    move.w  (0x1a,SP),D2w             ; D2.w = arg3 low word (count)
 *   loop_top:
 *   00001e74    tst.w   D2w
 *   00001e76    ble.b   0x00001ea4                ; if (i16)D2 <= 0 → exit
 *   00001e78    clr.l   -(SP)                     ; push 0 (mask = 0)
 *   00001e7a    move.w  D3w,D0w
 *   00001e7c    ext.l   D0
 *   00001e7e    move.l  D0,-(SP)                  ; push sext_l(D3.w) (charCode)
 *   00001e80    move.l  D4,-(SP)                  ; push D4 (bufPtr)
 *   00001e82    jsr     0x000032ba.l              ; FUN_32BA(bufPtr, charCode, mask=0)
 *   00001e88    moveq   0x26,D0
 *   00001e8a    cmp.w   D3w,D0w                   ; flags = 0x26 - D3 (signed)
 *   00001e8c    lea     (0xc,SP),SP               ; pop 3 long args
 *   00001e90    bgt.b   0x00001e9c                ; if 0x26 > D3 → wide branch
 *   00001e92    moveq   0x2d,D0
 *   00001e94    cmp.w   D3w,D0w                   ; flags = 0x2D - D3
 *   00001e96    blt.b   0x00001e9c                ; if 0x2D < D3 → wide branch
 *   00001e98    addq.l  0x2,D4                     ; narrow: bufPtr += 2
 *   00001e9a    bra.b   0x00001e9e
 *   00001e9c    addq.l  0x4,D4                     ; wide:   bufPtr += 4
 *   00001e9e    addq.w  0x1,D3w                    ; charCode++
 *   00001ea0    subq.w  0x1,D2w                    ; count--
 *   00001ea2    bra.b   0x00001e74
 *   00001ea4    movem.l (SP)+,{D2 D3 D4}          ; restore
 *   00001ea8    rts
 *
 * **Calling convention** (cdecl-like, args pushed RTL come long):
 *   - arg1 long @ (0x10,SP) post-prolog: `bufPtr` (alpha tilemap address,
 *     in pratica `0x00A03000 + 2*N`).
 *   - arg2 long @ (0x14,SP), low word @ (0x16,SP): `startCode` — code-point
 *     iniziale (signed word, sext'd quando passato a FUN_32BA).
 *   - arg3 long @ (0x18,SP), low word @ (0x1A,SP): `count` (signed word,
 *     `<= 0` → no-op).
 *
 * **Side effect**: ognuna delle `count` chiamate a FUN_32BA scrive uno o
 * più word in alpha tilemap a partire da `bufPtr`. FUN_32BA (170 byte, da
 * replicare separatamente) gestisce 4+ branches in base a `charCode` e
 * scrive a `(bufPtr)`, `(bufPtr+2)`, `(bufPtr+0x80)`, `(bufPtr+0x82)`.
 *
 * **Width rule** (post-call, prima di `bufPtr += step`):
 *   - `charCode` in `[0x26, 0x2D]` (= `&'()*+,-` ASCII) → step = 2
 *     (narrow glyph: 1 colonna tile)
 *   - altrimenti → step = 4 (wide glyph: 2 colonne tile)
 *
 * Il check usa **comparison signed word**, quindi code-point negativi
 * (es. `0xFFFF` = -1 i16) prendono la branch "wide" (D3 < 0x26 signed).
 *
 * **Xref** (3): tutte da `FUN_00001EE0` @ 0x205E, 0x207C, 0x2098 — sequenza
 * di scene-init che renderizza header HUD via tre stringhe consecutive.
 *
 * **JSR esterna** (1): `FUN_32BA` (glyph dispatcher). Non ancora replicata.
 * Iniettata via `subs.renderGlyph` callback. Quando assente, le chiamate
 * sono no-op (la replica TS verifica solo la logica di iterazione).
 *
 * Verifica bit-perfect via `cli/src/test-render-glyph-loop-1e64-parity.ts`,
 * che confronta la **sequenza di chiamate** `(bufPtr, charCode)` tra binario
 * (hookato @ PC=0x32BA) e replica TS (callback log). Le scritture effettive
 * a alphaRam dipendono da FUN_32BA (out-of-scope).
 */

/**
 * Indirizzo della JSR target (FUN_32BA). Esposto per parity test e per
 * eventuali repliche future di FUN_32BA.
 */
export const RENDER_GLYPH_FN_ADDR = 0x000032ba as const;

/**
 * Inferiore (inclusivo) del range "narrow" per il code-point.
 * `charCode >= NARROW_LO_INCL && charCode <= NARROW_HI_INCL` → step = 2.
 */
export const NARROW_LO_INCL = 0x26 as const;

/** Superiore (inclusivo) del range "narrow". */
export const NARROW_HI_INCL = 0x2d as const;

/** Step di `bufPtr` quando il code-point è "narrow" (`[0x26, 0x2D]`). */
export const NARROW_STEP = 2 as const;

/** Step di `bufPtr` quando il code-point è "wide" (fuori range narrow). */
export const WIDE_STEP = 4 as const;

/**
 * Argomenti di una singola chiamata a FUN_32BA (`renderGlyph`).
 *
 * - `bufPtr`: 32-bit pointer (long), di solito in alpha tilemap
 *   (`0x00A03000..0x00A04000`). FUN_32BA scrive 1+ word a partire da qui.
 * - `charCode`: 16-bit signed word, sign-extended a long quando pushato a
 *   FUN_32BA dal binario. La replica TS espone solo il valore word: il
 *   ricevitore può fare `((charCode << 16) >> 16)` se serve la versione
 *   sign-extended long.
 * - `mask`: 16-bit OR-mask passato come 3° arg a FUN_32BA. **Sempre 0**
 *   in questa replica (il binario fa `clr.l -(SP)` prima della call).
 */
export interface RenderGlyphCall {
  bufPtr: number;
  charCode: number;
  mask: number;
}

/**
 * Stub injection per la chiamata a FUN_32BA.
 *
 * - `renderGlyph(call)`: chiamata 1 volta per iterazione, **prima** dello
 *   step di `bufPtr`. Default: no-op.
 *
 * Non c'è cap iterazioni perché `count` arriva come arg dal caller; il
 * binario non ha safety net (loop teoricamente fino a 32767 con count
 * massimo positivo, fino a no-op con count <= 0).
 */
export interface RenderGlyphLoop1E64Subs {
  /** Hook per ogni chiamata a FUN_32BA. */
  renderGlyph?: (call: RenderGlyphCall) => void;
}

/**
 * Risultato della replica.
 *
 * - `iterations`: numero di iterazioni eseguite (0 se `count <= 0`).
 * - `endBufPtr`: valore finale di `bufPtr` (D4) post-loop, ovvero
 *   `startBufPtr + Σ stride_i` con stride_i ∈ {2, 4} secondo la regola
 *   width. È un `u32` (mask `>>> 0`).
 * - `endCharCode`: valore finale del code-point post-loop, ovvero
 *   `(startCharCode + iterations) & 0xFFFF`.
 */
export interface RenderGlyphLoop1E64Result {
  iterations: number;
  endBufPtr: number;
  endCharCode: number;
}

/**
 * Replica bit-perfect di `FUN_00001E64`.
 *
 * @param bufPtr        Long pointer iniziale (D4). Avanzato di 2 o 4 per
 *                      iterazione secondo width rule.
 * @param startCharCode Word signed iniziale (D3.w). Solo low 16-bit usati;
 *                      sign-extension applicata al confronto del range.
 * @param count         Word signed (D2.w) — n. iterazioni. `<= 0` → no-op.
 * @param subs          Stub injection (`renderGlyph` callback).
 *
 * @returns `{ iterations, endBufPtr, endCharCode }` (vedi
 *          {@link RenderGlyphLoop1E64Result}).
 *
 * **No mutation** di GameState o alphaRam: tutti i side effect transitano
 * via `subs.renderGlyph`. Il caller-replica che richiama la VERA FUN_32BA
 * (es. via Musashi binary oracle) è responsabile delle scritture in
 * alpha tilemap.
 */
export function renderGlyphLoop1E64(
  bufPtr: number,
  startCharCode: number,
  count: number,
  subs: RenderGlyphLoop1E64Subs = {},
): RenderGlyphLoop1E64Result {
  // D4 = bufPtr (long). Tutte le aritmetiche sono su 32-bit unsigned in JS:
  // l'add 2/4 wrappa modulo 2^32 senza segno, replicando 68k addq.l.
  let d4 = bufPtr >>> 0;

  // D3.w = startCharCode signed word. Mantengo come number e mascherato
  // a 16-bit dopo ogni `addq.w 0x1`. Per il compare uso la versione
  // sign-extended ((d3w << 16) >> 16).
  let d3w = startCharCode & 0xffff;

  // D2.w = count, signed word. Loop condition `tst.w D2w; ble.b exit`:
  // `ble` (signed) sta per "branch if D <= 0 signed", ovvero il loop
  // continua mentre D2.w sign-extended > 0. Con count = 0x8000 (= -32768
  // signed) il loop esce subito; con 0x7FFF itera 32767 volte.
  let d2w = count & 0xffff;

  let iterations = 0;
  const onCall = subs.renderGlyph;

  // Sign-extension helper: u16 → i32 sign-extended.
  const sext16 = (w: number): number => (w << 16) >> 16;

  while (true) {
    // tst.w D2w; ble.b exit
    if (sext16(d2w) <= 0) break;

    // jsr FUN_32BA(bufPtr, sext_l(charCode), 0)
    if (onCall !== undefined) {
      onCall({ bufPtr: d4, charCode: d3w, mask: 0 });
    }

    // Width rule:
    //   moveq #0x26, D0; cmp.w D3, D0; bgt narrow_skip   (if 0x26 > D3 → wide)
    //   moveq #0x2D, D0; cmp.w D3, D0; blt narrow_skip   (if 0x2D < D3 → wide)
    //   addq.l #2, D4   (narrow)
    //   bra continue
    // narrow_skip:
    //   addq.l #4, D4   (wide)
    // Comparisons sono signed-word: usa sext16(d3w).
    const d3signed = sext16(d3w);
    const isNarrow = d3signed >= NARROW_LO_INCL && d3signed <= NARROW_HI_INCL;
    d4 = (d4 + (isNarrow ? NARROW_STEP : WIDE_STEP)) >>> 0;

    // addq.w 0x1, D3w — incremento word con wrap a 16-bit.
    d3w = (d3w + 1) & 0xffff;

    // subq.w 0x1, D2w — decremento word con wrap a 16-bit.
    d2w = (d2w - 1) & 0xffff;

    iterations++;
  }

  return {
    iterations,
    endBufPtr: d4 >>> 0,
    endCharCode: d3w,
  };
}
