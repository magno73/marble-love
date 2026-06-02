/**
 * state-sub-525c.ts — replica `FUN_0000525C` (40 byte).
 *
 * Sub of init "buffer + status flags" parametrica su un count `D0`. Esegue
 * due fasi:
 *
 *      semplicemente il clear of the range `[A2+0x50 .. A2+0x50+D0*20-1]`.
 *
 *      bitmap long @ `0x00401F5E` (`STATUS_FLAGS_OFF`). Per `D0_arg >= 2`
 *      `4, 5, 6, ..., 4 + D0*2 - 1` = `4 .. 3 + D0*2`.
 *
 * **Disasm 0x525C..0x5283** (40 byte):
 *
 *   move.l D2,-(SP)              ; preserve D2
 *   move.l D0,D2                 ; D2 = D0_orig (saved per fase 2)
 *   moveq  #0x14,D1              ; D1 = 20
 *   mulu.w D1w,D0                ; D0 = (D0_orig & 0xFFFF) * 20  (long)
 *   subq.l #1,D0                 ; D0 = D0*20 - 1 (loop top)
 *   loop1:
 *     clr.b  (0x50,A2,D0w*1)     ; *(A2 + 0x50 + signext_w(D0w)) = 0
 *   add.l  D2,D2                 ; D2 *= 2
 *   subq.l #1,D2                 ; D2 = D2 - 1 (loop top per fase 2)
 *   moveq  #6,D0                 ; D0 = 6 (first bit-arg)
 *   loop2:
 *     move.l D0,-(SP)            ; preserve D0
 *     move.l (SP)+,D0            ; restore D0
 *   move.l (SP)+,D2              ; restore D2
 *   rts
 *
 * **FUN_0000523A (callee, 20 byte)**:
 *
 *   cmpi.l #2,D0
 *   bcs.b  skip                  ; if D0 < 2 (unsigned) skip subq
 *   subq.l #2,D0
 *   skip:
 *   moveq  #1,D1
 *   asl.l  D0,D1                 ; D1 = 1 << D0 (M68k: shift count mod 64; >=32 -> 0)
 *   or.l   D1,(0x00401F5E).l     ; *0x401F5E |= D1 (long, big-endian)
 *   rts
 *
 * **Caller convention**:
 *   - `D0` (long) = parameterized "count" (number of slots to initialize).
 *     `[A2+0x50, A2+0x50+D0*20)`. `A2` must point into workRam (0x400000+).
 *   - `D2` saved/restored by prologue/epilogue (callee-saved for ABI).
 *
 * **Side effects**:
 *   1. workRam[A2-0x400000+0x50 .. +0x50+D0*20-1] = 0
 *   2. workRam[0x1F5E..0x1F61] (long BE) |= bitmask with bits `4..3+D0*2` set
 *
 *     `A2 + 0x50 + (-1)` = `A2 + 0x4F` (D0w=0xFFFF sign-extended to long -> -1),
 *     then `dbf D0w` with D0w=0xFFFF exits immediately because decrementing would
 *     reach -1. The port still models the exact semantics for correctness.
 *   - Large `D0`: `mulu.w` uses only D0's low word. For example, `D0 = 0x10001`
 *     means low word 1 and mulu = 20. For `D0 = 0x10000`, mulu = 0. The TS port
 *     must use `(D0 & 0xFFFF) * 20`.
 *
 *   `dbf Dn, target`: Dn.w := Dn.w - 1; if Dn.w != -1 then branch.
 *
 */

import type { GameState } from "./state.js";

/** workRam offset of the u32 BE status-flags bitmap @ 0x401F5E. */
export const STATUS_FLAGS_OFF = 0x1f5e as const;

/** Offset from A2 to the start of the cleared region (phase 1). */
export const BUFFER_OFFSET_FROM_A2 = 0x50 as const;

/** Slot stride of the cleared region: each "count" clears 20 bytes. */
export const STRIDE_PER_COUNT = 0x14 as const;

/** Starting bit-arg bias for phase 2 (corresponds to `moveq #6,D0`). */
export const PHASE2_FIRST_ARG = 6 as const;

/** Absolute M68k WORK RAM base. */
const WORK_RAM_BASE = 0x400000;

/**
 * Port of `FUN_0000523A` - set bit in status flags bitmap.
 *
 * Internal helper exported for callers that want to test it in isolation.
 *
 * @param state  GameState. Mutates workRam @ 0x1F5E.
 *               `D1 = 1 << (d0 < 2 ? d0 : d0 - 2)`. For shift `>= 32`
 * @returns      void. Side effect: `*0x401F5E |= D1` (long BE).
 */
