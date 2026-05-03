/**
 * palette-init.ts — replica `FUN_0000565A` (46 byte).
 *
 * Init palette RAM:
 *   - Clear word a `0xB00400` (= colorRam[0x400..0x401])
 *   - Copy 8 word da ROM 0x7B18 a palette RAM @ 0xB00000..0xB00010
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const ROM_SOURCE = 0x7b18 as const;
const PAL_CLEAR_OFF = 0x400 as const;

export function paletteInit(state: GameState, rom: RomImage): void {
  // Clear word @ palette + 0x400
  state.colorRam[PAL_CLEAR_OFF] = 0;
  state.colorRam[PAL_CLEAR_OFF + 1] = 0;
  // Copy 8 words from ROM to palette RAM
  for (let i = 0; i < 8; i++) {
    const srcOff = ROM_SOURCE + i * 2;
    const dstOff = i * 2;
    state.colorRam[dstOff] = rom.program[srcOff] ?? 0;
    state.colorRam[dstOff + 1] = rom.program[srcOff + 1] ?? 0;
  }
}
