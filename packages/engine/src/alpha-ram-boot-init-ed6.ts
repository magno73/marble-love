/**
 * alpha-ram-boot-init-ed6.ts — replica `FUN_00000ED6` (148 byte).
 *
 * Boot init helper chiamato 1 volta da `FUN_00000FA0` (xref @ 0x1390) come
 * parte della sequenza cold-boot, vicino a `paletteBootstrapInit` (FUN_E24).
 * Inizializza la **alpha RAM** (`0xA03000..0xA03FFF`, 4 KB) replicando un
 * pattern di tile-map da una tabella ROM 0x6928 e poi sovrascrivendo due
 * brevi finestre con il valore costante `0x2000` (probabile "blank tile"
 * con palette bank 0).
 *
 * **Disasm 0xED6..0xF68** (148 byte, 0 args, 0 ret):
 *
 *   movem.l {D2-D6},-(SP)
 *   move.l  #0xA03000, D3            ; D3 = alphaRam current row base
 *   clr.w   D4w                       ; D4 = "screen quadrant" outer (0..2)
 *   d4_top:
 *     clr.w  D5w                      ; D5 = row index within quadrant (0..9)
 *     d5_top:
 *       clr.w D2w                     ; D2 = column index (0..0x29 = 41)
 *       d2_top:
 *         move.w D2w, D0w             ; A0 = D3 + D2*2  (dst alphaRam row + col)
 *         ext.l  D0
 *         add.l  D0, D0
 *         movea.l D0, A0
 *         adda.l D3, A0
 *         move.w D4w, D0w             ; A1 = 0x6928 + D4*0x54 + D2*2  (src ROM)
 *         mulu.w #0x54, D0
 *         movea.l #0x6928, A1
 *         move.w D2w, D1w
 *         add.w  D1w, D1w
 *         adda.w D0w, A1
 *         move.w (0x0,A1,D1w*0x1), (A0)   ; *A0.w = ROM[0x6928 + D4*0x54 + D2*2]
 *         addq.w #1, D2w
 *         moveq  #0x2A, D0
 *         cmp.w  D2w, D0w
 *       bgt.b  d2_top                 ; while D2 < 0x2A → 42 iter
 *       move.l D3, D6
 *       addi.l #0x80, D6              ; advance to next row (+128 byte stride)
 *       move.l D6, D3
 *       addq.w #1, D5w
 *       moveq  #0xA, D0
 *       cmp.w  D5w, D0w
 *     bgt.b  d5_top                   ; while D5 < 0xA → 10 row per quadrant
 *     addq.w #1, D4w
 *     moveq  #3, D0
 *     cmp.w  D4w, D0w
 *   bgt.b  d4_top                     ; while D4 < 3 → 3 quadrants
 *
 *   ; --- second loop: scrive #0x2000 in 34 word (offsets 0x008..0x04A) ---
 *   move.l #0xA03000, D3
 *   moveq  #4, D2
 *   loop2_top:
 *     ; A0 = 0xA03000 + D2*2; *A0.w = 0x2000
 *     move.w D2w, D0w
 *     ext.l  D0
 *     add.l  D0, D0
 *     movea.l D0, A0
 *     adda.l D3, A0
 *     move.w #0x2000, (A0)
 *     addq.w #1, D2w
 *     moveq  #0x26, D0
 *     cmp.w  D2w, D0w
 *   bgt.b  loop2_top                  ; D2 ∈ [4, 0x25] → 34 iter
 *
 *   ; --- third loop: scrive #0x2000 in 34 word (offsets 0xE88..0xECA) ---
 *   move.l #0xA03E80, D3
 *   moveq  #4, D2
 *   loop3_top:
 *     move.w D2w, D0w
 *     ext.l  D0
 *     add.l  D0, D0
 *     movea.l D0, A0
 *     adda.l D3, A0
 *     move.w #0x2000, (A0)
 *     addq.w #1, D2w
 *     moveq  #0x26, D0
 *     cmp.w  D2w, D0w
 *   bgt.b  loop3_top                  ; D2 ∈ [4, 0x25] → 34 iter
 *
 *   movem.l (SP)+, {D2-D6}
 *   rts
 *
 * **Geometria scrittura alpha RAM** (offset 0 = 0xA03000):
 *
 *   Loop 1 (3×10×42 = 1260 word writes, ma con duplicazione):
 *     D3 parte da 0xA03000 e avanza di 0x80 ad ogni inner-row (NON resettato
 *     fra i quadranti D4!). Ogni quadrante D4 (0..2) usa la stessa fonte
 *     ROM[0x6928 + D4*0x54 .. + D4*0x54 + 0x53] (84 byte = 42 word) e la
 *     replica identica nei 10 row consecutivi del quadrante:
 *
 *       D4=0 → row base alphaRam 0x000, 0x080, 0x100, ..., 0x480 (10 row)
 *       D4=1 → row base alphaRam 0x500, 0x580, ..., 0x980 (10 row)
 *       D4=2 → row base alphaRam 0xA00, 0xA80, ..., 0xE80 (10 row)
 *
 *     Ogni row scrive 84 byte (42 word) all'offset row..row+0x53; i restanti
 *     44 byte (offset row+0x54..row+0x7F) restano com'erano (input-dipendente).
 *
 *   Loop 2: scrive #0x2000 word a alphaRam[0x008..0x009], [0x00A..0x00B], ...,
 *     [0x048..0x049], [0x04A..0x04B] → 34 word, sovrascrivendo parte del
 *     pattern del row 0 del quadrante D4=0.
 *
 *   Loop 3: identico ma a alphaRam[0xE88..0xECB] → row 9 del quadrante D4=2,
 *     sovrascrivendo parte del pattern dell'ultimo row.
 *
 * **Side effect bit-perfect**:
 *   - alphaRam[row..row+0x53] ← ROM[0x6928 + (row // 0x500) * 0x54 .. ]
 *     per row ∈ {0, 0x80, 0x100, ..., 0xE80}
 *   - alphaRam[0x008..0x04B] ← 34 word di valore 0x2000
 *   - alphaRam[0xE88..0xECB] ← 34 word di valore 0x2000
 *   - alphaRam[..] altrimenti = invariato
 *
 * **Modello TS**: la funzione legge `RomImage.program` per la tabella sorgente
 * 0x6928 e scrive su `GameState.alphaRam` (Uint8Array di 0x1000 byte). Il
 * `D3` segue offset `(quadrant * 10 + row) * 0x80` con `quadrant ∈ [0..2]`,
 * `row ∈ [0..9]`. La tabella sorgente per quadrante è `ROM[0x6928 + D4*0x54]`.
 *
 * Bit-perfect verificato vs binary tramite
 * `packages/cli/src/test-alpha-ram-boot-init-ed6-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Indirizzo della funzione nel ROM 68010. */
