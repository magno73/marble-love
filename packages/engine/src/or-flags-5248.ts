/**
 * or-flags-5248.ts — replica `FUN_00005248` (8 byte, 0x005248-0x005250).
 *
 * **Disasm 0x5248..0x5250** (8 byte):
 *
 *   00005248    or.l D1,(0x00401f5e).l   ; *0x401F5E |= D1 (long-BE)
 *   0000524e    rts
 *
 *
 * **Callers**:
 *   - `FUN_00004F38` @ 0x000050a2 (UNCONDITIONAL_CALL): D1 = 3 → OR mask 0x3
 *   - `FUN_0000520E` @ 0x00005224 (UNCONDITIONAL_CALL): D1 = 3 → OR mask 0x3
 *     (see `state-sub-520e.ts` for the full context).
 *
 * exclusively on `state.workRam`.
 */

import type { GameState } from "./state.js";

/** workRam offset of the status-flags BE long @ 0x401F5E. */
export const STATUS_FLAGS_OFF = 0x1f5e as const;

/**
 * `FUN_00005248` replica — ORs long `d1` into the BE long @ workRam[0x1F5E].
 *
 * @param state  GameState: mutates `state.workRam[0x1F5E..0x1F61]`.
 *               M68k at call time. Callers typically produce
 */
export function orFlags5248(state: GameState, d1: number): void {
  const mask = d1 >>> 0;
  if (mask === 0) return; // or.l 0 = no-op

  const r = state.workRam;
  const cur =
    (((r[STATUS_FLAGS_OFF] ?? 0) << 24) |
      ((r[STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[STATUS_FLAGS_OFF + 3] ?? 0)) >>>
    0;
  const next = (cur | mask) >>> 0;
  r[STATUS_FLAGS_OFF] = (next >>> 24) & 0xff;
  r[STATUS_FLAGS_OFF + 1] = (next >>> 16) & 0xff;
  r[STATUS_FLAGS_OFF + 2] = (next >>> 8) & 0xff;
  r[STATUS_FLAGS_OFF + 3] = next & 0xff;
}
