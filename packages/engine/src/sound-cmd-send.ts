/**
 * sound-cmd-send.ts — replica `FUN_000158AC` (32 byte).
 *
 * Wrapper di alto livello chiamato da ~100 callsite per inviare un comando
 * "logico" al sound CPU (6502) o, equivalentemente, al char-draw engine: il
 * binario originale usa lo stesso path per due semantiche (cfr.
 * `docs/static-overview.md` lo etichetta "wrapper di print_char_at_pos"
 * mentre il target finale `FUN_00004C6E` scrive al mailbox sound 0xFE0000).
 *
 * **Disasm 0x158AC..0x158CB** (32 byte):
 *
 *   move.b  (0x7,SP),D0b               ; D0.b = byte arg (low byte di pushed long)
 *   tst.w   (0x004003B8).l             ; flag "skip" word @ workRam+0x3B8
 *   beq.b   continue                   ; se 0 → procedi
 *   moveq   #0,D0                      ; altrimenti D0=0
 *   bra.b   done                       ; → rts
 * continue:
 *   ext.w   D0w                        ; sign-extend byte → word
 *   ext.l   D0                         ; sign-extend word → long
 *   move.l  D0,-(SP)                   ; push long arg
 *   jsr     0x023C.l                   ; thunk → JMP 0x4C6E (sound dispatcher)
 *   addq.l  #4,SP                      ; pop arg
 * done:
 *   rts
 *
 * **Convenzione caller**: byte arg pushato come long sullo stack (M68k cdecl);
 * lettura `(0x7,SP)` recupera il byte basso del long pushato.
 *
 * **Ritorno (D0)**:
 *   0 = comando NON inviato. Due cause:
 *       a) skip flag attivo (`*0x4003B8 != 0`)
 *       b) sound chip non ready dopo 256 retry in FUN_4C6E
 *   1 = comando inviato con successo (FUN_4C6E ha scritto a 0xFE0000)
 *
 * **Side effects**: nessuno sul `workRam`. L'unico effetto osservabile è la
 * scrittura MMIO a `0xFE0000` (mailbox sound CPU) che FUN_4C6E gestisce; in
 * questo modulo NON la modelliamo (gestita a livello superiore da `audio.ts`).
 *
 * **Nota sign extension**: il byte viene sign-extended a long PRIMA di essere
 * passato a FUN_4C6E, ma FUN_4C6E legge solo la WORD (`move.w (0x6,SP),D0w`)
 * dal long pushato. La low word del long sign-extended è:
 *   - se byte < 0x80: 0x00xx
 *   - se byte >= 0x80: 0xFFxx
 * Quel valore viene poi scritto a 0xFE0000 (mailbox 16 bit, ma solo low byte
 * arriva al 6502 in MAME). Il low byte è comunque == byte arg originale.
 *
 * In TS modelliamo solo D0; la `move.w` MMIO è side-effect-only sul chip.
 */

import type { GameState } from "./state.js";
import { notifySoundCmd as notifyGlobalSoundCmd } from "./sound-hook.js";

/** Offset (workRam-relative) del flag "skip cmd" word. */
const SKIP_FLAG_WORD_OFF = 0x3b8;

/**
 * Replica `FUN_000158AC` — sound command send wrapper (con skip flag).
 *
 * @param state         GameState (legge `workRam[0x3B8..0x3B9]` come word BE).
 * @param byteArg       byte (0..0xFF) — comando logico da spedire al chip.
 * @param chipPending   Modella bit 7 di MMIO `0xF60001` per il path interno
 *                      di FUN_4C6E. `false` (default, chip ready) → invio
 *                      riesce al primo tentativo e D0=1. `true` (chip busy)
 *                      → FUN_4C6E retra 256 volte e ritorna D0=0. Il caller
 *                      reale del binario lascia che il loop interno si auto-
 *                      risolva durante l'IRQ del 6502; per il differential
 *                      test settiamo `chipPending=false` (= MMIO 0xF60001
 *                      bit 7 clear) così il binario esce sempre con D0=1
 *                      quando lo skip flag è 0.
 * @returns 0 = comando non inviato (skip flag set, oppure chip mai ready),
 *          1 = comando inviato (chip ready, mailbox scritto).
 */
export function soundCmdSend(
  state: GameState,
  byteArg: number,
  chipPending: boolean = false,
): number {
  // `byteArg` non viene letto in questa funzione: è il payload del comando
  // che FUN_4C6E scriverebbe a MMIO 0xFE0000 (effetto laterale gestito a
  // livello superiore in `audio.ts`/Bus). Lo accettiamo nella firma per
  // 1:1 con la convenzione del binario; lo "consumiamo" qui senza scrivere
  // nulla — lascia traccia del payload nel return path se serve.
  void byteArg;
  // tst.w (0x004003B8).l — legge word big-endian @ workRam+0x3B8.
  // Nota: tst.w legge una WORD, quindi il flag "non zero" scatta se uno
  // qualsiasi dei due byte (0x3B8, 0x3B9) è != 0.
  const skipFlag =
    (((state.workRam[SKIP_FLAG_WORD_OFF] ?? 0) << 8) |
      (state.workRam[SKIP_FLAG_WORD_OFF + 1] ?? 0)) &
    0xffff;

  if (skipFlag !== 0) {
    // moveq #0,D0; bra done — skip senza side effect.
    return 0;
  }

  // Path "send": equivalente di JSR 0x4C6E con il byte sign-extended a long.
  // FUN_4C6E retra fino a 256 volte se il chip è busy; senza modello del 6502
  // il caller passa `chipPending=false` (default) → success al primo giro.
  if (chipPending) {
    // Loop si esaurisce dopo 256 iterazioni → D0=0.
    return 0;
  }
  // Side-effect opzionale: notifica web frontend del cmd inviato.
  notifyGlobalSoundCmd(byteArg & 0xff);
  return 1;
}