export const ALPHA_RAM_BOOT_INIT_ED6_ADDR = 0x00000ed6 as const;

/** Base alpha RAM (offset 0 nel buffer `state.alphaRam`). */
export const ALPHA_RAM_BASE_ADDR = 0x00a03000 as const;

/** Offset ROM della tabella sorgente per il pattern di tile map. */
export const SOURCE_TABLE_ROM_ADDR = 0x00006928 as const;

/** Numero di "quadranti" outer (D4 < 3). */
export const QUADRANT_COUNT = 3 as const;

/** Numero di row per quadrante (D5 < 0xA). */
export const ROW_PER_QUADRANT = 10 as const;

/** Numero di word copiate per row (D2 < 0x2A = 42). */
export const WORDS_PER_ROW = 42 as const;

/** Stride in byte fra row consecutivi nella alpha RAM (0x80). */
export const ROW_STRIDE_BYTES = 0x80 as const;

/** Stride in byte fra tabelle sorgente per quadrante diverso (0x54 = 84). */
export const SOURCE_QUADRANT_STRIDE_BYTES = 0x54 as const;

/** Valore word usato dai loop 2/3 come "blank tile" filler. */
export const BLANK_TILE_WORD = 0x2000 as const;

/** Index iniziale (incluso) di D2 nei loop 2/3 → byte offset = 4*2 = 0x08. */
export const FILL_LOOP_D2_START = 4 as const;

