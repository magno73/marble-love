/**
 * tilemap-blit-17044.ts — replica `FUN_00017044` (40 byte).
 *
 * Sub di servizio chiamata da `FUN_00011452` (1 xref @ 0x115CA, JSR.L).
 * Copia 6 "righe" da 20 word ciascuna da una tabella ROM @ 0x19F04 alla
 * playfield RAM (0xA00000-0xA01FFF), partendo da 0xA00116, con stride 128
 * byte (=64 word) — pattern tipico di una tilemap a colonne 64-wide.
 *
 * **Disasm 0x17044..0x1706A** (40 byte, 0 args, 0 ret):
 *
 *   movea.l #0x19F04, A1        ; A1 = ROM source pointer (table @ 0x19F04)
 *   movea.l #0xA00116, A0       ; A0 = PF RAM dest pointer (offset +0x116)
 *   clr.b   D1b                 ; D1 outer counter = 0
 *   outer:
 *     clr.b   D0b               ; D0 inner counter = 0
 *     inner:
 *       move.w  (A1)+, (A0)+    ; *(word *)A0++ = *(word *)A1++ (BE)
 *       addq.b  #1, D0b
 *       cmpi.b  #0x14, D0b
 *       bne.b   inner           ; ripete 20 volte (D0 da 1..0x14, exit a 0x14)
 *     moveq   #0x58, D0         ; D0 = 0x58 = 88
 *     adda.l  D0, A0            ; A0 += 88  (skip 44 word = 88 byte)
 *     addq.b  #1, D1b
 *     cmpi.b  #0x6, D1b
 *     bne.b   outer             ; ripete 6 volte (D1 da 1..6, exit a 6)
 *   rts
 *
 * **Geometria**:
 *   - ROM source: 240 byte contigui @ 0x19F04..0x19FF3 (6 × 20 word)
 *   - PF dest stride: 0x80 byte = 128 byte = 64 word per riga
 *   - PF dest content per riga i (i ∈ 0..5):
 *       offset PF = 0x116 + i*0x80 .. 0x116 + i*0x80 + 39  (40 byte = 20 word)
 *       offset successivo (skip 88) = riga seguente
 *   - Indirizzi assoluti scritti (40 byte ciascuna):
 *       riga 0: 0xA00116..0xA0013D
 *       riga 1: 0xA00196..0xA001BD
 *       riga 2: 0xA00216..0xA0023D
 *       riga 3: 0xA00296..0xA002BD
 *       riga 4: 0xA00316..0xA0033D
 *       riga 5: 0xA00396..0xA003BD
 *
 * **Big-endian**: `move.w (A1)+, (A0)+` legge una word BE dalla ROM e la
 * scrive BE in PF RAM (high byte all'offset pari, low byte all'offset
 * dispari). Indipendentemente dall'host la copia è byte-for-byte (40 byte
 * di ROM_program → 40 byte di pfRam), poiché la ROM è già BE.
 *
 * **Side effects**: nessuno fuori da `pfRam`. Non legge/scrive workRam.
 *
 * **Modello TS**: la PF RAM non è (ancora) campo di `GameState` — coerente
 * con `clear-pf-stride.ts`. Il modulo lavora su un buffer `Uint8Array`
 * (passato dal caller) indicizzato da 0 = 0xA00000, e legge da
 * `RomImage.program[]`.
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-tilemap-blit-17044-parity.ts` (500/500 cases).
 */

import type { RomImage } from "./bus.js";

/** Indirizzo ROM della tabella sorgente (immediato `movea.l #0x19F04, A1`). */
export const ROM_SOURCE_ADDR = 0x19f04 as const;
/** Indirizzo base 68010 della PF RAM (Atari System 1). */
export const PF_RAM_BASE_ADDR = 0xa00000 as const;
/** Indirizzo PF RAM del primo byte scritto (immediato `movea.l #0xA00116, A0`). */
export const PF_DEST_ADDR = 0xa00116 as const;
/** Numero di righe (outer loop): `cmpi.b #0x6` → 6 iterazioni. */
export const ROW_COUNT = 6 as const;
/** Word per riga (inner loop): `cmpi.b #0x14` → 20 iterazioni. */
export const WORDS_PER_ROW = 0x14 as const;
/** Byte per riga = 20 word × 2 = 40 byte scritti per riga. */
export const BYTES_PER_ROW = WORDS_PER_ROW * 2; // 40
/** Byte saltati (skip) tra una riga e l'altra: `moveq #0x58, D0; adda.l`. */
export const ROW_SKIP_BYTES = 0x58 as const; // 88
/** Stride totale tra l'inizio di righe consecutive (= 0x80 = 128 byte). */
export const ROW_STRIDE_BYTES = BYTES_PER_ROW + ROW_SKIP_BYTES; // 128
/** Byte totali letti dalla ROM (e scritti in PF RAM): 6 × 40 = 240. */
export const TOTAL_BYTES_COPIED = ROW_COUNT * BYTES_PER_ROW; // 240

/**
 * Replica `FUN_00017044` — `tilemapBlit17044(rom, pfRam)`.
 *
 * Copia 6 righe × 20 word (= 240 byte contigui) dalla ROM @ 0x19F04 alla
 * playfield RAM partendo da 0xA00116, con stride di 128 byte tra righe
 * consecutive (gli ultimi 88 byte di ogni riga di 128 byte non sono toccati).
 *
 * @param rom   `RomImage` con `program[]` BE (la sorgente è in
 *              `program[0x19F04..0x19FF3]`).
 * @param pfRam Buffer PF RAM indicizzato da 0 = `0xA00000`. Lunghezza
 *              minima `0x116 + 5*0x80 + 40 = 0x3BE` per coprire tutte le
 *              scritture; tipicamente `0x2000` (8 KB). Se più corto, le
 *              scritture sono troncate al limite del buffer (no
 *              out-of-bounds writes).
 *
 * NOTE bit-perfect:
 *   - Nessun side-effect su workRam, spriteRam, MMIO o registri stato.
 *   - I byte dell'host pari/dispari corrispondono 1:1 ai byte ROM
 *     (entrambi storage BE, copia byte-for-byte equivalente alla
 *     `move.w (A1)+, (A0)+` del 68k).
 *   - Le 5 finestre "skip" (88 byte ciascuna a 0xA0013E..0xA00195,
 *     0xA001BE..0xA00215, …, 0xA0033E..0xA00395) restano intatte.
 */
export function tilemapBlit17044(rom: RomImage, pfRam: Uint8Array): void {
  const program = rom.program;
  const pfLen = pfRam.length;
  let srcOff = ROM_SOURCE_ADDR; // legge da rom.program[]
  let dstOff = PF_DEST_ADDR - PF_RAM_BASE_ADDR; // 0x116

  for (let row = 0; row < ROW_COUNT; row++) {
    // inner loop: 20 word → 40 byte. Replica fedelmente l'ordine
    // di scrittura (high byte poi low byte per ciascuna word BE).
    for (let w = 0; w < WORDS_PER_ROW; w++) {
      const hi = program[srcOff] ?? 0;
      const lo = program[srcOff + 1] ?? 0;
      srcOff += 2;
      // bound-safe write
      if (dstOff < pfLen) pfRam[dstOff] = hi;
      if (dstOff + 1 < pfLen) pfRam[dstOff + 1] = lo;
      dstOff += 2;
    }
    // adda.l #0x58, A0 — i byte saltati NON sono scritti (preservati).
    dstOff += ROW_SKIP_BYTES;
  }
}
