/**
 * sound-cmd-send-158ac.ts — replica `FUN_000158AC` (32 byte, ~16 istruzioni).
 *
 * **Disasm 0x158AC..0x158CB** (confermato via ghidra_disasm_at.py):
 *
 *   000158ac  move.b (0x7,SP),D0b        ; D0.b = byte arg (low byte di pushed long)
 *   000158b0  tst.w  (0x004003b8).l      ; flag "skip" word @ workRam+0x3B8
 *   000158b6  beq.b  0x000158bc          ; se 0 → procedi (continue)
 *   000158b8  moveq  0x0,D0              ; altrimenti D0=0
 *   000158ba  bra.b  0x000158ca          ; → rts (done)
 *   000158bc  ext.w  D0w                 ; sign-extend byte → word
 *   000158be  ext.l  D0                  ; sign-extend word → long
 *   000158c0  move.l D0,-(SP)            ; push long arg
 *   000158c2  jsr    0x0000023c.l        ; thunk → JMP 0x4C6E (sound dispatcher)
 *   000158c8  addq.l 0x4,SP              ; pop arg
 *   000158ca  rts
 *
 * **Comportamento**:
 *   - `tst.w (0x004003B8).l` legge una WORD big-endian da workRam[0x3B8..0x3B9].
 *     Se != 0 il flag "skip" è attivo: D0 = 0, ritorno immediato.
 *   - Se skip = 0: sign-extend del byte a long, JSR al sound dispatcher
 *     (FUN_4C6E via thunk @ 0x023C). FUN_4C6E scrive la word sign-extended
 *     al mailbox sound CPU @ MMIO 0xFE0000 dopo aver verificato che il chip
 *     sia ready (bit 7 di 0xF60001 = 0). Se il chip è busy, retra 256 volte
 *     e ritorna D0=0. Se il chip è ready, scrive e ritorna D0=1.
 *   - In questo modulo: la scrittura MMIO è side-effect-only — modelliamo
 *     solo D0 (0 = non inviato, 1 = inviato). L'MMIO è delegato al layer
 *     audio esterno (`audio.ts`/Bus).
 *
 * **Ritorno**:
 *   0 = non inviato (skip flag set, oppure chip mai ready dopo 256 retry)
 *   1 = inviato (chip ready, mailbox scritto — quando `chipPending=false`)
 *
 * **Callers**: 98 callsite nel binario — questa è la funzione centrale
 *   attraverso cui tutti i comandi sonori transitano.
 */

import type { GameState } from "./state.js";

/** ROM address of FUN_158AC. */
export const SOUND_CMD_SEND_158AC_ADDR = 0x000158ac as const;

/** workRam offset (relativo a 0x400000) del flag "skip cmd" (word BE). */
const SKIP_FLAG_WORD_OFF = 0x3b8 as const;

/**
 * Replica bit-perfect di `FUN_000158AC` — sound command send wrapper.
 *
 * @param state        GameState — legge `workRam[0x3B8..0x3B9]` come word BE
 *                     per il flag skip. Nessun side effect su workRam.
 * @param cmd          Byte (0..0xFF) — comando logico da spedire al chip.
 *                     Viene sign-extended a long prima della call a FUN_4C6E;
 *                     il low byte è invariante, quindi cmd == byte basso inviato.
 * @param chipPending  Modella bit 7 di MMIO `0xF60001` (chip busy). Default
 *                     `false` (chip ready) → D0=1. `true` → FUN_4C6E
 *                     esaurisce 256 retry → D0=0. Usare `false` nel
 *                     differential test per convergenza deterministica.
 * @returns            0 = skip flag attivo o chip mai ready; 1 = inviato.
 */
import { notifySoundCmd as notifyGlobalSoundCmd } from "./sound-hook.js";

/** Hook side-effect opzionale: chiamato quando soundCmdSend158AC manda un
 * cmd al chip (ritorno 1). Usato dal web frontend per wirare al SoundChip
 * TS (`submitCommand`). NON ha side effect sul state TS: solo emit esterno.
 * Default `undefined` (no-op, parity test invariato). */
let onSoundCmdHook: ((cmd: number) => void) | undefined = undefined;

export function setSoundCmdHook(hook: ((cmd: number) => void) | undefined): void {
  onSoundCmdHook = hook;
}

export function soundCmdSend158AC(
  state: GameState,
  cmd: number,
  chipPending: boolean = false,
): number {
  // tst.w (0x004003B8).l — legge WORD big-endian.
  // Skip se word != 0.
  const skipWord =
    (((state.workRam[SKIP_FLAG_WORD_OFF] ?? 0) << 8) |
      (state.workRam[SKIP_FLAG_WORD_OFF + 1] ?? 0)) &
    0xffff;

  if (skipWord !== 0) {
    // moveq #0,D0; bra.b done
    return 0;
  }

  // ext.w D0; ext.l D0: sign-extend byte → long.
  // La low byte del risultato è identica a `cmd & 0xFF`, quindi il payload
  // al sound CPU è invariato rispetto al byte passato.
  void ((cmd << 24) >> 24); // sign-extend — documentazione; non serve in TS

  // JSR 0x023C → FUN_4C6E (sound dispatcher).
  // Modellato con chipPending: se busy → D0=0, altrimenti → D0=1.
  if (chipPending) {
    // FUN_4C6E retra 256 volte, non trova il chip ready → D0=0.
    return 0;
  }

  // Chip ready: FUN_4C6E scrive MMIO 0xFE0000, ritorna D0=1.
  // Side-effect opzionale: notifica il sound chip TS (web frontend wire).
  if (onSoundCmdHook !== undefined) {
    onSoundCmdHook(cmd & 0xff);
  }
  // Notifica anche il global hook (fallback per altre sub-emit).
  notifyGlobalSoundCmd(cmd & 0xff);
  // DEBUG: count calls
  if (typeof globalThis !== "undefined") {
    const g = globalThis as { __sound158ACCount?: number };
    g.__sound158ACCount = (g.__sound158ACCount ?? 0) + 1;
  }
  return 1;
}
