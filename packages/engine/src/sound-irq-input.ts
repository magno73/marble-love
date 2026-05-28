/**
 * sound-irq-input.ts - IRQ handler that samples one MMIO byte and stores it in
 * a 16-entry circular buffer.
 *
 * Likely models the sound CPU mailbox at 0xFC0001:
 *
 *   1. Saves A1/A0/D0 on the stack (irrelevant in TS).
 *   2. A1 = 0x401F44 (base struct mailbox).
 *   3. A0 = (long *)(A1+0x16) = LONG @ 0x401F5A. Lo chiamiamo `ackPtr`.
 *        - idx = (byte)*(A1+0x13) @ 0x401F57   (cyclic index 0..14)
 *        - A0 = A1 + 2 + idx                    @ 0x401F46+idx (entry buffer)
 *        - *(A1+0x13)++                         (post-increment)
 *      If ackPtr != 0 (ack pending, external target):
 *        - *(A1+0x16) (long) ++                 (advance pointer by 1 byte)
 *        - *(A1+0x14) (byte) --                 (decrement counter)
 *   6. RTE -> return.
 *
 *
 * 0x401F57 (idx), 0x401F58 (counter), 0x401F5A..0x401F5D (long ackPtr),
 */

import type { GameState } from "./state.js";

const A1_BASE = 0x1f44; // base struct mailbox (workRam offset)
const BUF_OFF = 0x1f46; // buffer 16-entry @ A1+2 .. A1+0x11
const IDX_OFF = 0x1f57; // byte cyclic index @ A1+0x13
const CNT_OFF = 0x1f58; // byte ack counter @ A1+0x14
const ACK_PTR_OFF = 0x1f5a; // long ack pointer @ A1+0x16

/**
 * Replica `FUN_00004D1A` — IRQ sound input mailbox.
 *
 *
 *  - workRam @ 0x1F46+idx (ack==0 branch), or the work RAM equivalent of ackPtr.
 */
export function soundIrqInputTick(state: GameState, mmioByte: number): void {
  const r = state.workRam;

  const ackPtr =
    (((r[ACK_PTR_OFF] ?? 0) << 24) |
      ((r[ACK_PTR_OFF + 1] ?? 0) << 16) |
      ((r[ACK_PTR_OFF + 2] ?? 0) << 8) |
      (r[ACK_PTR_OFF + 3] ?? 0)) >>>
    0;

  let writeAddr: number;

  if (ackPtr === 0) {
    // Negative signed values point before A1+2, e.g. 0xFF -> A1+1 = 0x401F45.
    const idxPre = (r[IDX_OFF] ?? 0) & 0xff;
    const idxSigned = idxPre >= 0x80 ? idxPre - 0x100 : idxPre;
    writeAddr = (0x00400000 + A1_BASE + 2 + idxSigned) >>> 0;

    // Post-increment idx (byte, wraps 0xFF -> 0).
    const idxNext = (idxPre + 1) & 0xff;

    if (idxPre < 0xf) {
      r[IDX_OFF] = idxNext;
    } else {
      r[IDX_OFF] = 0;
    }
  } else {
    // Branch B: ack in progress. Advance pointer (long ++) and decrement counter.
    writeAddr = ackPtr;

    const ackNext = (ackPtr + 1) >>> 0;
    r[ACK_PTR_OFF] = (ackNext >>> 24) & 0xff;
    r[ACK_PTR_OFF + 1] = (ackNext >>> 16) & 0xff;
    r[ACK_PTR_OFF + 2] = (ackNext >>> 8) & 0xff;
    r[ACK_PTR_OFF + 3] = ackNext & 0xff;

    const cntPre = (r[CNT_OFF] ?? 0) & 0xff;
    const cntNext = (cntPre - 1) & 0xff;
    r[CNT_OFF] = cntNext;

    if (cntNext === 0) {
      r[ACK_PTR_OFF] = 0;
      r[ACK_PTR_OFF + 1] = 0;
      r[ACK_PTR_OFF + 2] = 0;
      r[ACK_PTR_OFF + 3] = 0;
    }
  }

  // Non-work-RAM targets are ignored; see the jsdoc note.
  if (writeAddr >= 0x00400000 && writeAddr < 0x00402000) {
    r[writeAddr - 0x00400000] = mmioByte & 0xff;
  }
}

// Offset exports used by tests.
export const SND_IRQ_BUF_OFF = BUF_OFF;
export const SND_IRQ_IDX_OFF = IDX_OFF;
export const SND_IRQ_CNT_OFF = CNT_OFF;
export const SND_IRQ_ACK_PTR_OFF = ACK_PTR_OFF;
export const SND_IRQ_BASE_OFF = A1_BASE;
