/**
 * mailbox.ts — Latch 8-bit con pending bit, mirror di `generic_latch_8` MAME.
 *
 * Pattern hardware Atari System 1: il sound chip 6502 e la main CPU 68010
 * scambiano byte tramite due mailbox indipendenti, ognuna unidirezionale.
 * Atarisy1.cpp config:
 *
 *  - main→sound: write da 68K $FE0001 ≡ read da 6502 $1810
 *    On write: latch.value=byte, pending=true, NMI asserito al 6502.
 *    On read da 6502: clear pending, NMI rilasciato. Valore resta leggibile.
 *
 *  - sound→main: write da 6502 $1810 ≡ read da 68K $FC0001
 *    On write: latch.value=byte, pending=true, IRQ6 asserito alla main CPU.
 *    On read dal main: clear pending, IRQ rilasciato.
 *
 * Status bit position su $1820 ($1820 bit 4 = main pending,
 * $1820 bit 3 = sound pending). Polling via questo registro evita race
 * sui pending bit (vedi `sound-mmu.ts`).
 *
 * La callback `onWritePending` permette al chiamante di hook su NMI/IRQ
 * pin (fornita dal wiring in `sound-mmu.ts` per la mailbox main→sound, e
 * dal main-tick 68K side per sound→main). Le mailbox stesse non conoscono
 * le CPU: pin assertion sta nel layer di wiring.
 */

import type { u8 } from "../wrap.js";
import { as_u8 } from "../wrap.js";

export interface Mailbox8 {
  /** Ultimo byte scritto. Default 0 a reset. */
  value: u8;
  /** True dopo write, false dopo read (ack-on-read). */
  pending: boolean;
}

export function createMailbox(): Mailbox8 {
  return { value: as_u8(0), pending: false };
}

/** Write side: scrive byte, marca pending. Callback (opzionale) per NMI/IRQ
 * pin assertion. Idempotente sul pending (write multipli senza read
 * intermedio: l'ultimo byte vince). */
export function mailboxWrite(
  mb: Mailbox8,
  byte: u8,
  onWritePending?: () => void,
): void {
  mb.value = byte;
  const wasPending = mb.pending;
  mb.pending = true;
  if (!wasPending && onWritePending !== undefined) {
    // Edge-triggered: callback solo sulla transizione false→true.
    onWritePending();
  }
}

/** Read side: clear pending (ack), ritorna valore. Il valore resta leggibile
 * anche dopo clear (latch persiste). Callback (opzionale) per pin release. */
export function mailboxRead(mb: Mailbox8, onReadAck?: () => void): u8 {
  const v = mb.value;
  if (mb.pending) {
    mb.pending = false;
    if (onReadAck !== undefined) onReadAck();
  }
  return v;
}

/** Reset hard: pending=false, value=0. Usato da CPU RESET. */
export function mailboxReset(mb: Mailbox8): void {
  mb.value = as_u8(0);
  mb.pending = false;
}
