/**
 * helper-5236.ts — `FUN_00005236` replica (25 bytes, 0x005236–0x00524E).
 *
 * **Disasm 0x5236..0x524E** (25 bytes / 13 instructions + fall-through to FUN_5248):
 *
 *   00005236    move.l (0x4,SP),D0          ; D0 = long-BE @ SP+4 (first arg via JSR)
 *   0000523a    cmpi.l #0x2,D0             ; compare D0 with 2 (unsigned)
 *   00005242    subq.l 0x2,D0              ; D0 -= 2 (only if D0 >= 2)
 *   00005244    moveq  0x1,D1              ; D1 = 1
 *   00005246    asl.l  D0,D1               ; D1 = 1 << (D0 & 0x3F), 0 if shift >= 32
 *   00005248    or.l   D1,(0x00401f5e).l   ; *0x401F5E |= D1
 *   0000524e    rts
 *
 *
 *   4. ORs mask (long) in the long-BE @ workRam offset 0x1F5E (abs 0x401F5E).
 *
 * **Note M68k**:
 *   - `asl.l D0,D1`: shift count = D0 & 0x3F (mod 64). Per shift count ≥ 32
 *     si applica guard esplicito: `shift < 32 ? (1 << shift) : 0`.
 *
 * **Callers** (13 xref, of which 2 diretti + 11 computed via A2/A4):
 *   - 0x000043aa in FUN_0000428E  (UNCONDITIONAL_CALL)
 *   - 0x000043bc in FUN_0000428E  (UNCONDITIONAL_CALL)
 *   - 0x000044e4 in FUN_00004442  (COMPUTED_CALL via A2)
 *   - 0x0000457a in FUN_00004442  (COMPUTED_CALL via A2)
 *   - 0x000045b2 in FUN_00004442  (COMPUTED_CALL via A2)
 *   - 0x0000467a in FUN_00004442  (COMPUTED_CALL via A2)
 *   - 0x0000495e in FUN_00004790  (COMPUTED_CALL via A4)
 *   - 0x0000496a in FUN_00004790  (COMPUTED_CALL via A4)
 *   - 0x00004a9c in FUN_00004790  (COMPUTED_CALL via A4)
 *   - 0x00004aa8 in FUN_00004790  (COMPUTED_CALL via A4)
 *   - 0x00004b04 in FUN_00004790  (COMPUTED_CALL via A4)
 *   - 0x00004b10 in FUN_00004790  (COMPUTED_CALL via A4)
 *
 * `packages/cli/src/test-helper-5236-parity.ts`.
 */

import type { GameState } from "./state.js";

export const HELPER_5236_ADDR = 0x00005236 as const;

/** workRam offset of the long-BE of status flags @ 0x401F5E. */
export const STATUS_FLAGS_OFF = 0x1f5e as const;

/**
 * of status flags.
 *
 *
 * @returns void. Side effect: long-BE @ workRam[0x1F5E] ORed with the mask.
 */
export function helper5236(state: GameState, arg: number): void {
  const d0 = arg >>> 0; // unsigned 32 bit

  const shift = d0 < 2 ? d0 : (d0 - 2) >>> 0;

  // asl.l D0,D1 with D1=1: shift count mod 64. For shift >= 32 -> D1 = 0.
  const d1 = shift < 32 ? (1 << shift) >>> 0 : 0;
  if (d1 === 0) return; // or.l 0 = no-op

  // or.l D1,(0x00401f5e).l: OR long-BE @ workRam[0x1F5E..0x1F61]
  const r = state.workRam;
  const cur =
    (((r[STATUS_FLAGS_OFF] ?? 0) << 24) |
      ((r[STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[STATUS_FLAGS_OFF + 3] ?? 0)) >>>
    0;
  const next = (cur | d1) >>> 0;
  r[STATUS_FLAGS_OFF] = (next >>> 24) & 0xff;
  r[STATUS_FLAGS_OFF + 1] = (next >>> 16) & 0xff;
  r[STATUS_FLAGS_OFF + 2] = (next >>> 8) & 0xff;
  r[STATUS_FLAGS_OFF + 3] = next & 0xff;
}
