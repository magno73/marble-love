/**
 * script-slot-claim.ts — replica `FUN_00012D46` (40 byte).
 *
 *
 * **Disasm 0x12D46..0x12D6D** (40 byte):
 *
 *   move.l  D2,-(A7)                  ; save D2
 *   move.l  (0x8,A7),D2               ; D2 = arg long (script header ptr)
 *   jsr     0x12D6E.l                 ; D0 = findFirstFreeSlot_1F016()
 *   move.l  D0,D1                     ; D1 = result
 *   moveq   #-1,D0                    ; D0 = 0xFFFFFFFF
 *   cmp.l   D1,D0                     ; D1 == -1?
 *   move.l  D2,-(A7)                  ; push arg2 = script ptr
 *   clr.l   -(A7)                     ; push arg1 = 0
 *   move.l  D1,-(A7)                  ; push arg0 = slot ptr
 *   lea     (0xc,A7),A7               ; pop 12 byte
 * done:
 *   move.l  (A7)+,D2                  ; restore D2
 *   rts
 *
 *   workRam[slot+0x3A..0x3D] ← scriptPtr (long, big-endian)
 *   workRam[slot+0x1A]       ← 0x03
 *   workRam[slot+0x18]       <- 0x01    (mark slot occupied)
 *
 *   0           = slot allocated and bind completed
 *
 * **Side effects on work RAM** (success path only):
 *   slot+0x18 = 1, slot+0x1A = 3, slot+0x3A..3D = arg (BE long).
 *
 * **Known caller**: `FUN_00012FD0` @ 0x13012 with `pea $1d854; jsr $12d46`.
 *
 * The TS implementation inlines mode-0 from `FUN_00012D46`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { findFirstFreeSlot_1F016 } from "./slot-search.js";

const NOT_FOUND = 0xffffffff >>> 0;

const WORK_RAM_BASE = 0x400000;

/** Offsets in the slot record touched by FUN_12F44 mode-0. */
const SLOT_OCCUPIED_BYTE_OFF = 0x18; // (0x18, A0) byte = 1 (mark occupied)
const SLOT_STATE_BYTE_OFF = 0x1a; // (0x1A, A0) byte = 3 (state init)
const SLOT_SCRIPT_LONG_OFF = 0x3a; // (0x3A, A0) long = arg (script ptr)

/**
 * Bind the first free slot to script `argPtr`.
 *
 *                 into `slot+0x3A` as a big-endian long.
 *                 - 0          = slot allocated, with work RAM side effects.
 */
export function claimScriptSlot(
  state: GameState,
  rom: RomImage,
  argPtr: number,
): number {
  // jsr 0x12D6E: find first free slot via ROM table @ 0x1F016.
  const slotPtr = findFirstFreeSlot_1F016(state, rom) >>> 0;

  if (slotPtr === NOT_FOUND) {
    return NOT_FOUND;
  }

  // Path "found": inline del mode-0 di FUN_12F44.
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

  // No later mode-0 branch changes D0, so the success return is 0.
  return 0;
}
