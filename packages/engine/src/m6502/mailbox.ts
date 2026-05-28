/**
 * 8-bit latch with a pending bit, mirroring MAME's `generic_latch_8`.
 *
 * Atari System 1 uses two unidirectional mailboxes between the 68010 main CPU
 * and the 6502 sound CPU. Writes set `pending`; reads acknowledge and clear it
 * while leaving the latched value readable. Pin assertions are supplied by the
 * wiring layer through callbacks so the mailbox stays CPU-agnostic.
 */

import type { u8 } from "../wrap.js";
import { as_u8 } from "../wrap.js";

export interface Mailbox8 {
  /** Last written byte, reset default 0. */
  value: u8;
  /** True after write, false after read ack. */
  pending: boolean;
}

export function createMailbox(): Mailbox8 {
  return { value: as_u8(0), pending: false };
}

/**
 * Write side: latch byte and mark pending. Multiple writes before a read keep
 * pending true; the latest byte wins.
 */
export function mailboxWrite(
  mb: Mailbox8,
  byte: u8,
  onWritePending?: () => void,
): void {
  mb.value = byte;
  const wasPending = mb.pending;
  mb.pending = true;
  if (!wasPending && onWritePending !== undefined) {
    // Edge-triggered: callback only on the false -> true transition.
    onWritePending();
  }
}

/** Read side: clear pending as an ack and return the still-latched value. */
export function mailboxRead(mb: Mailbox8, onReadAck?: () => void): u8 {
  const v = mb.value;
  if (mb.pending) {
    mb.pending = false;
    if (onReadAck !== undefined) onReadAck();
  }
  return v;
}

/** Hard reset: pending=false, value=0. Used by CPU RESET. */
export function mailboxReset(mb: Mailbox8): void {
  mb.value = as_u8(0);
  mb.pending = false;
}
