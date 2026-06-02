/**
 * helper-2548.ts — `FUN_00002548` replica (10 bytes, 0x002548-0x002558).
 *
 * **Disasm 0x2548..0x2558** (10 byte, leaf, 11 callers):
 *
 *   00002548    lsr    (0x00400006).l   ; word @ 0x400006 >>= 1; carry = old bit 0
 *   0000254e    bcc.w  0x00002556       ; branch if carry clear → return 0
 *   00002552    moveq  0x1,D0           ; carry set → D0 = 1
 *   00002554    rts
 *   00002556    clr.l  D0              ; carry clear → D0 = 0
 *   00002558    rts
 *
 * **Semantics**: extracts bit 0 of the word at `0x400006` (workRam offset `0x0006`),
 *
 *   ```
 *   jsr   0x00002548.l
 *   tst.l D0
 *   beq   <loop back>
 *   ```
 *
 * **Callers** (11):
 *   - 0x0010c6, 0x0011bc, 0x0012fc, 0x00156c, 0x00165e, 0x00166e,
 *     0x0019c4, 0x001e12, 0x001e22, 0x002314, and others
 *
 * exclusively on `state.workRam[0x0006..0x0007]`.
 */

import type { GameState } from "./state.js";

/** workRam base address of the LSR flag word @ 0x400006. */
export const HELPER_2548_ADDR = 0x00002548 as const;

/** workRam offset of the LSR flag word (0x400006 - 0x400000). */
export const LSR_FLAG_OFF = 0x0006 as const;

/**
 *
 *
 * @param state  GameState: mutates `state.workRam[0x0006..0x0007]`.
 *               Matches the 68010 state at RTS time.
 */
export function helper2548(state: GameState): number {
  const r = state.workRam;

  const hi = r[LSR_FLAG_OFF] ?? 0;
  const lo = r[LSR_FLAG_OFF + 1] ?? 0;
  const word = ((hi << 8) | lo) & 0xffff;

  const carry = word & 1;
  const shifted = (word >>> 1) & 0xffff;

  // Rewrite word BE
  r[LSR_FLAG_OFF] = (shifted >>> 8) & 0xff;
  r[LSR_FLAG_OFF + 1] = shifted & 0xff;

  return carry !== 0 ? 1 : 0;
}

export { helper2548 as FUN_00002548 };
