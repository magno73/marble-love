/**
 * random-mod-13a98.ts — `FUN_00013A98` replica ("random modulo").
 *
 * Disassembly 68010 @ 0x13A98 (capstone):
 *
 *   movea.l  d2, a0               ; save D2
 *   movea.l  d3, a1               ; save D3
 *   move.l   #$FFFF0000, d3       ; D3 = mask helper
 *   move.w   ($4003A6), d0        ; D0 = seed (u16)
 *   ; loop: while D1 != 0
 *   move.w   d0, d2
 *   lsr.w    #8, d2               ; D2 = seed >> 8
 *   eor.b    d0, d2               ; D2.b ^= D0.b  (XOR high ^ low byte)
 *   bne.b    skip
 *   move.b   #$40, d2             ; if XOR == 0: anti-zero fallback
 * skip:
 *   asl.b    #2, d2               ; X = bit 6 of the byte
 *   roxl.w   #1, d0               ; D0 = (D0 << 1) | X  (LFSR step)
 *   rol.l    #1, d3               ; D3 ruota (mask helper)
 *   bne.b    loop
 *   ; end loop
 *   move.w   d0, ($4003A6)        ; save new seed
 *   move.l   $4(a7), d1           ; reload maxExclusive
 *   beq.b    done                 ; if 0: skip reduction
 *   and.w    d3, d0               ; D0 &= D3.lo  (mask = 2^N - 1)
 *   cmp.w    d0, d1               ; D1 - D0, set flags
 *   bgt.b    done                 ; branch if D1 > D0 (result < limit)
 *   sub.w    d1, d0               ; D0 -= D1
 *   bra.b    back_to_cmp
 * done:
 *   move.l   a0, d2               ; restore D2
 *   move.l   a1, d3               ; restore D3
 *   rts                           ; return D0.w
 *
 * Semantica:
 *   N = number of shift-right per portare `limit` a zero (= bit_length(limit))
 *   The LFSR advances by N steps.
 *   result = newSeed & mask
 *   Riduzione: while (result >= limit) result -= limit  ← bgt = "if D1>D0 skip"
 *
 */

import type { GameState } from "./state.js";
import { rngStepOnce } from "./rng.js";
import { as_u16, as_u32 } from "./wrap.js";

export const RANDOM_MOD_13A98_ADDR = 0x00013a98 as const;

/**
 * Replica of `FUN_00013A98`.
 *
 * Returns an integer in [0, maxExclusive).
 *
 *
 * `move.l 4(SP), D1`, but only D1.W is used for the operations).
 */
export function randomMod13A98(state: GameState, maxExclusive: number): number {
  const limit = maxExclusive & 0xffff;

  if (limit === 0) {
    state.rng.callsThisFrame = as_u32((state.rng.callsThisFrame as unknown as number) + 1);
    return (state.rng.seed as unknown as number) & 0xffff;
  }

  let seed = (state.rng.seed as unknown as number) & 0xffff;
  let d1 = limit;
  let d3 = 0xffff0000;

  while (d1 !== 0) {
    // LFSR step (rngStepOnce)
    seed = (rngStepOnce(as_u16(seed)) as unknown as number) & 0xffff;
    // rol.l #1 of d3
    d3 = (((d3 << 1) | (d3 >>> 31)) >>> 0);
    // lsr.w #1 of d1
    d1 = (d1 >>> 1) & 0xffff;
  }

  // Salva nuovo seed
  state.rng.seed = as_u32(seed);
  state.rng.callsThisFrame = as_u32((state.rng.callsThisFrame as unknown as number) + 1);

  // Maschera: D3.lo = (1 << N) - 1  (after N ROL.L #1 of 0xFFFF0000)
  const mask = d3 & 0xffff;
  let result = seed & mask;

  // Modular reduction with >= (bgt: branch if D1>D0, loop while D1<=D0).
  while (result >= limit) {
    result -= limit;
  }

  return result;
}
