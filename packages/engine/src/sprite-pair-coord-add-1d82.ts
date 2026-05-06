/**
 * sprite-pair-coord-add-1d82.ts — replica `FUN_00001D82` (134 byte).
 *
 * Estrae la coordinata signed-9-bit (bit 5..13) da due word adiacenti in
 * Motion-Object RAM (banchi `0xA02000` e `0xA02100`, separati da 0x100), vi
 * somma due delta indipendenti, e ripack le due word preservando i bit
 * bassi (0..3) e mascherando il risultato a 14 bit (clear di bit 14..15).
 *
 * **Disasm 0x1D82..0x1E07** (134 byte):
 *
 *   00001d82    movem.l {D3 D2},-(SP)         ; salva D2,D3 (8 byte)
 *   00001d86    move.w  (0xe,SP),D1w          ; D1 = arg1.lo (col index)
 *   00001d8a    move.w  (0x12,SP),D2w         ; D2 = arg2.lo (bank index)
 *   00001d8e    move.w  (0x16,SP),D3w         ; D3 = arg3.lo (delta A1)
 *   00001d92    movea.l #0xa02000,A1          ; A1 base = sprite-bank A
 *   00001d98    movea.l #0xa02100,A0          ; A0 base = sprite-bank B
 *   00001d9e    moveq   0x0,D0
 *   00001da0    move.w  D2w,D0w               ; D0 = D2 (zero-extended)
 *   00001da2    lsl.l   #0x8,D0
 *   00001da4    add.l   D0,D0                 ; D0 = D2 << 9
 *   00001da6    add.l   A1,D0
 *   00001da8    movea.l D0,A1                 ; A1 = 0xA02000 + D2*0x200
 *   00001daa..1db8  (idem per A0)             ; A0 = 0xA02100 + D2*0x200
 *   00001db6    moveq   0x0,D0
 *   00001db8    move.w  D1w,D0w
 *   00001dba    add.l   D0,D0                 ; D0 = D1 << 1
 *   00001dbc    add.l   A1,D0
 *   00001dbe    movea.l D0,A1                 ; A1 += D1*2
 *   00001dc0..1dc8  (idem per A0)             ; A0 += D1*2
 *   00001dca    move.w  (A1),D0w              ; D0 = *A1
 *   00001dcc    asr.w   #0x5,D0w              ; arithmetic >> 5 (signed)
 *   00001dce    andi.w  #0x1ff,D0w            ; mask low 9 bit
 *   00001dd2    move.w  (A0),D2w              ; D2 = *A0
 *   00001dd4    asr.w   #0x5,D2w
 *   00001dd6    andi.w  #0x1ff,D2w
 *   00001dda    add.w   D3w,D0w               ; D0 += deltaA (arg3)
 *   00001ddc    add.w   (0x1a,SP),D2w         ; D2 += deltaB (arg4)
 *   00001de0    move.w  (A1),D1w              ; D1 = *A1
 *   00001de2    andi.w  #0xf,D1w              ; preserva bit 0..3
 *   00001de6    asl.w   #0x5,D0w              ; nuovo coord << 5 → bit 5..13
 *   00001de8    or.w    D0w,D1w
 *   00001dea    andi.w  #0x3fff,D1w           ; clear bit 14,15
 *   00001dee    move.w  D1w,(A1)              ; *A1 = repacked
 *   00001df0..1e00  (idem per A0)             ; *A0 = repacked
 *   00001e02    movem.l (SP)+,{D2 D3}
 *   00001e06    rts
 *
 * **Semantica**: i due banchi (A=0xA02000, B=0xA02100) sono lo stesso bank
 * di 0x200 byte ma offsettati di 0x100 (= 128 word = 64 entry su 4 byte).
 * Sono due viste parallele dello stesso oggetto MO o di una coppia tile/tile
 * "alta/bassa". Ogni word ha layout:
 *
 *   bit 15..14  : sempre 0 dopo write (mask 0x3FFF)
 *   bit 13..5   : signed 9-bit "coord" (mask 0x1FF, asr per estrarre)
 *   bit 4       : non toccato dalla read, ma andato perso dopo OR (resta 0
 *                 perché la read maskera con 0xF non con 0x1F)
 *
 * **Wait**: il pack usa `andi #0xF` (low 4 bit), non #0x1F. Quindi il bit 4
 * del valore vecchio viene **azzerato** dopo write. Questo è corretto: il
 * bit 4 (in mezzo tra "low nibble" e "coord") viene perso ad ogni call.
 *
 * **Args** (4 longword sullo stack, cdecl 68k):
 *   - arg1 (long): col index. Solo low word usato (D1.w). Range tipico [0..0x7F].
 *   - arg2 (long): bank index. Solo low word (D2.w). Range tipico [0..7].
 *                  L'indirizzo finale è `0xA02000 + (bank*0x200) + (col*2)`,
 *                  + 0x100 per la seconda vista. Out-of-range NON è clampato:
 *                  scrive comunque (ma il caller deve garantire validità).
 *   - arg3 (long): deltaA. Solo low word (D3.w). Sommato word-wise alla coord
 *                  estratta da `*A1` (sprite-ram bank A).
 *   - arg4 (long): deltaB. Solo low word (`(0x1A,SP)`). Sommato word-wise alla
 *                  coord estratta da `*A0` (sprite-ram bank B).
 *
 * **Side effects**:
 *   - `state.spriteRam[(bank*0x200)+(col*2)..+1]`     (word, BE) — bank A
 *   - `state.spriteRam[0x100+(bank*0x200)+(col*2)..]` (word, BE) — bank B
 *   - Nessun side-effect su workRam/colorRam/alphaRam o registri esterni.
 *
 * **Caller context** (xref @ FUN_FA0 @ 0x1226 e 0x135C): D1 è iteration
 * counter (0..0x37 da `*0x40000C`), D2 è level/scene index, deltaA da
 * tabella `*0x68E8` indicizzata su D1, deltaB = -tabella `*0x6908` indicizzata
 * su D1. Pattern di "scroll del campo" che muove tutti gli sprite dell'HUD
 * scena di delta-x e delta-y precomputati.
 *
 * **JSR esterne**: NESSUNA — funzione self-contained, side-effect solo su
 * sprite-ram.
 *
 * Verifica bit-perfect via `cli/src/test-sprite-pair-coord-add-1d82-parity.ts`.
 */