/** Index finale (escluso) di D2 nei loop 2/3 → 0x26 (D2=0x25 ultima iter). */
export const FILL_LOOP_D2_END = 0x26 as const;

/** Numero di iterazioni dei loop 2/3 (0x26 - 4 = 34). */
export const FILL_LOOP_COUNT = FILL_LOOP_D2_END - FILL_LOOP_D2_START;

/** Offset alpha RAM di partenza per il loop 2 (D2*2 = 0x08 al primo write). */
export const FILL_LOOP_2_BASE_OFFSET = 0x000 as const;

/** Offset alpha RAM di partenza per il loop 3 (0xA03E80 - 0xA03000 = 0xE80). */
export const FILL_LOOP_3_BASE_OFFSET = 0xe80 as const;

/**
 * Replica `FUN_00000ED6` — `alphaRamBootInitED6(state, rom)`.
 *
 * Boot init bit-perfect della alpha RAM: 3 loop sequenziali in-place su
 * `state.alphaRam`. Vedi commento del modulo per la geometria esatta.
 *
 * Idempotente in senso "stato-finale-fissato": il risultato dipende solo
 * dalla ROM (per la tabella @ 0x6928) e dal contenuto iniziale di alphaRam
 * nei range NON scritti (offset row+0x54..row+0x7F per ciascun row, e tutto
 * il range ≥ 0xECC se non rientra in un row del loop 1).
 *
 * @param state — `GameState` con `alphaRam` Uint8Array (0x1000 byte).
 * @param rom — `RomImage` con `program` Uint8Array; legge solo offset
 *              [0x6928 .. 0x6928 + 3*0x54 - 2 + 0x29*2] = [0x6928 .. 0x69D3].
 */
export function alphaRamBootInitED6(state: GameState, rom: RomImage): void {
  const alpha = state.alphaRam;
  const prog = rom.program;

  // ─── Loop 1: 3 quadranti × 10 row × 42 word ────────────────────────────
  // D3 parte da 0xA03000 (offset 0 in alphaRam) e NON viene resettato fra
  // quadranti, avanza di 0x80 ogni row (totale 30 row × 0x80 = 0xF00).
  let rowOffset = 0; // offset in alphaRam, equivalente a (D3 - 0xA03000)
  for (let d4 = 0; d4 < QUADRANT_COUNT; d4++) {
    const srcBase = SOURCE_TABLE_ROM_ADDR + d4 * SOURCE_QUADRANT_STRIDE_BYTES;
    for (let d5 = 0; d5 < ROW_PER_QUADRANT; d5++) {
      // Inner: 42 word writes a rowOffset + D2*2.
      for (let d2 = 0; d2 < WORDS_PER_ROW; d2++) {
        const dst = rowOffset + d2 * 2;
        const src = srcBase + d2 * 2;
        // BE word copy (M68K big-endian).
        alpha[dst] = prog[src] ?? 0;
        alpha[dst + 1] = prog[src + 1] ?? 0;
      }
      rowOffset += ROW_STRIDE_BYTES;
    }
  }

  // ─── Loop 2: 34 word #0x2000 a alphaRam[0x008 .. 0x04B] ────────────────
  // D3 = 0xA03000, D2 ∈ [4..0x25].
  for (let d2 = FILL_LOOP_D2_START; d2 < FILL_LOOP_D2_END; d2++) {
    const off = FILL_LOOP_2_BASE_OFFSET + d2 * 2;
    alpha[off] = (BLANK_TILE_WORD >>> 8) & 0xff;
    alpha[off + 1] = BLANK_TILE_WORD & 0xff;
  }

  // ─── Loop 3: 34 word #0x2000 a alphaRam[0xE88 .. 0xECB] ────────────────
  // D3 = 0xA03E80, D2 ∈ [4..0x25].
  for (let d2 = FILL_LOOP_D2_START; d2 < FILL_LOOP_D2_END; d2++) {
    const off = FILL_LOOP_3_BASE_OFFSET + d2 * 2;
    alpha[off] = (BLANK_TILE_WORD >>> 8) & 0xff;
    alpha[off + 1] = BLANK_TILE_WORD & 0xff;
  }
}
