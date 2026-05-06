/**
 * script-slot-claim.ts — replica `FUN_00012D46` (40 byte).
 *
 * Wrapper "alloca slot e bind script-pointer" chiamato dal caller via PEA del
 * puntatore allo script header (es. `0x1D854`). Cerca il primo slot libero
 * nella tabella ROM @ `0x1F016` (25 entries, stride implicito perché i ptr
 * puntano a record stride 0x56 in work RAM @ 0x400A9C..0x4012AC) — questa
 * scansione è esattamente `FUN_00012D6E` (`slotSearch.findFirstFreeSlot_1F016`).
 * Se trovato, popola tre campi del record di slot e ritorna 0; se nessuno
 * libero, ritorna 0xFFFFFFFF (sentinel "not found").
 *
 * **Disasm 0x12D46..0x12D6D** (40 byte):
 *
 *   move.l  D2,-(A7)                  ; save D2
 *   move.l  (0x8,A7),D2               ; D2 = arg long (script header ptr)
 *   jsr     0x12D6E.l                 ; D0 = findFirstFreeSlot_1F016()
 *   move.l  D0,D1                     ; D1 = result
 *   moveq   #-1,D0                    ; D0 = 0xFFFFFFFF
 *   cmp.l   D1,D0                     ; D1 == -1?
 *   beq.b   done                      ; → niente slot libero, return 0xFFFFFFFF
 *   move.l  D2,-(A7)                  ; push arg2 = script ptr
 *   clr.l   -(A7)                     ; push arg1 = 0
 *   move.l  D1,-(A7)                  ; push arg0 = slot ptr
 *   jsr     0x12F44.l                 ; (mode-0 path, vedi sotto)
 *   lea     (0xc,A7),A7               ; pop 12 byte
 * done:
 *   move.l  (A7)+,D2                  ; restore D2
 *   rts
 *
 * **`FUN_00012F44` mode-0 path** (chiamato sempre con arg1=0 da qui):
 *   workRam[slot+0x3A..0x3D] ← scriptPtr (long, big-endian)
 *   workRam[slot+0x1A]       ← 0x03
 *   workRam[slot+0x18]       ← 0x01    (mark slot occupato)
 *   D0 ← 0    (effetto del move.b/ext.w/ext.l del prologo di FUN_12F44 con
 *              arg1=0; sovrascrive il moveq #-1 precedente)
 *
 * **Ritorno (D0)** — bit-perfect vs binario:
 *   0           = slot allocato e bind eseguito (success)
 *   0xFFFFFFFF  = nessuno slot libero (D2 ripristinato, niente side-effect)
 *
 * **Side effects sulla work RAM** (solo path success):
 *   slot+0x18 = 1, slot+0x1A = 3, slot+0x3A..3D = arg (BE long).
 *
 * **Caller noto**: `FUN_00012FD0` @ 0x13012 con `pea $1d854; jsr $12d46`.
 *
 * **Note callee** (`FUN_12F44`): la funzione completa supporta tre modi (byte
 * arg1: 0=bind, 1=free-slot, altri=no-op). Solo mode 0 è esercitato da
 * `FUN_00012D46`; in TS inlino il path mode-0 per evitare di replicare un
 * dispatcher ancora non strettamente necessario al call-graph attuale.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { findFirstFreeSlot_1F016 } from "./slot-search.js";

/** Sentinel "not found" — il binario ritorna `moveq #-1` cioè 0xFFFFFFFF. */
const NOT_FOUND = 0xffffffff >>> 0;

const WORK_RAM_BASE = 0x400000;

/** Offsets nel record di slot toccati dal mode-0 di FUN_12F44. */
const SLOT_OCCUPIED_BYTE_OFF = 0x18; // (0x18, A0) byte = 1 (mark occupato)
const SLOT_STATE_BYTE_OFF = 0x1a; // (0x1A, A0) byte = 3 (state init)
const SLOT_SCRIPT_LONG_OFF = 0x3a; // (0x3A, A0) long = arg (script ptr)

/**
 * Replica `FUN_00012D46` — alloca uno slot dalla tabella ROM @ 0x1F016 e lo
 * bind allo script `argPtr`.
 *
 * @param state    GameState (workRam letto da `findFirstFreeSlot_1F016` per
 *                 testare `slot+0x18` e scritto in caso di success).
 * @param rom      ROM image (per leggere la tabella di puntatori @ 0x1F016).
 * @param argPtr   Long argument pushato dal caller via PEA. È il puntatore
 *                 allo script header (in ROM, es. 0x1D854) che verrà salvato
 *                 in `slot+0x3A` come long big-endian.
 * @returns        D0 al ritorno:
 *                 - 0          = slot allocato, side effect su workRam.
 *                 - 0xFFFFFFFF = nessuno slot libero, niente side effect.
 */
export function claimScriptSlot(
  state: GameState,
  rom: RomImage,
  argPtr: number,
): number {
  // jsr 0x12D6E → cerca primo slot libero nella ROM table @ 0x1F016.
  const slotPtr = findFirstFreeSlot_1F016(state, rom) >>> 0;

  // Path "not found": il binario ritorna D0 = 0xFFFFFFFF e non tocca la RAM.
  if (slotPtr === NOT_FOUND) {
    return NOT_FOUND;
  }

  // Path "found": inline del mode-0 di FUN_12F44.
  // Tutti gli slot della tabella @0x1F016 puntano in work RAM (0x400A9C..),
  // quindi la sottrazione del base RAM è sicura.
  const slotOff = (slotPtr - WORK_RAM_BASE) >>> 0;
  const arg = argPtr >>> 0;

  // workRam[slot+0x3A..0x3D] = arg (long, big-endian m68k).
  state.workRam[slotOff + SLOT_SCRIPT_LONG_OFF] = (arg >>> 24) & 0xff;
  state.workRam[slotOff + SLOT_SCRIPT_LONG_OFF + 1] = (arg >>> 16) & 0xff;
  state.workRam[slotOff + SLOT_SCRIPT_LONG_OFF + 2] = (arg >>> 8) & 0xff;
  state.workRam[slotOff + SLOT_SCRIPT_LONG_OFF + 3] = arg & 0xff;

  // workRam[slot+0x1A] = 3 (state byte init), workRam[slot+0x18] = 1 (mark).
  state.workRam[slotOff + SLOT_STATE_BYTE_OFF] = 0x03;
  state.workRam[slotOff + SLOT_OCCUPIED_BYTE_OFF] = 0x01;

  // D0 al ritorno: il prologo di FUN_12F44 fa `move.b $b(a7),d0; ext.w; ext.l`
  // dove SP+0xB è il low byte di arg1 (=0), quindi D0 finisce a 0 e nessuno
  // dei branch successivi mode-0 lo modifica → D0 = 0.
  return 0;
}