import type { GameState } from "./state.js";

/** SPRITE-RAM bank A base (`0xA02000`). */
export const SPRITE_RAM_BANK_A_ADDR = 0x00a02000 as const;

/** SPRITE-RAM bank B base (`0xA02100` = bank A + 0x100). */
export const SPRITE_RAM_BANK_B_ADDR = 0x00a02100 as const;

/** Bank stride: ogni "bank" arg2 muove di 0x200 byte (= 256 word). */
export const BANK_STRIDE_BYTES = 0x200 as const;

/** Mask 0x3FFF = clear di bit 14,15 (write finale). */
export const COORD_PACK_MASK = 0x3fff as const;

/** Mask 0xF = preserva low nibble (bit 0..3) della word originale. */
export const COORD_LOW_NIBBLE_MASK = 0x000f as const;

/** Mask 0x1FF = signed-9-bit (estratto dalla coord). */
export const COORD_FIELD_MASK = 0x01ff as const;

/** Shift della coord nel pack/unpack (bit 5..13). */
export const COORD_SHIFT = 5 as const;

// ─── Internal helpers ────────────────────────────────────────────────────

function readU16BE(ram: Uint8Array, off: number): number {
  return (((ram[off] ?? 0) << 8) | (ram[off + 1] ?? 0)) & 0xffff;
}

function writeU16BE(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 8) & 0xff;
  ram[off + 1] = value & 0xff;
}

/**
 * Replica del passo "extract → add → repack" per UNA word di sprite-ram.
 *
 * Equivalent al blocco 0x1DCA..0x1DEE (e 0x1DF0..0x1E00 per A0).
 *
 * @param oldWord  word letta da sprite-ram (16 bit, big-endian unpacked)
 * @param delta    delta word (16 bit) da aggiungere alla coord
 * @returns        word ripackata (14 bit valid, bit 14,15 = 0)
 */
