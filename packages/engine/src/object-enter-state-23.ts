/**
 * object-enter-state-23.ts — replica `FUN_000160D4` (34 byte).
 *
 * Sub di transizione "entra nello stato 0x23" per un oggetto del game world.
 * Imposta il byte di stato @ `obj+0x1A` = 0x23, invoca l'helper FUN_15D10
 * (logica di selezione successiva non modellata in questo modulo) e poi
 * scrive il long timer/duration `0x00070000` @ `obj+0x68`.
 *
 * **Disasm 0x160D4..0x160F5** (34 byte, 1 arg long sullo stack = `objPtr`):
 *
 *   move.l  A2,-(SP)                     ; salva A2
 *   movea.l (0x8,SP),A2                  ; A2 = arg long (puntatore oggetto)
 *   move.b  #0x23,(0x1a,A2)              ; obj.state = 0x23
 *   move.l  A2,-(SP)                     ; push obj (per FUN_15D10)
 *   jsr     0x00015d10.l                 ; FUN_15D10 — helper non modellato qui
 *   move.l  #0x70000,(0x68,A2)           ; obj.timerLong = 0x00070000
 *   addq.l  #0x4,SP                      ; pop arg di FUN_15D10
 *   movea.l (SP)+,A2                     ; ripristina A2
 *   rts
 *
 * **Convenzione caller**: oggetto pushato come long sullo stack (M68k cdecl).
 * Tutti i caller noti (FUN_158F6 @ 0x15928 / 0x1594A, FUN_15E24 @ 0x15F82,
 * FUN_1BC88 @ 0x1BF60 / 0x1BF8A) pushano `A2` (registro che contiene il
 * puntatore all'oggetto correntemente processato).
 *
 * **Side effects sull'oggetto**:
 *   - `obj[0x1A]` byte ← 0x23
 *   - `obj[0x68..0x6B]` long ← 0x00070000 (big-endian: 00 07 00 00)
 *
 * **NOTA su FUN_15D10**: l'helper interno mutua altri campi del medesimo
 * oggetto (es. `+0x6E` long via D6, e in alcuni rami `+0x1A` ← 0x20 con
 * eventuale ricorsione su FUN_160D4) e legge da `+0x0C`, `+0x10`, `+0x72`.
 * Quel comportamento NON è modellato in questo modulo: il differential test
 * patcha `FUN_15D10` a `rts` per isolare la parità del solo `FUN_160D4`.
 *
 * **Stato 0x23 — interpretazione (caller FUN_158F6)**:
 *   - oggetto in stato 0x21/0x22 → entra in 0x23 (entrambi i path callano)
 *   - oggetto in stato 0x24 con timer `+0x56` esaurito → entra in 0x23
 * Il byte 0x23 è quindi uno stato "armato/attivo" con durata `+0x68` =
 * 0x70000 tick (~458752, probabile contatore in formato fixed point).
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-object-enter-state-23-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";

/** Base assoluta della work RAM (corrisponde a `0x400000` nel bus M68k). */
const WORK_RAM_BASE = 0x400000;

/** Offset (relativi al puntatore oggetto) toccati direttamente da FUN_160D4. */
export const OBJECT_STATE_BYTE_OFF = 0x1a as const;
export const OBJECT_TIMER_LONG_OFF = 0x68 as const;

/** Valore costante scritto nel byte di stato. */
export const STATE_VALUE_23 = 0x23 as const;

/** Valore costante scritto nel long timer (big-endian: 00 07 00 00). */
export const TIMER_LONG_VALUE = 0x00070000 as const;

/**
 * Replica `FUN_000160D4` — "enter state 0x23" wrapper.
 *
 * Imposta lo stato byte @ `objPtr+0x1A` a 0x23 e il timer long @ `objPtr+0x68`
 * a 0x00070000. La chiamata interna a FUN_15D10 (helper di selezione)
 * non è modellata: questo modulo replica solo le scritture dirette di
 * FUN_160D4 sull'oggetto.
 *
 * Zero return value (rts puro). Side-effect puro su `state.workRam`.
 *
 * @param state  GameState corrente. `workRam` mutato in-place.
 * @param objPtr Puntatore assoluto all'oggetto (es. `0x00401E00`). Deve
 *               cadere all'interno della work RAM (`0x400000..0x401FFF`)
 *               e lasciare almeno 0x6C byte disponibili (per i campi
 *               toccati: 0x1A byte + 0x68..0x6B long).
 */
export function objectEnterState23(state: GameState, objPtr: number): void {
  const objOff = ((objPtr >>> 0) - WORK_RAM_BASE) >>> 0;

  // move.b #0x23, (0x1A, A2) — byte di stato.
  state.workRam[objOff + OBJECT_STATE_BYTE_OFF] = STATE_VALUE_23;

  // jsr 0x00015D10 — helper non modellato qui (vedi nota in header).
  // I caller del differential test patchano FUN_15D10 a `rts`.

  // move.l #0x70000, (0x68, A2) — long timer big-endian 00 07 00 00.
  state.workRam[objOff + OBJECT_TIMER_LONG_OFF + 0] = (TIMER_LONG_VALUE >>> 24) & 0xff;
  state.workRam[objOff + OBJECT_TIMER_LONG_OFF + 1] = (TIMER_LONG_VALUE >>> 16) & 0xff;
  state.workRam[objOff + OBJECT_TIMER_LONG_OFF + 2] = (TIMER_LONG_VALUE >>> 8) & 0xff;
  state.workRam[objOff + OBJECT_TIMER_LONG_OFF + 3] = TIMER_LONG_VALUE & 0xff;
}