export function fun523A(state: GameState, d0: number): void {
  const d0u = d0 >>> 0;
  // cmpi.l #2,D0 + bcs.b -> branch if D0 < 2 (unsigned).
  const shift = d0u < 2 ? d0u : (d0u - 2) >>> 0;
  // M68k asl.l with shift >= 32 produces 0; bits shift out of the register.
  const d1 = shift >= 32 ? 0 : ((1 << shift) >>> 0);

  // or.l D1,(0x00401F5E).l — long big-endian.
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

/**
 * Port of `FUN_0000525C` - buffer clear + status flags OR.
 *
 * See the disassembly and semantics in the module header.
 *
 * @param state  GameState. Mutates workRam in two zones: buffer @ A2+0x50 and
 *               long @ 0x1F5E).
 * @param d0     Count (long). Typically 1..N. For `D0 == 0`, the port would
 *               execute the phase-2 loop 65536 times (see notes).
 * @param a2     Absolute M68k pointer to the cleared region. Must point into
 *               workRam (0x400000..0x401FFF).
 *
 * @returns void. Side effects (mutated workRam):
 *   1. byte clear @ `[a2+0x50 .. a2+0x50+d0*20-1]`, assuming `a2-0x400000`
 *      is a valid workRam offset.
 *   2. long-BE OR @ `0x401F5E` with bitmask `bit 4..3+d0*2`.
 *
 *   - `mulu.w D1w,D0` uses the low word: `(d0 & 0xFFFF) * 20` (no overflow word
 *   - `(0x50, A2, D0w*1)`: indexing displacement with D0w sign-extended.
 *   - `add.l D2,D2; subq.l #1,D2` su `d0`: D2 = `d0*2 - 1`.
 *     `d0*2 <= 0x10000`).
 */
export function stateSub525C(
  state: GameState,
  d0: number,
  a2: number,
): void {
  const d0u = d0 >>> 0;
  const a2u = a2 >>> 0;
  const r = state.workRam;

  // ── Phase 1: clear buffer ──────────────────────────────────────────────
  // mulu.w D1w,D0  →  (d0 & 0xFFFF) * 20
  const productLong = ((d0u & 0xffff) * STRIDE_PER_COUNT) >>> 0;
  const initialD0 = (productLong - 1) >>> 0;

  // The body uses D0w sign-extended to long as its index. If the low word is 0,
  // it runs once (body + dbf exits). If the low word is 0xFFFF (-1), it cycles
  // through the whole 16-bit range.
  //
  // The decrement reaches 0xFFFF (-1) in the low word before the check.

  // Faithful implementation: simulate the loop as M68k does.
  {
    let d0w = initialD0 & 0xffff;
    let safety = 0x20000; // safety > 65536 to avoid infinite loops on bad input.
    // The loop body uses pre-decrement D0w as index (sign-extended).
    // dbf semantics: do { body; D0w := D0w - 1 } while (D0w != -1);
    while (safety-- > 0) {
      // Index: sign-extend D0w (16-bit) to 32-bit signed.
      const idxSigned = d0w >= 0x8000 ? d0w - 0x10000 : d0w;
      const writeAddr = (a2u + BUFFER_OFFSET_FROM_A2 + idxSigned) >>> 0;
      if (writeAddr >= WORK_RAM_BASE && writeAddr < WORK_RAM_BASE + 0x2000) {
        r[writeAddr - WORK_RAM_BASE] = 0;
      }
      if (d0w === 0) {
        break;
      }
      d0w = (d0w - 1) & 0xffff;
    }
  }

  // ── Fase 2: bit OR loop ────────────────────────────────────────────────
  // add.l D2,D2 + subq.l #1,D2   →  d2 = d0*2 - 1 (long, mod 2^32)
  const d2Initial = ((d0u * 2) - 1) >>> 0;
  let d2w = d2Initial & 0xffff;
  let bitArg = 6; // moveq #6,D0
  let safety2 = 0x20000;
  while (safety2-- > 0) {
    // body: bsr 0x523A with D0 = bitArg
    fun523A(state, bitArg);
    bitArg = (bitArg + 1) >>> 0;
    if (d2w === 0) break;
    d2w = (d2w - 1) & 0xffff;
  }
}
