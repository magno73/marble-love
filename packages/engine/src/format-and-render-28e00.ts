/**
 * Bit-perfect port of `FUN_00028E00`.
 *
 * This wrapper formats a long as a hex string and renders it through the
 * alpha-tilemap string path:
 *
 * 1. `formatHex(value, bufEnd, numDigits, showSpaces)`.
 *    `numDigits` is the sign-extended low word of arg2. `showSpaces` is the
 *    low word of the caller's D2 register because the original `FUN_3A08`
 *    reads stack data that `FUN_28E00` never explicitly pushed.
 * 2. `FUN_00028FDE(arg3Word, arg4Word)`, which initializes the string-chain
 *    header at `0x400434` and renders it with attr word `0x3400`.
 *
 * **Disasm 0x28E00..0x28E3B** (60 byte):
 *
 *   00028E00  move.l   D2,-(SP)              ; save D2 (4 bytes)
 *   00028E02  move.l   (0x8,SP),D1           ; D1 = arg1Long (long, ptr value)
 *   00028E06  move.w   (0xE,SP),D0w          ; D0w = arg2.lo word (numDigits)
 *   00028E0A  move.w   (0x12,SP),D2w         ; D2w = arg3.lo word (col byte)
 *   00028E0E  ext.l    D0                    ; D0 = sext_l(numDigits)
 *   00028E10  move.l   D0,-(SP)              ; push numDigits long
 *   00028E12  move.l   (0x00400436).l,-(SP)  ; push *0x400436 (bufEnd ptr long)
 *   00028E18  move.l   D1,-(SP)              ; push arg1Long (value)
 *   00028E1A  jsr      0x0000010C.l          ; → jmp 0x3A08 = formatHex
 *   00028E20  move.w   (0x22,SP),D0w         ; D0w = arg4.lo word (tickOff byte)
 *                                              ;  = orig SP+0x16 = arg4 lo word)
 *   00028E24  ext.l    D0
 *   00028E26  move.l   D0,-(SP)              ; push sext(arg4.lo) long
 *   00028E28  move.w   D2w,D0w
 *   00028E2A  ext.l    D0
 *   00028E2C  move.l   D0,-(SP)              ; push sext(arg3.lo) long
 *   00028E2E  jsr      0x00028FDE.l          ; FUN_28FDE
 *   00028E34  lea      (0x14,SP),SP          ; cleanup 20 byte = 5 long:
 *                                              ;   3 long arg per jsr 0x10C
 *                                              ; + 2 long arg per jsr 0x28FDE
 *   00028E38  move.l   (SP)+,D2              ; restore D2
 *   00028E3A  rts
 *
 * The ROM only has a few references to this helper, but keeping it explicit
 * makes the display pipeline easier to audit.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { formatHex } from "./string-format.js";
import { renderStringEntry28FDE } from "./render-string-entry-28fde.js";
import { renderStringChain } from "./string-render.js";

export const BUFEND_PTR_OFF = 0x436 as const;
/** Work RAM offset of the struct passed to `renderStringChain`. */
export const STRUCT_BASE_OFF = 0x434 as const;
/** Hard-coded attr word passed to `renderStringChain`. */
export const ATTR_WORD = 0x3400 as const;

/**
 * Reserved extension point for parity tests.
 */
export interface FormatAndRender28E00Subs {
  // Reserved.
}

/**
 * Format a value as hex and render the resulting string chain.
 *
 * @param state Game state mutated in-place through work RAM and alpha RAM.
 * @param rom ROM tables used by `renderStringChain`.
 * @param arg1Long Long value formatted as hex.
 * @param callerD2Word Low word of the caller's D2 register, used as the
 *                     inherited `showSpaces` value for `formatHex`.
 */
export function formatAndRender28E00(
  state: GameState,
  rom: RomImage,
  arg1Long: number,
  arg2Word: number,
  arg3Word: number,
  arg4Word: number,
  callerD2Word: number = 0,
  _subs?: FormatAndRender28E00Subs,
): void {
  const r = state.workRam;

  // `sext_l(arg2Word)`: low word sign-extended to a long.
  const w2 = arg2Word & 0xffff;
  const numDigits = w2 & 0x8000 ? w2 - 0x10000 : w2;

  // Read *0x400436 as a big-endian long buffer-end pointer.
  const bufEnd =
    (((r[BUFEND_PTR_OFF] ?? 0) << 24) |
      ((r[BUFEND_PTR_OFF + 1] ?? 0) << 16) |
      ((r[BUFEND_PTR_OFF + 2] ?? 0) << 8) |
      (r[BUFEND_PTR_OFF + 3] ?? 0)) >>>
    0;

  // `formatHex` observes this as the word at its inherited `(0x16,SP)`.
  const showSpaces = callerD2Word & 0xffff;

  // Step 1: formatHex(arg1Long, bufEnd, numDigits, showSpaces).
  formatHex(state, arg1Long >>> 0, bufEnd, numDigits, showSpaces);

  // Step 2: FUN_28FDE writes workRam[0x434/0x435/0x43A] and renders.
  renderStringEntry28FDE(state, arg3Word, arg4Word, {
    renderStringChain: (structAddr, attrWord) =>
      renderStringChain(state, rom, structAddr, attrWord),
  });
}

/**
 * Re-export the symbol under the original function name for mapping audits.
 */
export { formatAndRender28E00 as FUN_00028E00 };
