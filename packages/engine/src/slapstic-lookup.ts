/**
 * slapstic-lookup.ts — replica `FUN_0002FFB8` (32 byte): lookup in ROM
 * slapstic-protetta, IRQ-safe.
 *
 * Sub di servizio chiamata da 5 helper diversi (FUN_1344C, FUN_13EE6,
 * FUN_16EC6, FUN_16F6C, FUN_1A444, FUN_1ACE0). Ricevono come arg long
 * un word esteso (`ext.l`); la funzione usa quel word come **indice** per
 * leggere una `move.w` dalla ROM slapstic-protetta `0x080000-0x087FFF`.
 *
 * **Disasm 0x2FFB8..0x2FFD8** (32 byte, 1 word arg via stack, ritorna word in D0w):
 *
 *   move    SR,D1w                        ; salva interrupt mask
 *   move    #0x2700,SR                    ; disabilita IRQ (level 7 mask)
 *   move.w  (0x080000).l, D0w             ; "trigger" slapstic (low word di D0
 *                                         ;  scartata subito dopo)
 *   move.w  (0x6,SP), D0w                 ; D0w = arg word (caller ha pushato
 *                                         ;  un long ext.l da word)
 *   lea     (0x080080).l, A0              ; A0 = 0x80080 (base tabella)
 *   asl.l   #0x5, D0                      ; D0 (long) <<= 5  ; sul low word
 *                                         ;  l'effetto utile è (arg<<5)&0xFFFF
 *   move.w  (0x0,A0,D0w*0x1), D0w         ; D0w = readWord(A0 + signExt16(D0w))
 *   move    D1w,SR                        ; ripristina IRQ mask
 *   rts                                   ; → D0w = word letta
 *
 * **Convenzione caller**: `move.l D0,-(SP) ; jsr ; addq.l #4, SP`. L'arg è la
 * low word del long pushato (ext.l da word). I caller di Marble passano valori
 * molto piccoli (tipicamente 0..3 o un word da `0x40066x`), quindi l'indice
 * resta nel range [0..0x60] e l'address letto è dentro la slapstic ROM
 * (`0x80080..0x800E0`).
 *
 * **Slapstic & side effects**:
 *   La prima `move.w (0x80000)` è la classica "trigger" del slapstic chip 103:
 *   il valore letto è scartato subito dopo, ma il chip cambia stato interno
 *   (selezione bank). Nel modello bus.ts attuale (Phase 4d) il chip non è
 *   emulato come state machine: l'area `0x80000-0x87FFF` è ROM piatta
 *   (bank 0 sempre attivo). Il binario oracle (Musashi) si comporta allo stesso
 *   modo, quindi la parità è verificata su lookup byte-per-byte dal blob ROM.
 *
 *   `move #0x2700, SR` mette il CPU in supervisor + maschera IRQ7. È necessario
 *   nel binario perché un IRQ in mezzo al sequenza slapstic perderebbe la
 *   sincronia col chip. Nel modello TS non c'è chip — è no-op.
 *
 * **Return value**: low word di D0 (D0w). Le bit alte di D0 sono lasciate "dirty"
 * dal `asl.l` (entrano i bit alti del'arg + i residui del caller); MA i caller
 * conosciuti **scartano D0** subito dopo (lo sovrascrivono o non lo usano).
 * Esponiamo solo il word lookup come ritorno.
 *
 * Bit-perfect verificato vs binary tramite `cli/src/test-slapstic-lookup-parity.ts`
 * (500/500 cases).
 */

import type { RomImage } from "./bus.js";

/** Base della tabella indicizzata, dentro la slapstic-protected ROM region. */
export const SLAPSTIC_LOOKUP_BASE = 0x080080 as const;

/** Indirizzo della "trigger read" che il binario fa prima del lookup. */
export const SLAPSTIC_TRIGGER_ADDR = 0x080000 as const;

/**
 * Replica `FUN_0002FFB8` — lookup IRQ-safe in ROM slapstic.
 *
 * Calcola `idx = signExt16((arg << 5) & 0xFFFF)` e ritorna la word letta a
 * `0x80080 + idx`, big-endian, dal blob ROM.
 *
 * Gli accessi sono modellati come read piatti dalla ROM image:
 *   - `rom.program[address]` per gli offset `0x080000..0x087FFF` (slapstic
 *     bank 0, l'unico modellato attualmente)
 *   - per address < `0x080000` cade nella program ROM principale (fallback
 *     coerente col disasm: con arg con bit 10 set, `(arg<<5)&0xFFFF` può
 *     essere ≥ 0x8000 → signExt16 → negativo → indirizzo prima di 0x80080).
 *
 * @param rom    RomImage (la sola dipendenza esterna).
 * @param argW   Argomento word (16 bit unsigned). Estratto come low word
 *               del long pushato dal caller (`ext.l` da word, quindi
 *               numericamente equivalente al word pre-extension a parte
 *               la sign-extension che la funzione comunque ignora,
 *               sovrascrivendo D0w con `(0x6,SP)`).
 * @returns      Word (16 bit unsigned) letto dalla tabella slapstic.
 */
export function slapsticLookup(rom: RomImage, argW: number): number {
  const arg = argW & 0xffff;

  // asl.l #5, D0 sul low word produce (arg << 5) & 0xFFFF; sign-extend a i32
  // per il calcolo dell'address effettivo (M68K usa D0w come indice signed
  // word in `(0x0, A0, D0w*1)`).
  const shifted = (arg << 5) & 0xffff;
  const idx = (shifted << 16) >> 16; // signExt16 → i32

  // EA = 0x80080 + idx, calcolato come unsigned 32-bit (wrap come sul 68K).
  const addr = (SLAPSTIC_LOOKUP_BASE + idx) >>> 0;

  return readRomWordBE(rom, addr);
}

/**
 * Read 16-bit big-endian dal blob ROM. Non c'è dispatch MMIO qui: il binario
 * accede solo all'area ROM (0x000000-0x087FFF nel layout Marble); per un valore
 * fuori range ritorniamo 0 (coerente col `read16` di bus.ts che ritornerebbe
 * 0xFFFF/0 sull'unmapped, ma per parità con Musashi serve la lettura ROM
 * piatta).
 */
function readRomWordBE(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  // Mappa diretta: il blob `program` contiene sia main ROM (0..0x7FFFF) sia
  // slapstic (0x80000..0x87FFF) come bank 0. Address >= 0x88000 → 0.
  if (a >= rom.program.length - 1) {
    // Tentativo di lettura word con almeno il low byte fuori dal blob → 0.
    if (a >= rom.program.length) return 0;
    return ((rom.program[a] ?? 0) << 8) & 0xffff;
  }
  const hi = rom.program[a] ?? 0;
  const lo = rom.program[a + 1] ?? 0;
  return ((hi << 8) | lo) & 0xffff;
}

