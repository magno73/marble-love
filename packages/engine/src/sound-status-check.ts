/**
 * sound-status-check.ts — replica `FUN_00004C3E` (sound command sender).
 *
 *
 * **Disasm 0x4C3E..0x4C6D** (48 byte):
 *
 *   move    SR,D1w               ; save interrupt mask
 *   btst.b  #0x7,(0xF60001).l    ; switch port bit 7 = "sound cmd pending"
 *   tst.l   (0x16,A1)            ; long @ A1+0x16 (slot occupied?)
 *   bne     fail                 ; abort when nonzero
 *   swap    D0
 *   move.b  D0b,(0x14,A1)        ; byte a A1+0x14 = (D0_originale >> 16) & 0xFF
 *   move.l  A0,(0x16,A1)         ; long at A1+0x16 = A0 (mark slot occupied)
 *   moveq   #1,D0                ; success
 *   bra     done
 * fail:
 *   moveq   #0,D0
 * done:
 *   move    D1w,SR               ; restore IRQ mask
 *   rts
 *
 * **Caller convention (FUN_4CA0)**: sets `D0 = 0x10003`, `A0 = 0x401F44`.
 *   0 = retry needed (caller increments the retry counter, saturating at 0xFF)
 *   1 = ok (caller skips retry)
 *
 * **MMIO interaction** (cfr `bus.ts`):
 *   0xF60001 bit 7 = sound command pending (active high; sound CPU owns it)
 *   0xFE0000      = sound CPU mailbox (write-only, 16 bit; MAME's 6502 sees
 *                    the low byte)
 *
 *   workRam[A0+0x14] ← (D0 >> 16) & 0xFF       (byte: comando "logico")
 *   workRam[A0+0x16..0x19] ← A0 (long, big-endian, slot owner pointer)
 *
 */

import type { GameState } from "./state.js";

/** Offsets relative to A1 used as the sender slot record. */
const SLOT_TYPE_BYTE_OFF = 0x14; // (0x14, A1) byte
const SLOT_OWNER_LONG_OFF = 0x16; // (0x16, A1) long (A0 ptr); 0 = free

/** Work RAM base for converting absolute A0/A1 addresses to offsets. */
const WORK_RAM_BASE = 0x400000;

/**
 * Replica `FUN_00004C3E` — sound command sender.
 *
 * @param d0       D0 (long, 32 bit). Bit 31..16 = "type byte" (in low 8),
 *                 bit 15..0 = parola spedita al chip.
 *                 also stored as the slot owner (A1 == A0 in the caller).
 *
 */
export function soundStatusCheck(
  state: GameState,
  d0: number,
  a0: number,
  soundPending: boolean = false,
): number {
  if (soundPending) {
    return 0;
  }

  // Slot-record offset in work RAM. A1 == A0 in the Marble Madness caller.
  const slotBase = (a0 - WORK_RAM_BASE) >>> 0;
  const ownerOff = slotBase + SLOT_OWNER_LONG_OFF;

  const owner =
    (((state.workRam[ownerOff] ?? 0) << 24) |
      ((state.workRam[ownerOff + 1] ?? 0) << 16) |
      ((state.workRam[ownerOff + 2] ?? 0) << 8) |
      (state.workRam[ownerOff + 3] ?? 0)) >>>
    0;
  if (owner !== 0) {
    return 0;
  }

  // Success path: commit the slot.
  // - move.b (D0 >> 16) & 0xFF -> workRam[A0+0x14]
  // - move.l A0                -> workRam[A0+0x16..0x19] (big-endian)
  const typeByteOff = slotBase + SLOT_TYPE_BYTE_OFF;
  state.workRam[typeByteOff] = (d0 >>> 16) & 0xff;

  const a0u = a0 >>> 0;
  state.workRam[ownerOff] = (a0u >>> 24) & 0xff;
  state.workRam[ownerOff + 1] = (a0u >>> 16) & 0xff;
  state.workRam[ownerOff + 2] = (a0u >>> 8) & 0xff;
  state.workRam[ownerOff + 3] = a0u & 0xff;

  return 1;
}
