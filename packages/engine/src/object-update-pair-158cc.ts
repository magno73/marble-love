/**
 * object-update-pair-158cc.ts — replica `FUN_000158CC` (42 byte).
 *
 * Iteratore minimale: chiama il sub di update oggetto `FUN_000158F6` due
 * volte, una per ciascuna delle 2 slot dell'array @ `0x4009A4` (stride
 * `0x7C`). Lo stesso array è inizializzato da `slotArrayBulkInit`
 * (`FUN_00010392`) con `count=2, stride=0x7C` e scansionato da
 * `slotMatchesPtr_4009A4` (`FUN_000159D8`); è quindi una "object pair" di
 * 2 entry × 0x7C byte.
 *
 * **Caller**: `FUN_00010FE0` (parte di `FUN_00010FCE`, root del game tick
 * pre-vblank — cfr. xref unica). Tutti i frame attivi chiamano questa
 * funzione per "ticck-are" entrambe le slot della coppia.
 *
 * **Disasm 0x158CC..0x158F5** (42 byte, no args):
 *
 *   movem.l  {D2 D3}, -(SP)             ; salva D2/D3 (callee-save)
 *   move.l   #0x004009A4, D3            ; D3 = puntatore alla slot 0
 *   clr.b    D2                         ; D2.b = 0 (loop counter, byte)
 * loop:
 *   move.l   D3, D1                     ; D1 = ptr corrente
 *   moveq    #0x7C, D0                  ; D0 = stride 0x7C
 *   add.l    D0, D3                     ; D3 += 0x7C → ptr next slot
 *   move.l   D1, -(SP)                  ; push ptr corrente
 *   jsr      0x000158F6.l               ; FUN_158F6(slot ptr)
 *   addq.l   #0x4, SP                   ; pop arg
 *   addq.b   #0x1, D2                   ; D2++
 *   cmpi.b   #0x2, D2                   ; D2 == 2 ?
 *   bne.b    loop                       ; se no, itera
 *   movem.l  (SP)+, {D2 D3}             ; ripristina D2/D3
 *   rts
 *
 * **Comportamento**:
 *   - Chiama `FUN_158F6` esattamente due volte:
 *       1) con arg = `0x004009A4` (slot 0)
 *       2) con arg = `0x00400A20` (slot 1, = base + 0x7C)
 *   - L'ordine è fisso: prima slot 0, poi slot 1.
 *   - Nessun uso di campi della work RAM al di fuori di ciò che fa
 *     `FUN_158F6` internamente.
 *
 * **Side effects** (di FUN_158CC stesso, escludendo l'helper):
 *   - solo push/pop sullo stack (nessuna scrittura su workRam, MMIO, etc.)
 *   - nessun valore di ritorno (non scrive D0)
 *
 * **JSR sub injection**: `FUN_000158F6` è il sub di update oggetto
 * (gestisce i timer @ +0x6C, le transizioni di stato 0x21/0x22/0x24 →
 * 0x23 via `FUN_160D4`, e altre logiche complesse — cfr. la disasm di
 * `0x158F6..` riportata in `object-enter-state-23.ts`). NON è replicato
 * qui; viene esposto come callback opzionale via
 * `ObjectUpdatePair158CCSubs.objectUpdate`. Il caller (mainTick / la root
 * di FUN_10FCE quando sarà replicata) lo collegherà al vero update.
 *
 * Pattern speculare a `sound-pair-15884.ts` e `special-attract.ts`.
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-object-update-pair-158cc-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";

/** Base assoluta della work RAM (corrisponde a `0x400000` nel bus M68k). */
export const WORK_RAM_BASE = 0x400000 as const;

/** Indirizzo assoluto della slot 0 (literal `move.l #0x004009A4, D3`). */
export const SLOT_PAIR_BASE_ADDR = 0x004009a4 as const;

/** Stride tra due slot (`moveq #0x7C, D0`). */
export const SLOT_PAIR_STRIDE = 0x7c as const;

/** Numero di iterazioni (loop fino a `D2 == 2`). */
export const SLOT_PAIR_COUNT = 2 as const;

/**
 * Sub-functions stub iniettabili per `objectUpdatePair158CC`.
 *
 * `FUN_000158F6` (object update sub) NON è replicata; default no-op.
 */
export interface ObjectUpdatePair158CCSubs {
  /**
   * `FUN_000158F6`: sub di update oggetto, chiamata con un long contenente
   * il puntatore assoluto allo slot (es. `0x004009A4` o `0x00400A20`).
   * Default no-op.
   *
   * Il caller mainTick/`FUN_10FCE` futuro collegherà questa al vero
   * `objectUpdate158F6` quando sarà replicato.
   */
  objectUpdate?: (slotPtr: number) => void;
}

/**
 * Replica `FUN_000158CC` — itera 2 slot di `0x7C` byte e chiama
 * `FUN_000158F6` su ciascuna.
 *
 * Ordine deterministico: slot 0 (`0x004009A4`) → slot 1 (`0x00400A20`).
 * Nessun side effect proprio sulla `workRam`; nessun valore di ritorno.
 *
 * @param state  GameState (passato alla sub `objectUpdate` se serve, ma
 *               questa funzione di per sé non legge nulla da `state`).
 * @param subs   Stub iniettabili (default: `objectUpdate` no-op).
 */
export function objectUpdatePair158CC(
  state: GameState,
  subs?: ObjectUpdatePair158CCSubs,
): void {
  // `state` è qui solo per coerenza di firma con gli altri moduli "subs-
  // injection" (e per consentire al caller di passarne un riferimento
  // alla sub objectUpdate via closure). FUN_158CC stessa non legge la
  // work RAM.
  void state;

  for (let i = 0; i < SLOT_PAIR_COUNT; i++) {
    const slotPtr = (SLOT_PAIR_BASE_ADDR + i * SLOT_PAIR_STRIDE) >>> 0;
    subs?.objectUpdate?.(slotPtr);
  }
}
