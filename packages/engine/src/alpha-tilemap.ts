/**
 * alpha-tilemap.ts — utility per scrivere/cancellare tile nell'alpha tilemap
 * @ 0xA03000 (4 KB).
 *
 * L'alpha tilemap è organizzata come 64 colonne × 30 righe = 1920 (0x780)
 * tile da 1 word ciascuno. È usata per HUD overlay (score, time, ecc.).
 *
 * **Verificate bit-perfect** vs binary tramite `cli/src/test-alpha-tilemap-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Numero totale di tile nell'alpha tilemap (64 col × 30 row). */
export const ALPHA_TILE_COUNT = 0x780 as const;

/** Numero di tile per riga (= colonne). */
export const ALPHA_TILES_PER_ROW = 64 as const;

// ─── setAlphaWord (FUN_383A) ──────────────────────────────────────────────

/**
 * Replica `FUN_0000383A` — `setAlphaWord(index, value)`.
 *
 * Disassembly (5 istruzioni):
 *   move.l (0x4,SP),D0      ; D0 = arg1 long (tile index)
 *   move.w (0xa,SP),D1w      ; D1w = low word di arg2 long (tile value)
 *   movea.l #0xA03000,A0
 *   add.l   D0,D0            ; D0 *= 2 (word stride)
 *   adda.l  D0,A0
 *   move.w  D1w,(A0)         ; *(alpha + index*2) = D1.w
 *   rts
 *
 * **Nota:** `add.l D0,D0` fa shift signed: per index in [0, 0x780) il calcolo
 * è naturale. Per index negativi o > 0x800 l'indirizzo wrappa (32-bit).
 *
 * @param state Game state (alpha RAM)
 * @param index Tile index (long; per uso normale 0..0x77F)
 * @param value Tile value (word, scritto BE)
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
  // Out-of-range writes vanno in altre regioni (PF/MO RAM): per ora ignored,
  // come fa array-helpers.writeMemoryU16. In gioco normale non succede.
}

// ─── clearAlphaTilesFromIndex (FUN_28C7E) ─────────────────────────────────

/**
 * Replica `FUN_00028C7E` — clearAlphaTilesFromIndex(startRow).
 *
 * Disassembly (10 istruzioni):
 *   move.l  D2,-(SP)             ; save D2
 *   move.w  (0xa,SP),D0w          ; D0w = low word di arg1 long
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
 * Logica: cancella i tile dell'alpha tilemap dall'indice `startRow * 64`
 * fino a 0x780 (esclusivo). Quando `startRow * 64 >= 0x780` la funzione è
 * un no-op (loop esce immediatamente al primo check).
 *
 * **Edge case 68k**: il counter è word-wide. Se `startRow * 64 (& 0xFFFF)`
 * non raggiunge mai 0x780 contando in avanti modulo 0x10000, il loop
 * itera fino al wrap completo. Per uso normale (startRow in [0, 30]),
 * il counter parte in [0, 0x780] e il caso degenere non si presenta.
 *
 * @param state    Game state
 * @param startRow Riga di partenza (0..30 per uso normale)
 */
/**
 * Replica `FUN_000037E4` — `getAlphaTileAddr(col, row)` — calcola indirizzo
 * tile alpha tilemap dato (col, row) byte. Stessa formula di setAlphaTile
 * ma RETURN ONLY (no write). Returns long address.
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

export function clearAlphaTilesFromIndex(state: GameState, startRow: number): void {
  // Replica del calcolo binario: D0w = arg1.w; D0w <<= 6 (word shift, wraps mod 0x10000)
  let counter = ((startRow & 0xffff) << 6) & 0xffff;

  // Loop fino a counter == 0x780. addq.w wraps modulo 0x10000.
  // Per startRow in [0, 0x1E], counter raggiunge 0x780 senza wrap.
  // Limite di sicurezza per il caso degenere (startRow grande): max 0x10000 iter.
  let safety = 0x10000;
  while (counter !== 0x780 && safety-- > 0) {
    // sext_l(counter) — per counter in [0, 0x8000) è positivo
    const idxSigned = counter & 0x8000 ? counter - 0x10000 : counter;
    setAlphaWord(state, idxSigned, 0);
    counter = (counter + 1) & 0xffff;
  }
}
