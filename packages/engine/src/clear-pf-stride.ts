/**
 * clear-pf-stride.ts — replica `FUN_00012186` (32 byte).
 *
 * Sub di servizio chiamata da `FUN_0001101e` immediatamente dopo
 * `clearPaletteRam` (FUN_121A6) — vedi xref @ 0x1139A. Pulisce 64 entry
 * "stride" della playfield RAM (0xA00000-0xA01FFF), azzerando solo i primi
 * 72 byte (18 long) di ciascuna entry da 128 byte. Gli ultimi 56 byte di
 * ogni entry restano intatti.
 *
 * **Disasm 0x12186..0x121A4** (32 byte, 0 args, 0 ret):
 *
 *   lea     (0x00A00006).l, A0       ; A0 = 0xA00006 (offset +6 in PF RAM)
 *   move.w  #0x3F, D1w               ; outer counter = 64 entry (dbf wrap)
 *   outer:
 *     move.w  #0x11, D0w             ; inner counter = 18 long (dbf wrap)
 *     inner:
 *       clr.l  (A0)+                 ; *(long *)A0 = 0; A0 += 4
 *     dbf D0w, inner                 ; ripeti 18 volte
 *     adda.l #0x38, A0               ; salta 56 byte (header preservato)
 *   dbf D1w, outer                   ; ripeti 64 volte
 *   rts
 *
 * **Geometria stride**:
 *   - 64 entry × 0x80 byte di stride = 0x2000 byte di range (= 8 KB PF RAM)
 *   - per ogni entry: 72 byte azzerati + 56 byte preservati = 128 byte
 *   - prima entry parte da 0xA00006 (offset +6: i primi 6 byte non sono toccati)
 *   - ultimo byte azzerato: 0xA00006 + 63*0x80 + 71 = 0xA01FCD
 *   - byte preservati nell'ultima entry: 0xA01FCE..0xA01FFF (50 byte) +
 *     0xA00000..0xA00005 (6 byte) → totale 56 byte non toccati ai bordi
 *   - byte preservati intra-stride per entry i (0..62): bytes
 *     [0xA00006 + i*0x80 + 72 .. 0xA00006 + (i+1)*0x80 - 1] = 56 byte
 *
 * **Side effect**: scrive 64 × 72 = 4608 byte di zero nella PF RAM,
 * lasciando intatti 64 × 56 + 6 = 3590 byte. Probabile reset dei "tile data"
 * di una struttura motion-object/sprite-style con header 56 byte
 * (interpretazione: non confermata, irrilevante per parità).
 *
 * **Modello TS**: la PF RAM non è (ancora) campo di `GameState` — vedi
 * `state.ts` linee 134-140. Il modulo lavora quindi su un buffer
 * `Uint8Array` (passato dal caller) indicizzato da 0 = 0xA00000. Quando
 * la PF RAM verrà aggiunta a `GameState`, basterà passare quel campo come
 * argomento (no breaking change).
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-clear-pf-stride-parity.ts` (500/500 cases).
 */

/** Indirizzo base 68010 della PF RAM (Atari System 1). */
export const PF_RAM_BASE_ADDR = 0xa00000 as const;
/** Indirizzo del primo byte azzerato (offset +6 nella PF RAM). */
export const STRIDE_START_ADDR = 0xa00006 as const;
/** Numero di entry stride processate dall'outer loop. */
export const STRIDE_ENTRY_COUNT = 64 as const;
/** Stride (in byte) tra entry consecutive. */
export const STRIDE_BYTES = 0x80 as const;
/** Numero di byte azzerati per entry (18 long = 72 byte). */
export const STRIDE_CLEAR_BYTES = 72 as const;
/** Numero di byte preservati per entry (56 byte = 0x38). */
export const STRIDE_SKIP_BYTES = 0x38 as const;

/**
 * Replica `FUN_00012186` — `clearPlayfieldStride(pfRam)`.
 *
 * Azzera in-place 64 finestre di 72 byte ciascuna nel buffer PF RAM
 * passato come argomento. Il buffer è indicizzato da 0 = `0xA00000`.
 *
 * @param pfRam Buffer PF RAM (lunghezza minima `STRIDE_START_ADDR -
 *              PF_RAM_BASE_ADDR + STRIDE_ENTRY_COUNT * STRIDE_BYTES = 0x2006`,
 *              tipicamente 8 KB = 0x2000). Se più corto, viene azzerato
 *              fino al limite del buffer (no out-of-bounds writes).
 *
 * NOTE:
 *   - la prima entry parte all'offset 6 (0xA00006), quindi i byte
 *     [0..5] del buffer NON sono toccati;
 *   - per ogni entry i (0..63), bytes
 *     `[6 + i*0x80 .. 6 + i*0x80 + 71]` ← 0;
 *   - i byte `[6 + i*0x80 + 72 .. 6 + (i+1)*0x80 - 1]` (56 per entry)
 *     restano intatti.
 */
export function clearPlayfieldStride(pfRam: Uint8Array): void {
  const startOff = STRIDE_START_ADDR - PF_RAM_BASE_ADDR; // 6
  const len = pfRam.length;

  // Replica fedelmente il loop 68k (no shortcut): per ogni outer iter,
  // azzera 18 long (72 byte) e poi salta 56 byte. Il pattern preserva
  // l'ordine esatto di scrittura, ma poiché il valore scritto è 0 e
  // non ci sono effetti collaterali (no MMIO in questo range nel
  // modello TS), un fill in-place è equivalente bit-perfect.
  let off = startOff;
  for (let entry = 0; entry < STRIDE_ENTRY_COUNT; entry++) {
    // Inner loop: 18 long = 72 byte → 0.
    const end = off + STRIDE_CLEAR_BYTES;
    const writeEnd = end < len ? end : len; // bound-safe se buffer più corto
    for (let i = off; i < writeEnd; i++) {
      pfRam[i] = 0;
    }
    // adda.l #0x38, A0
    off = end + STRIDE_SKIP_BYTES;
  }
}
