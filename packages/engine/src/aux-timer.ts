/**
 * aux-timer.ts — replica `FUN_00010146` (timer/contatore secondario, 72 byte).
 *
 * Chiamata dal mainTick (`FUN_00028788`) al posto del placeholder
 * "FUN_10146 (timer secondario) — STUB" in `main-tick.ts`. Consuma 1 byte
 * dalla queue circolare `0x401F44` (vedi `byte-queue.ts`) e aggiorna due
 * piccoli "stati di servizio" in work RAM in base al byte estratto e al
 * countdown word `*0x4003B8`.
 *
 * **Disasm 0x10146..0x1018e** (72 byte, 0 args, 0 ret):
 *
 *   jsr     (0x178).l                  ; D0 = dequeueByte()  (FUN_4D68)
 *   cmpi.l  #-0x1, D0
 *   beq.b   end                        ; queue vuota → return (no-op)
 *
 *   tst.w   (0x004003B8).l             ; word countdown / "armed"
 *   beq.b   skip_b8_branch
 *     cmpi.w #0xFF, D0w                ; sentinel byte 0xFF nel byte basso
 *     bne.b  skip_b8_branch
 *     clr.w  (0x004003B8).l            ; → "ack/clear"
 *     bra.b  end                       ; e NON tocca *0x4003B4
 *   skip_b8_branch:
 *
 *   tst.b   (0x004003B2).l             ; flag "modalità attiva" (es. game-main-gate set 0x40)
 *   beq.b   inc_b4
 *     andi.w #0x7, D0w                 ; solo se i 3 bit bassi del byte sono 0
 *     bne.b  inc_b4
 *     clr.b  (0x004003B2).l            ; → reset coppia di flag
 *     clr.b  (0x004003B4).l
 *     bra.b  end
 *   inc_b4:
 *     addq.b #1, (0x004003B4).l        ; counter saturato modulo 256 (M68k addq.b)
 *
 *   end: rts
 *
 * **Stato globale toccato** (work RAM, vedi anche `boot-init.ts`):
 *   - `0x4003B2` byte: flag attivo (set a 0x40 da `game-main-gate.ts` Block C)
 *   - `0x4003B4` byte: contatore secondario (incremento per tick non-ack)
 *   - `0x4003B8` word: countdown 16 bit (init 0x012C da `FUN_100E0`)
 *
 * **Semantica intuitiva** (interpretazione, non verificata in-game):
 *   La funzione drena un byte alla volta dalla sound queue 0x401F44 e lo usa
 *   come "tick clock" per due timer:
 *     - se `*0x4003B8 != 0` e arriva il byte sentinel `0xFF`, il countdown
 *       viene azzerato (handshake "ack").
 *     - altrimenti, se `*0x4003B2 != 0` (modalità attiva) e arriva un byte
 *       multiplo di 8, il flag attivo + il counter `0x4003B4` vengono
 *       resettati (probabile "fine sequenza").
 *     - in tutti gli altri rami non-empty il counter `0x4003B4` viene
 *       incrementato di 1.
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-aux-timer-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";
import { dequeueByte } from "./byte-queue.js";

/** Offset workRam (assoluti = +0x400000). */
export const ACTIVE_FLAG_OFF = 0x3b2 as const; // byte
export const COUNTER_OFF = 0x3b4 as const; // byte
export const COUNTDOWN_HI_OFF = 0x3b8 as const; // word big-endian (hi byte)
export const COUNTDOWN_LO_OFF = 0x3b9 as const; // word big-endian (lo byte)

/**
 * Replica `FUN_00010146` — sub di servizio "aux timer".
 *
 * Zero argomenti, zero return. Side effects pure su `state.workRam` e
 * (via `dequeueByte`) sulla head della queue 0x401F44.
 *
 * @param state GameState corrente. Mutato in-place.
 */
export function auxTimer(state: GameState): void {
  // jsr 0x178 → FUN_4D68 (dequeueByte). Ritorna 0xFFFFFFFF se empty.
  const d0 = dequeueByte(state) >>> 0;

  // cmpi.l #-1, D0 ; beq end → no-op se queue vuota.
  if (d0 === 0xffffffff) return;

  // tst.w *0x4003B8 — word big-endian: hi=workRam[0x3B8], lo=workRam[0x3B9].
  const hi = state.workRam[COUNTDOWN_HI_OFF] ?? 0;
  const lo = state.workRam[COUNTDOWN_LO_OFF] ?? 0;
  const countdownWord = ((hi << 8) | lo) & 0xffff;

  if (countdownWord !== 0) {
    // cmpi.w #0xFF, D0w — confronto su low word, ma D0 è 0..255 (byte).
    // beq → equality solo se d0_low_word == 0xFF.
    if ((d0 & 0xffff) === 0xff) {
      // clr.w *0x4003B8 ; bra end (non tocca *0x4003B4).
      state.workRam[COUNTDOWN_HI_OFF] = 0;
      state.workRam[COUNTDOWN_LO_OFF] = 0;
      return;
    }
    // bne → fall-through al test successivo.
  }

  // tst.b *0x4003B2 ; beq inc_b4
  const activeFlag = state.workRam[ACTIVE_FLAG_OFF] ?? 0;
  if (activeFlag !== 0) {
    // andi.w #7, D0w → solo bit 0..2 del byte. bne inc_b4.
    if ((d0 & 0x7) === 0) {
      // clr.b *0x4003B2 ; clr.b *0x4003B4 ; bra end.
      state.workRam[ACTIVE_FLAG_OFF] = 0;
      state.workRam[COUNTER_OFF] = 0;
      return;
    }
  }

  // inc_b4: addq.b #1, *0x4003B4. Wrap modulo 256 (byte add).
  state.workRam[COUNTER_OFF] = (((state.workRam[COUNTER_OFF] ?? 0) + 1) & 0xff);
}
