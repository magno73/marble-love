/**
 * state-sub-520e.ts — replica `FUN_0000520E` (64 byte, fino al `rts` @ 0x524E).
 *
 * Sub di re-init "slot record" parametrica su `A2` (base struct in workRam).
 * Eseguita 3 volte da `FUN_00004F38` (call sites @ 0x5032, 0x5078, 0x51FA) come
 * step di reset di un record di sound/voice channel. Tre fasi distinte di clear
 *
 * **Disasm 0x520E..0x524E** (66 byte / 0x42; il prompt cita "40 byte" inteso
 *
 *   0x520E:  moveq  #8,D0                 ; D0 = 0x00000008
 *   0x5210:  loop1: clr.b (0x0,A2,D0w*1)  ; *(A2 + D0w) = 0
 *   0x5214:        dbf D0w, loop1         ; clears A2+0..A2+8 (9 byte)
 *   0x5218:  moveq  #4,D0                 ; D0 = 0x00000004
 *   0x521A:  loop2: clr.b (0xE,A2,D0w*1)
 *   0x521E:        dbf D0w, loop2         ; clears A2+0xE..A2+0x12 (5 byte)
 *   0x5222:  moveq  #3,D1                 ; D1 = 3 (mask)
 *   0x5224:  bsr.b   0x5248                ; → or.l D1,(0x401F5E).l (sets bits 0,1)
 *   0x5226:  moveq  #9,D0                 ; D0 = 0x00000009
 *   0x5228:  loop3: clr.b (0x14,A2,D0w*1)
 *   0x522C:        dbf D0w, loop3         ; clears A2+0x14..A2+0x1D (10 byte)
 *   0x5230:  move.b (0x9,A2),D0b          ; D0 = 0x0000FF00 | byte_at_A2+9
 *                                          ; (D0w high byte = 0xFF da loop3
 *   0x5234:  bsr.b   0x523A                ; → fun523A(D0): set bit
 *                                          ;   shift = (D0 - 2) & 0x3F (D0 ≥ 2)
 *                                          ;   |0x401F5E |= (1 << shift) o no-op
 *   0x523A:  fun523A: cmpi.l #2,D0
 *   0x5240:           bcs.b skip
 *   0x5242:           subq.l #2,D0
 *   0x5244:  skip:    moveq  #1,D1
 *   0x5246:           asl.l  D0,D1         ; D1 = 1 << (D0 & 0x3F), 0 if >=32
 *   0x5248:           or.l   D1,(0x401F5E).l
 *   0x524E:           rts
 *
 * **Critical flow-control notes**:
 *   - `bsr.b 0x523A` @ 0x5234 pushes return address 0x5236 on the stack.
 *   - `bsr.b 0x5248` @ 0x5224 goes directly to the `or.l` subroutine.
 *
 * **Caller convention (FUN_4F38 @ stack frame established at 0x4FA2)**:
 *   - `A2` = pointer in workRam (struct base)
 *   - SP points to FUN_520E's return address. Stack layout at 0x5236:
 *     • SP[0..3]  = return address to caller (e.g. 0x5036)
 *     • SP[4..7]  = bottom of `movem.l ...,-(SP)` from FUN_4F38 = saved A3
 *     • SP[8..11] = saved A2 (original)
 *     • SP[12..23] = saved D5,D4,D3,D2
 *     • SP[24..27] = original entry return address from FUN_4F38
 *     @ 0x4FA4 with `lea (0xF00001).l, A3`.
 *   - For A3 = 0x00F00001: D0 >= 2 -> subq -> 0x00EFFFFF -> `& 0x3F` = 63.
 *
 * **Side effects (workRam)**:
 *   1. byte clear:  A2[0..8]      (9 byte, offsets 0,1,...,8)
 *   2. byte clear:  A2[0xE..0x12] (5 byte)
 *   3. long-BE OR:  *0x401F5E |= 0x00000003  (bits 0,1)
 *   4. byte clear:  A2[0x14..0x1D] (10 byte)
 *   5. long-BE OR:  *0x401F5E |= bitFromByteA2_9      (1 bit, byte∈[2,33] → bits 0..31)
 *   6. long-BE OR:  *0x401F5E |= bitFromStackD0       (1 bit derived from `(4,SP)`)
 *
 * in workRam.
 *
 * **TS modeling**:
 *   - M68k `asl.l Dn,D1` with shift count >= 32 produces 0; JS `<<` masks the
 *     shift count, so this must be modeled explicitly.
 *   - For D0 = 0xFF + byte_at_A2_9, `0xFF00` masks away high bits, leaving the
 *     low byte semantics used below.
 *
 */

import type { GameState } from "./state.js";

/** workRam offset of the u32 BE status-flags bitmap @ 0x401F5E. */
export const STATUS_FLAGS_OFF = 0x1f5e as const;

/** Absolute M68k WORK RAM base. */
const WORK_RAM_BASE = 0x400000;

/** Fixed mask OR-ed by `bsr 0x5248` with D1=3 (bits 0,1). */
export const FIXED_OR_MASK = 0x00000003 as const;

