/**
 * sound-maybe-11ac2.ts — replica `FUN_00011AC2` (22 byte).
 *
 *
 * **Disasm 0x11AC2..0x11AD6** (22 byte):
 *
 *   00011ac2  movea.l  #0x40076e, A0    ; A0 = workRam + 0x76E (destination)
 *   00011ac8  movea.l  #0x0001d370, A1  ; A1 = ROM program + 0x1D370 (source)
 *   00011ace  moveq    0x41, D0          ; D0.w = 65 (loop counter 0..65 -> 66 iter)
 *   00011ad2  dbf      D0w, 0x11ad0      ; decrement D0.w; branch if D0.w != -1
 *   00011ad6  rts
 *
 * Total copied: 66 x 2 = 132 bytes.
 *
 * **ROM source**: `0x1D370` falls inside program ROM (0x000000..0x07FFFF).
 *
 * **Work RAM destination**: `0x40076E` -> `workRam[0x76E..0x76E + 131]`.
 * Work RAM = 0x400000..0x401FFF (8 KB); offset 0x76E + 131 = 0x7F1 < 0x2000.
 *
 * **Caller**: `FUN_00010504` @ 0x105BE (hook `soundMaybe11AC2` in
 * `mainLoopInit10504Subs`) e `FUN_00012FD0` @ 0x1303C.
 *
 * **Name "soundMaybe11AC2"**: assigned from the Ghidra context
 * `MainLoopInit10504Subs`; the name follows the project convention.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";

export const ROM_TABLE_OFFSET = 0x1d370 as const;

/** Destination work RAM byte offset (start of 132-byte region). */
export const WORK_RAM_DEST_OFFSET = 0x76e as const;

export const COPY_WORD_COUNT = 66 as const;

export const SOUND_MAYBE_11AC2_ADDR = 0x00011ac2 as const;

/**
 *
 * `rom.program[ROM_TABLE_OFFSET..]` a `state.workRam[WORK_RAM_DEST_OFFSET..]`.
 *
 *   3. Advances both pointers by 2.
 *
 * @param state  GameState with 8 KB `workRam` to write.
 * @param rom    RomImage containing the 68010 program ROM.
 */
export function soundMaybe11AC2(state: GameState, rom: RomImage): void {
  const src = rom.program;
  const dst = state.workRam;

  let srcOff = ROM_TABLE_OFFSET;
  let dstOff = WORK_RAM_DEST_OFFSET;

  for (let i = 0; i < COPY_WORD_COUNT; i++) {
    dst[dstOff] = src[srcOff] ?? 0;
    dst[dstOff + 1] = src[srcOff + 1] ?? 0;
    srcOff += 2;
    dstOff += 2;
  }
}
