/**
 * slot-array-init.ts - bulk init for object slot arrays.
 *
 * Replica `FUN_00010392`; called once by the main loop (FUN_117B2) through
 * FUN_10504 at boot, before the game-state machine starts.
 *
 * Initializes six slot arrays at different addresses:
 *
 *   array  base       count  stride  bytes_per_slot_init
 *   1      0x4019F8     10    0x38   2 (offset 0x18, 0x19)
 *   2      0x401890      9    0x28   2 (offset 0x18, 0x19)
 *   3      0x401482      7    0x42   2
 *   4      0x401302      4    0x60   2
 *   5      0x4009A4      2    0x7C   2
 *   6      0x400A9C     25    0x56   12 (offset 0x18, 0x19, 0x0C..0xF, 0x10..0x13, 0x1F)
 *
 * For each slot, writes:
 *   - byte 0x18 = 0
 *   - byte 0x19 = index (0..count-1)
 *   - (array 6 only) clr.l offsets 0x10 and 0x0C, clr.b offset 0x1F
 */

import type { GameState } from "./state.js";

/** Sub-init for one slot array: clear byte 0x18, set byte 0x19 = index. */
function initSlotsBasic(
  state: GameState,
  baseAddr: number,
  count: number,
  stride: number,
): void {
  const baseOff = baseAddr - 0x400000;
  for (let i = 0; i < count; i++) {
    const slotOff = baseOff + i * stride;
    state.workRam[slotOff + 0x18] = 0;
    state.workRam[slotOff + 0x19] = i;
  }
}

/** Sub-init for array 6 (0x400A9C): basic + clr longs 0x10/0x0C + clr byte 0x1F. */
function initSlotsExtended(state: GameState): void {
  const baseOff = 0x400a9c - 0x400000;
  const COUNT = 25;
  const STRIDE = 0x56;
  for (let i = 0; i < COUNT; i++) {
    const slotOff = baseOff + i * STRIDE;
    // clr.b (0x18, A1)
    state.workRam[slotOff + 0x18] = 0;
    // clr.l (0x10, A1)
    state.workRam[slotOff + 0x10] = 0;
    state.workRam[slotOff + 0x11] = 0;
    state.workRam[slotOff + 0x12] = 0;
    state.workRam[slotOff + 0x13] = 0;
    // clr.l (0x0C, A1)
    state.workRam[slotOff + 0x0c] = 0;
    state.workRam[slotOff + 0x0d] = 0;
    state.workRam[slotOff + 0x0e] = 0;
    state.workRam[slotOff + 0x0f] = 0;
    // clr.b (0x1F, A1)
    state.workRam[slotOff + 0x1f] = 0;
    // move.b D1b, (0x19, A0) - A0 is the pre-increment value of A1.
    state.workRam[slotOff + 0x19] = i;
  }
}

/**
 * Replica `FUN_00010392` - bulk init for six slot arrays.
 *
 * Call once at boot (part of `bootInit`) to match the binary, which runs this
 * init before the first IRQ4.
 */
export function slotArrayBulkInit(state: GameState): void {
  initSlotsBasic(state, 0x4019f8, 10, 0x38);
  initSlotsBasic(state, 0x401890, 9, 0x28);
  initSlotsBasic(state, 0x401482, 7, 0x42);
  initSlotsBasic(state, 0x401302, 4, 0x60);
  initSlotsBasic(state, 0x4009a4, 2, 0x7c);
  initSlotsExtended(state);
}
