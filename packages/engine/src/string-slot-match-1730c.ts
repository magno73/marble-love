/**
 * string-slot-match-1730c.ts — replica `FUN_0001730C` (58 byte).
 *
 * Sub di servizio "active-slot match-by-id" per l'array stringhe @ 0x401482
 * (stride 0x42, 7 slot). Chiamata da `FUN_00017346` (1 xref @ 0x1736E,
 * JSR.L) come gate prima di "agganciare" un nuovo record di stringa: se uno
 * slot **attivo** ha già lo stesso ID, l'allocazione viene abortita.
 *
 * **Argomento** (1 long sullo stack): `argPtr` puntatore a un record candidato.
 * Il campo letto è solo `*(argPtr + 0x2)` come long (l'ID del record).
 *
 * **Disasm 0x1730C..0x17345** (58 byte):
 *
 *   0001730c   move.l  D2, -(SP)              ; salva D2 (callee-saved)
 *   0001730e   movea.l (0x8, SP), A0          ; A0 = argPtr (SP+8: D2 + ret + arg)
 *   00017312   clr.b   D2b                    ; D2 = 0 (accumulatore "match found")
 *   00017314   movea.l #0x401482, A1          ; A1 = base array slot stringhe
 *   0001731a   clr.b   D1b                    ; D1 = 0 (loop counter byte)
 *   ; loop @ 0x1731C, i in [0..6]:
 *   0001731c   tst.b   (0x18, A1)             ; slot[i].byte+0x18 (active flag)
 *   00017320   beq.b   0x17330                ; == 0 → slot inattivo, prossimo
 *   00017322   move.l  (0x2, A0), D0          ; D0 = *(argPtr + 0x2) long (ID)
 *   00017326   cmp.l   (0x30, A1), D0         ; cmp slot[i].long+0x30, D0
 *   0001732a   bne.b   0x17330                ; ID diverso → prossimo
 *   0001732c   moveq   #1, D2                 ; match → D2 = 1
 *   0001732e   bra.b   0x1733C                ; → epilog (early exit)
 *   00017330   moveq   #0x42, D0              ; stride
 *   00017332   adda.l  D0, A1                 ; A1 += stride
 *   00017334   addq.b  #1, D1b                ; counter++
 *   00017336   cmpi.b  #0x7, D1b
 *   0001733a   bne.b   0x1731C                ; loop while != 7
 *   ; epilog:
 *   0001733c   move.b  D2b, D0b
 *   0001733e   ext.w   D0w
 *   00017340   ext.l   D0                     ; D0 = sign-extend di D2.b (0 o 1)
 *   00017342   move.l  (SP)+, D2              ; restore D2
 *   00017344   rts
 *
 * **Semantica**: scansiona i 7 slot stringa @ 0x401482 (stride 0x42); per
 * ogni slot **attivo** (`byte+0x18 != 0`), se la long a `slot+0x30` matcha
 * `*(argPtr+0x2)` (long), ritorna 1 (match found, **early exit**). Altrimenti
 * dopo aver visitato tutti i 7 slot ritorna 0.
 *
 * **Nessuna JSR**: la funzione è self-contained (puro lookup-in-table).
 * Nessun side-effect su workRam / MMIO / palette / sprite / alpha RAM.
 *
 * **Nota su early-exit**: a differenza di `findFreeSlotInTable` (FUN_14BCE)
 * che salva l'ULTIMO match, qui la `bra.b` su `moveq #1,D2` salta l'epilog
 * uscendo SUBITO al primo match. Comportamento osservabile solo se più
 * slot attivi hanno lo stesso ID (caso patologico), ma replicato bit-perfect.
 *
 * **Field semantics** (per simmetria con altre `slotMatchesPtr_*`):
 *   - `byte+0x18` = "active flag" (0 = libero/inattivo, !=0 = occupato).
 *   - `long+0x30` = ID a 32 bit del record (es. pointer-equiv o handle).
 *   - `argPtr+0x2` = ID candidato (long) — stesso layout dei record stessi.
 *
 * Verifica bit-perfect via `cli/src/test-string-slot-match-1730c-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Indirizzo workRam del primo slot stringa (`movea.l #0x401482, A1`). */
export const SLOT_BASE_ADDR = 0x401482 as const;
/** Stride in byte tra slot consecutivi (`moveq #0x42, D0`). */
export const SLOT_STRIDE = 0x42 as const;
/** Numero di slot iterati dal loop (`cmpi.b #0x7, D1b`). */
export const SLOT_COUNT = 7 as const;
/** Offset del flag "active" within slot (`tst.b (0x18, A1)`). */
export const SLOT_ACTIVE_FLAG_OFF = 0x18 as const;
/** Offset del campo ID long within slot (`cmp.l (0x30, A1), D0`). */
export const SLOT_ID_LONG_OFF = 0x30 as const;
/** Offset del campo ID long within argPtr (`move.l (0x2, A0), D0`). */
export const ARG_ID_LONG_OFF = 0x2 as const;

/** WORK RAM base per sottrarre dagli indirizzi assoluti 68k. */
const WORK_RAM_BASE = 0x400000;

/**
 * Stub injection placeholder. FUN_1730C non chiama JSR, quindi questa
 * interface è vuota (mantenuta per simmetria col pattern degli altri sub).
 */
export type StringSlotMatch1730CSubs = Record<string, never>;

/**
 * Legge una long big-endian da workRam all'offset `off`.
 * Replica `move.l (off, Ax), Dx` del 68k (BE memory).
 */
function readU32BE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

/**
 * Replica bit-perfect di `FUN_0001730C` — string-slot match by ID.
 *
 * Scansiona i 7 slot stringa (`SLOT_BASE_ADDR + i*SLOT_STRIDE` per
 * `i ∈ 0..6`); per ciascuno **attivo** (`byte+0x18 != 0`), confronta
 * `slot.long+0x30` con `*(argPtr+0x2).long`. Ritorna 1 al primo match
 * (early exit), 0 se nessuno matcha.
 *
 * @param state    GameState (solo lettura su workRam @ 0x401482..0x401650).
 * @param argPtr   Puntatore assoluto 68k al record candidato. Letto solo
 *                 il long a `argPtr+0x2`.
 * @param _subs    placeholder (FUN_1730C non ha JSR).
 * @returns 1 se trovato uno slot attivo con stesso ID, 0 altrimenti.
 *
 * **Nessun side-effect**: la funzione è puro lookup. workRam / MMIO /
 * palette / sprite / alpha RAM sono invariati.
 */
export function stringSlotMatch1730C(
  state: GameState,
  argPtr: number,
  _subs?: StringSlotMatch1730CSubs,
): number {
  // *(argPtr + 0x2) long — ID candidato.
  const argOff = ((argPtr - WORK_RAM_BASE) >>> 0) + ARG_ID_LONG_OFF;
  const targetId = readU32BE(state, argOff);

  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = (SLOT_BASE_ADDR + i * SLOT_STRIDE) - WORK_RAM_BASE;

    // tst.b (0x18, A1): se slot inattivo, skip.
    const active = state.workRam[slotOff + SLOT_ACTIVE_FLAG_OFF] ?? 0;
    if (active === 0) continue;

    // cmp.l (0x30, A1), D0
    const slotId = readU32BE(state, slotOff + SLOT_ID_LONG_OFF);
    if (slotId === targetId) {
      // Early exit: bra.b epilog con D2=1.
      return 1;
    }
  }

  return 0;
}
