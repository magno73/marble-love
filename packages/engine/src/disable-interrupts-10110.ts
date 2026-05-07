/**
 * disable-interrupts-10110.ts — replica `FUN_00010110` (6 byte).
 *
 * **Disasm 0x010110..0x010115** (6 byte):
 *
 *   00010110    move #0x2700,SR   ; SR ← 0x2700: supervisor + IPL=7
 *   00010114    rts
 *
 * **Semantica**: imposta il registro di stato 68010 a `0x2700`, portando il
 * livello di priorità interrupt (IPL) a 7 — il massimo. Effetto netto:
 * **tutte le IRQ hardware vengono mascherate**. La CPU rimane in supervisor
 * mode (bit 13 di SR = 1). Nessun bit di condizione (C/V/Z/N/X) viene
 * alterato perché il load su SR è esplicito tramite `move #imm,SR`.
 *
 * **Xrefs (callers)**:
 *   - `0x00028a14` in `FUN_00028972` (UNCONDITIONAL_CALL)
 *   - `0x00028a88` in `FUN_00028972` (UNCONDITIONAL_CALL)
 *   - `0x0002bc62` in `FUN_0002bc5c` (UNCONDITIONAL_CALL)
 *   - Entry Point in ? (EXTERNAL)
 *
 * Tutti i caller usano questa funzione come entry di critical section (disable
 * IRQ prima di modificare strutture condivise con l'ISR).
 *
 * **Side effects su workRam**: nessuno. La funzione modifica solo SR (registro
 * CPU), non la RAM.
 *
 * **Valore di ritorno**: `0x2700` (il nuovo SR). Poiché `GameState` non
 * modella SR, il caller che necessita di propagare il nuovo livello IRQ
 * usa questo valore restituito. Per compatibilità con il parity test, il
 * valore è deterministico e identico per qualunque input.
 *
 * Verifica bit-perfect via `cli/src/test-disable-interrupts-10110-parity.ts`.
 */

/** Valore SR scritto da `move #0x2700,SR`: supervisor mode + IPL=7. */
export const SR_IPL7_SUPERVISOR = 0x2700 as const;

/**
 * Replica bit-perfect di `FUN_00010110` (6 byte, disable-all-IRQ).
 *
 * `move #0x2700,SR` + `rts`. Nessun side effect su RAM.
 *
 * @returns `0x2700` — nuovo valore SR (supervisor, IPL=7, flags cleared).
 */
export function disableInterrupts10110(): number {
  // move #0x2700,SR — carica SR con valore immediato 0x2700.
  // rts            — ritorna al caller.
  return SR_IPL7_SUPERVISOR;
}
