/**
 * rng.ts — replica of the PRNG of Marble Madness.
 *
 * **Identified in Phase 2 (Ghidra)** — see `docs/static-overview.md`:
 *   - State: u16 at `0x004003A6` in Work RAM
 *   - Algorithm: **16-bit Galois LFSR with custom feedback**
 *
 * Algorithm derived from the 68010 disassembly:
 *
 *   ```asm
 *   move.w (0x4003A6), D0       ; state
 *   move.l #-0x10000, D3         ; mask helper = 0xFFFF0000
 *   loop_step:
 *     move.w D0, D2
 *     lsr.w  #8, D2              ; D2 = state >> 8
 *     eor.b  D0, D2              ; D2.b = (state.h) XOR (state.l)
 *     bne    skip
 *     move.b #0x40, D2           ; if XOR==0: D2 = 0x40 (anti-zero attractor)
 *   skip:
 *     asl.b  #2, D2              ; X flag = bit 6 of D2.b (XOR result)
 *     roxl.w #1, D0              ; new state = (D0<<1) | X; X = old bit 15
 *     rol.l  #1, D3              ; mask helper rotates
 *     lsr.w  #1, D1              ; D1 = limit, halve until 0
 *     bne    loop_step
 *   move.w D0, (0x4003A6)        ; save back
 *   ; range-limit: D0 = D0 & D3.lo; while D0 > limit: D0 -= limit
 *   ```
 *
 *   - N = number of right shifts needed to bring `limit` to 0
 *   - Advances state by N LFSR steps
 *   - Returns `state mod limit` (range-limited)
 *
 */

import { type RngState } from "./state.js";
import { as_u16, as_u32, u16_and, u16_or, u16_shl, u16_shr, u16_xor } from "./wrap.js";
import type { u16 } from "./wrap.js";

const FEEDBACK_FALLBACK = 0x40 as const; // if (high ^ low) == 0

/**
 * Advances the RNG state by a single LFSR step.
 *
 * New state = (state << 1) | feedback_bit, where:
 *   feedback_byte = (state.high ^ state.low) ?: 0x40
 */
export function rngStepOnce(state: u16): u16 {
  const s = state as unknown as number;
  const xor_byte = ((s >>> 8) ^ (s & 0xff)) & 0xff;
  const fb = xor_byte === 0 ? FEEDBACK_FALLBACK : xor_byte;
  // asl.b #2 produces X = bit 6 of feedback (last shifted-out bit)
  const fb_bit = (fb >>> 6) & 1;
  // roxl.w #1: D0 << 1 | X; old bit 15 → new X (we discard it)
  return as_u16(((s << 1) | fb_bit) & 0xffff);
}

/**
 * Advances state by N steps (number of right shifts to bring `limit` to 0).
 */
export function rngAdvanceForLimit(state: u16, limit: u16): u16 {
  let s = state as unknown as number;
  let l = limit as unknown as number;
  while (l !== 0) {
    s = (rngStepOnce(as_u16(s)) as unknown as number);
    l = l >>> 1;
  }
  return as_u16(s);
}

/**
 */
function maskHelperAfter(n: number): u16 {
  // D3 starts 0xFFFF0000, after N ROL.L #1: high bits rotate
  const k = n & 31;
  const v = ((0xffff0000 << k) | (0xffff0000 >>> (32 - k))) >>> 0;
  return as_u16(v & 0xffff);
}

/**
 *
 * Mimics `FUN_00013A98`:
 *   1. Advances state by N=bit_length(limit) steps
 *   3. result = state & mask
 *   4. while result >= limit: result -= limit
 *
 * result <= limit: sub`. For result == limit: result -= limit → 0 (correct
 */
export function rngNext(rstate: RngState, limit: u16): u16 {
  const limit_n = limit as unknown as number;
  if (limit_n === 0) {
    rstate.callsThisFrame = as_u32(
      (rstate.callsThisFrame as unknown as number) + 1
    );
    return as_u16(rstate.seed as unknown as number);
  }

  // Count number of LFSR steps needed (bit length of limit)
  let n = 0;
  let l = limit_n;
  while (l !== 0) {
    n += 1;
    l = l >>> 1;
  }

  const seed_old = rstate.seed as unknown as number;
  const seed_new = rngAdvanceForLimit(as_u16(seed_old), limit);
  rstate.seed = as_u32(seed_new as unknown as number);

  // Range-limit
  // returned limit instead of 0). See disasm @ 0x13AD0.
  const mask = maskHelperAfter(n);
  let r = (seed_new as unknown as number) & (mask as unknown as number);
  while (r >= limit_n) {
    r -= limit_n;
  }

  rstate.callsThisFrame = as_u32(
    (rstate.callsThisFrame as unknown as number) + 1
  );
  return as_u16(r);
}

/**
  */
export function rngInit(initialSeed: u16 = as_u16(0)): RngState {
  return {
    seed: as_u32(initialSeed as unknown as number),
    callsThisFrame: as_u32(0),
  };
}

export function rngClearFrameCounter(state: RngState): void {
  state.callsThisFrame = as_u32(0);
}

void u16_and; void u16_or; void u16_shl; void u16_shr; void u16_xor;