/** Default for `stackD0`: production FUN_4F38 sets A3 = 0x00F00001. */
export const PRODUCTION_STACK_D0 = 0x00f00001 as const;

/**
 * Internal helper: port of `FUN_0000523A` (cmpi.l #2 / subq / asl / or).
 *
 * Sets `*0x401F5E |= 1 << ((d0 >= 2 ? d0 - 2 : d0) & 0x3F)` when shift < 32.
 *
 * @param state  GameState. Mutates workRam @ 0x1F5E.
 */
export function fun523AInner(state: GameState, d0: number): void {
  const d0u = d0 >>> 0;
  // cmpi.l #2,D0 + bcs.b -> branch if D0 < 2 (unsigned).
  const beforeShift = d0u < 2 ? d0u : (d0u - 2) >>> 0;
  const shift = beforeShift & 0x3f;
  const d1 = shift >= 32 ? 0 : ((1 << shift) >>> 0);
  if (d1 === 0) return; // OR con 0 = no-op

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
 * Port of `FUN_0000520E` - slot record reset + status flags OR.
 *
 * See the disassembly and semantics in the module header.
 *
 * @param state    GameState mutated in two regions:
 *                 (1) workRam @ A2 (3 disjoint clear ranges);
 *                 (2) workRam @ 0x1F5E (cumulative long-BE OR).
 * @param a2       Absolute M68k pointer (long). Must point into workRam
 *                 (`0x400000..0x401FFF`). Cleared ranges:
 *                   - `[A2+0,    A2+8]`  (9 byte)
 *                   - `[A2+0xE,  A2+0x12]` (5 byte)
 *                   - `[A2+0x14, A2+0x1D]` (10 byte)
 *                 successivo OR derivato).
 *                 `lea (0xF00001).l, A3`). Default: `PRODUCTION_STACK_D0`.
 *
 * @returns void. Side effects elencati nell'header.
 */
export function stateSub520E(
  state: GameState,
  a2: number,
  stackD0: number = PRODUCTION_STACK_D0,
): void {
  const a2u = a2 >>> 0;
  const r = state.workRam;

  // ── Pre-capture byte @ A2+9 ───────────────────────────────────────────
  // Le tre fasi di clear NON toccano il byte a A2+9 (offsets clearati:
  const a2Off = (a2u - WORK_RAM_BASE) >>> 0;
  const byteAtA2Plus9Addr = a2Off + 9;
  const byteAtA2Plus9 =
    byteAtA2Plus9Addr < r.length ? (r[byteAtA2Plus9Addr] ?? 0) & 0xff : 0;

  // ── Phase 1: clear A2+0..A2+8 (9 bytes) ───────────────────────────────
  // 9 times (D0 = 8,7,...,0). Replicate as a direct loop.
  for (let i = 0; i <= 8; i++) {
    const off = a2Off + i;
    if (off < r.length) r[off] = 0;
  }

  // Phase 2: clear A2+0xE..A2+0x12 (5 bytes).
  for (let i = 0; i <= 4; i++) {
    const off = a2Off + 0xe + i;
    if (off < r.length) r[off] = 0;
  }

  // Fixed OR: bits 0,1 (mask 0x3) @ 0x401F5E.
  // bsr.b 0x5248 with D1=3 (moveq #3,D1 @ 0x5222). 0x5248 only does `or.l`.
  // Equivalent to fun523AInner with a d0 such that (1 << shift) = 3? No: the
  applyStatusFlagsOr(r, FIXED_OR_MASK);

  // Phase 3: clear A2+0x14..A2+0x1D (10 bytes).
  for (let i = 0; i <= 9; i++) {
    const off = a2Off + 0x14 + i;
    if (off < r.length) r[off] = 0;
  }

  // ── OR derivato dal byte @ A2+9 ───────────────────────────────────────
  const d0FromByte = (0xff00 | byteAtA2Plus9) >>> 0;
  fun523AInner(state, d0FromByte);

  // ── Path "dead-code reachable": (4,SP) load + fall-through in 523A ────
  // (long-BE da SP+4) e POI cade nel body di 523A di nuovo.
  // In produzione SP+4 = saved A3 = 0x00F00001 → shift = 63 → D1 = 0 → no-op.
  fun523AInner(state, stackD0 >>> 0);
}

/** Helper interno: OR cumulativo di una maschera nel long-BE @ 0x401F5E. */
function applyStatusFlagsOr(r: Uint8Array, mask: number): void {
  const m = mask >>> 0;
  if (m === 0) return;
  const cur =
    (((r[STATUS_FLAGS_OFF] ?? 0) << 24) |
      ((r[STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
      ((r[STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
      (r[STATUS_FLAGS_OFF + 3] ?? 0)) >>>
    0;
  const next = (cur | m) >>> 0;
  r[STATUS_FLAGS_OFF] = (next >>> 24) & 0xff;
  r[STATUS_FLAGS_OFF + 1] = (next >>> 16) & 0xff;
  r[STATUS_FLAGS_OFF + 2] = (next >>> 8) & 0xff;
  r[STATUS_FLAGS_OFF + 3] = next & 0xff;
}
