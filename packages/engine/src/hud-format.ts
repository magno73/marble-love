/**
 * hud-format.ts — `FUN_00003D62` (136 byte): HUD format 3 valori.
 *
 * Sequenza:
 *   formatHex(arg1.l, buf=0x40017E, 6 digits, no spaces)
 *   renderStringChain(0x74D6, attr=0x2000)
 *   formatHex(sext_l(arg2.w), buf, 4 digits, no spaces)
 *   renderStringChain(0x74FE, 0x2000)
 *   formatHex(sext_l(arg3.w), buf, 4 digits, no spaces)
 *   renderStringChain(0x751E, 0x2000)
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { formatHex } from "./string-format.js";
import { renderStringChain } from "./string-render.js";

const BUF_ADDR = 0x40017e;

export function hudFormat3Values(
  state: GameState,
  rom: RomImage,
  arg1Long: number,
  arg2Word: number,
  arg3Word: number,
): void {
  // Format arg1 long, 6 hex digits
  formatHex(state, arg1Long, BUF_ADDR, 6, 0);
  renderStringChain(state, rom, 0x74D6, 0x2000);

  // arg2 sext_l(word), 4 digits
  const arg2Sext = ((arg2Word & 0xffff) & 0x8000)
    ? (arg2Word & 0xffff) - 0x10000
    : arg2Word & 0xffff;
  formatHex(state, arg2Sext >>> 0, BUF_ADDR, 4, 0);
  renderStringChain(state, rom, 0x74FE, 0x2000);

  // arg3 sext_l(word), 4 digits
  const arg3Sext = ((arg3Word & 0xffff) & 0x8000)
    ? (arg3Word & 0xffff) - 0x10000
    : arg3Word & 0xffff;
  formatHex(state, arg3Sext >>> 0, BUF_ADDR, 4, 0);
  renderStringChain(state, rom, 0x751E, 0x2000);
}