function repackCoord(oldWord: number, delta: number): number {
  // asr.w #5: arithmetic shift right preservando il segno.
  // In TS: cast a int16 sign-extended, poi >>5, poi maskera 0x1FF.
  const signed16 = (oldWord & 0x8000) ? oldWord - 0x10000 : oldWord;
  const coord = (signed16 >> COORD_SHIFT) & COORD_FIELD_MASK;
  // add.w D3w,D0w: addizione word (16 bit) modulo 2^16.
  const added = (coord + (delta & 0xffff)) & 0xffff;
  // asl.w #5: shift left 5, mantieni 16 bit.
  const shifted = (added << COORD_SHIFT) & 0xffff;
  // OR con low-nibble della word originale.
  const lowNibble = oldWord & COORD_LOW_NIBBLE_MASK;
  // andi.w #0x3FFF: clear bit 14,15.
  return (shifted | lowNibble) & COORD_PACK_MASK;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00001D82`.
 *
 * Aggiorna due word in {@link GameState.spriteRam} a coordinate calcolate da
 * `bank` e `col`, sommando `deltaA` alla coord-9-bit della word @ bank A e
 * `deltaB` alla coord-9-bit della word @ bank B.
 *
 * @param state   GameState. `state.spriteRam` viene mutata (2 word: bank A
 *                e bank B alla stessa posizione `(bank*0x200) + (col*2)`).
 * @param col     Solo low word usata (`arg1 & 0xFFFF`). Indice colonna:
 *                offset bytes = `col * 2`. Caller usa 0..0x37 tipicamente.
 * @param bank    Solo low word usata (`arg2 & 0xFFFF`). Indice bank:
 *                offset bytes = `bank * 0x200`. Caller usa 0..7 tipicamente.
 * @param deltaA  Delta word (`arg3 & 0xFFFF`) sommato alla coord-9-bit di
 *                bank A (`*0xA02000 + bank*0x200 + col*2`).
 * @param deltaB  Delta word (`arg4 & 0xFFFF`) sommato alla coord-9-bit di
 *                bank B (`*0xA02100 + bank*0x200 + col*2`).
 *
 * **Out-of-range**: nessun bound check (matching binario). Caller deve
 * garantire `(bank*0x200) + (col*2) + 0x101 < 0x1000`. Se l'indirizzo cade
 * fuori spriteRam, l'accesso fallisce (read = 0, write = no-op via Uint8Array
 * out-of-range — la TS replica è "safe" mentre il binario crasha; ma in
 * parity-test usiamo solo input validi).
 */
export function spritePairCoordAdd1D82(
  state: GameState,
  col: number,
  bank: number,
  deltaA: number,
  deltaB: number,
): void {
  // Solo low word degli args (matching `move.w (offs,SP),Dxw`).
  const colW = col & 0xffff;
  const bankW = bank & 0xffff;
  const dA = deltaA & 0xffff;
  const dB = deltaB & 0xffff;

  // A1 = 0xA02000 + (bank << 9) + (col << 1) — long add wrapping a 32 bit.
  // Offset locale in spriteRam = (bank << 9) + (col << 1).
  const baseOff = (((bankW << 9) >>> 0) + ((colW << 1) >>> 0)) >>> 0;
  // bank A: spriteRam offset 0 + baseOff
  const offA = baseOff;
  // bank B: spriteRam offset 0x100 + baseOff
  const offB = (baseOff + 0x100) >>> 0;

  // Step 1+2: leggi *A1 e *A0, estrai coord, somma delta — ESEGUITO IN
  // QUEST'ORDINE NEL BINARIO (read A1 prima di A0). Ininfluente per parità
  // ma rispettiamo per chiarezza.
  const oldA = readU16BE(state.spriteRam, offA);
  const oldB = readU16BE(state.spriteRam, offB);

  // Repack e write — A1 prima, A0 dopo (matching ordine binario 0x1DEE poi
  // 0x1E00). Anche qui ininfluente perché offA != offB.
  writeU16BE(state.spriteRam, offA, repackCoord(oldA, dA));
  writeU16BE(state.spriteRam, offB, repackCoord(oldB, dB));
}
