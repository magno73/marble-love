/**
 * regfile.ts - small M68010 register file plus helpers for the stack ABI
 * instructions used by the Marble Madness main-loop body:
 *   LINK, UNLK, MOVEM.L reg -> -(An), MOVEM.L (An)+ -> reg,
 *   MOVE.L/W (d16,An) <-> reg, JSR <ea>, RTS, ADDQ.L #n,SP.
 *
 * Purpose: close the "stack residue" drift in the 0x1D40..0x1E7F work RAM
 * cluster. TS ports read/write stack-frame offsets that must match the
 * prologue/epilogue emitted by GCC in the ROM body. These helpers replicate
 * Motorola 68010 architectural semantics for aligned A7, which is the real
 * Marble Madness path.
 *
 * Architecture:
 *  - `M68kRegFile`: data/address registers + PC + SR + USP/SSP. Active A7 is
 *    stored in `a[7]`; supervisor/user stack swapping is the caller's job.
 *  - `MemBus`: minimal 8/16/32-bit bus. Tom Harte tests use a Map<u32, u8>
 *    with a 24-bit address mask, matching the real m68k bus.
 *  - Helpers are pure functions over explicit state. CCR/SR is untouched
 *    because these stack ABI instructions do not write flags.
 *
 * Musashi references (MIT) `m68k_in.c` / `m68kcpu.c`:
 *  - link 16: 16 cycles (M68010 = M68000), m68k_op_link_16.
 *  - unlk:    12 cycles, m68k_op_unlk_32.
 *  - movem.l (predec):  8 + 8 x regCount, reversed mask.
 *  - movem.l (postinc): 12 + 8 x regCount, normal mask.
 *  - jsr (mem):  base 12 + EA extra (see cycle-table.ts).
 *  - rts:        16 cycles.
 *  - addq.l #n,An: 8 cycles; An destinations do not update flags.
 *
 * Final PC for LINK/MOVEM/MOVE is `start_pc + bytes_consumed`. For JSR/RTS it
 * is the target.
 */

import type { u32, u16, i16 } from "../wrap.js";
import {
  as_u32, u32_add, u32_sub, u32_and, u32_or,
  sext_16_32, as_u16, raw,
} from "../wrap.js";

// Register file.

export interface M68kRegFile {
  /** D0..D7 (8 x u32). */
  readonly d: Uint32Array;
  /** A0..A6 + active A7. A7 is swapped with USP/SSP on mode changes. */
  readonly a: Uint32Array;
  /** Program counter (32-bit; the bus masks addresses to 24 bits). */
  pc: u32;
  /** Status register (T1 S - IPM X N Z V C). Stack ABI helpers do not modify it. */
  sr: u16;
  /** User stack pointer shadow (= A7 when SR.S=0). */
  usp: u32;
  /** Supervisor stack pointer shadow (= A7 when SR.S=1). */
  ssp: u32;
}

/** Creates a zeroed register file. */
export function createRegFile(): M68kRegFile {
  return {
    d: new Uint32Array(8),
    a: new Uint32Array(8),
    pc: as_u32(0),
    sr: as_u16(0x2700), // supervisor + IPM=7, interrupt locked (default reset)
    usp: as_u32(0),
    ssp: as_u32(0),
  };
}

// ─── Memory bus interface ─────────────────────────────────────────────────

export interface MemBus {
  read8(addr: u32): import("../wrap.js").u8;
  read16(addr: u32): u16;
  read32(addr: u32): u32;
  write8(addr: u32, value: import("../wrap.js").u8): void;
  write16(addr: u32, value: u16): void;
  write32(addr: u32, value: u32): void;
}

// ─── A7 helper (push/pop) ─────────────────────────────────────────────────

/** push.l: A7 -= 4, write32(A7, value). */
function push_l(rf: M68kRegFile, bus: MemBus, value: u32): void {
  const sp = u32_sub(as_u32(rf.a[7] ?? 0), as_u32(4));
  rf.a[7] = raw(sp);
  bus.write32(sp, value);
}

/** pop.l: read32(A7), then A7 += 4 and return the value. */
function pop_l(rf: M68kRegFile, bus: MemBus): u32 {
  const sp = as_u32(rf.a[7] ?? 0);
  const v = bus.read32(sp);
  rf.a[7] = raw(u32_add(sp, as_u32(4)));
  return v;
}

// ─── LINK An,#disp ────────────────────────────────────────────────────────

/**
 * LINK An,#disp (.W): push An, An := SP, SP += sext(disp).
 *
 * Sequenza Motorola PRM:
 *   1. SP -= 4; M[SP] := An       (push An)
 *   2. An := SP
 *   3. SP += sext_16_32(disp)     (disp is usually negative for a local frame)
 *
 * If `an == 7`, the pushed An value is the original SP before decrement.
 * Musashi `m68k_op_link_16` follows the same sequence.
 * Cycles: 16. CCR: unchanged.
 */
export function link_w(
  rf: M68kRegFile,
  bus: MemBus,
  an: number,
  disp: i16,
): void {
  // Push current An, including the an=7 case where this is pre-decrement SP.
  const anVal = as_u32(rf.a[an] ?? 0);
  push_l(rf, bus, anVal);
  // An := SP, after the 4-byte decrement.
  rf.a[an] = rf.a[7] ?? 0;
  // SP += sext(disp)
  const newSp = u32_add(as_u32(rf.a[7] ?? 0), as_u32(raw(sext_16_32(as_u16(raw(disp) & 0xffff)))));
  rf.a[7] = raw(newSp);
}

// ─── UNLK An ──────────────────────────────────────────────────────────────

/**
 * UNLK An: SP := An; An := pop.l().
 *
 * Sequenza:
 *   1. SP := An
 *   2. An := M[SP]; SP += 4
 *
 * If `an == 7`, the first assignment is a no-op, then A7 is overwritten by the
 * popped value. Final SP is popped_value, not popped_value + 4.
 * Musashi `m68k_op_unlk_32`: `REG_A[7] = AY; AY = m68ki_pull_32();`.
 * Cycles: 12. CCR: unchanged.
 */
export function unlk(rf: M68kRegFile, bus: MemBus, an: number): void {
  rf.a[7] = rf.a[an] ?? 0;
  const popped = pop_l(rf, bus);
  rf.a[an] = raw(popped);
}

// ─── MOVEM.L reg→-(An) (predecrement, register-to-memory) ─────────────────

/**
 * MOVEM.L <list>,-(An): predecrement mode.
 *
 * Predecrement mask convention: the mask is reversed.
 *   bit 0  = A7 (write first, at highest address)
 *   bit 1  = A6
 *   ...
 *   bit 7  = A0
 *   bit 8  = D7
 *   bit 9  = D6
 *   ...
 *   bit 15 = D0 (write last, at lowest address)
 *
 * Algorithm:
 *   for i in 0..15:
 *     if mask & (1 << i):
 *       An -= 4
 *       reg = (i < 8) ? A[7-i] : D[15-i]
 *       M[An] := reg
 *
 * M68000 edge case: if `an` is included in the register list, the written An
 * value is the initial value before decrement. The 68010 fixed this quirk, but
 * Tom Harte's fixture is M68000-named, so this helper follows that behavior.
 * Marble's GCC output does not emit the affected `movem.l ax,-(ax)` form.
 * M68010 cycles: 8 + 8 x regCount.
 */
export function movem_l_pd(
  rf: M68kRegFile,
  bus: MemBus,
  mask: u16,
  an: number,
): void {
  const m = raw(mask);
  // Preserve initial An for the M68000 quirk above.
  const anInitial = as_u32(rf.a[an] ?? 0);
  let addr = as_u32(rf.a[an] ?? 0);
  for (let i = 0; i < 16; i++) {
    if (((m >>> i) & 1) !== 0) {
      addr = u32_sub(addr, as_u32(4));
      let regVal: u32;
      if (i < 8) {
        // Address registers, reverse order: i=0→A7, i=1→A6, ..., i=7→A0
        const aIdx = 7 - i;
        // M68000 quirk: when writing An itself, use the initial value.
        regVal = (aIdx === an) ? anInitial : as_u32(rf.a[aIdx] ?? 0);
      } else {
        // Data registers, reverse: i=8→D7, i=9→D6, ..., i=15→D0
        const dIdx = 15 - i;
        regVal = as_u32(rf.d[dIdx] ?? 0);
      }
      bus.write32(addr, regVal);
    }
  }
  rf.a[an] = raw(addr);
}

// ─── MOVEM.L (An)+→<list> (postincrement, memory-to-register) ─────────────

/**
 * MOVEM.L (An)+,<list>: post-increment mode.
 *
 * CONVENZIONE MASK (postinc mode): "normale".
 *   bit 0  = D0
 *   bit 1  = D1
 *   ...
 *   bit 7  = D7
 *   bit 8  = A0
 *   bit 9  = A1
 *   ...
 *   bit 15 = A7
 *
 * Algoritmo:
 *   for i in 0..15:
 *     if mask & (1 << i):
 *       reg := M[An]
 *       An += 4
 *
 * Edge case: if An is in the list, the register file after the instruction is
 * dominated by the pop, i.e. the last loaded value. M68010 cycles: 12 + 8 x
 * regCount.
 */
export function movem_l_postinc(
  rf: M68kRegFile,
  bus: MemBus,
  mask: u16,
  an: number,
): void {
  const m = raw(mask);
  let addr = as_u32(rf.a[an] ?? 0);
  for (let i = 0; i < 16; i++) {
    if (((m >>> i) & 1) !== 0) {
      const v = bus.read32(addr);
      if (i < 8) {
        rf.d[i] = raw(v);
      } else {
        rf.a[i - 8] = raw(v);
      }
      addr = u32_add(addr, as_u32(4));
    }
  }
  rf.a[an] = raw(addr);
}

// ─── MOVE.L/W with (d16,An) ───────────────────────────────────────────────

/** move.l (d16,An),Dn */
export function move_l_disp_to_reg(
  rf: M68kRegFile, bus: MemBus,
  disp: i16, an: number, dn: number,
): void {
  const addr = u32_add(as_u32(rf.a[an] ?? 0), as_u32(raw(sext_16_32(as_u16(raw(disp) & 0xffff)))));
  rf.d[dn] = raw(bus.read32(addr));
}

/** move.l Dn,(d16,An) */
export function move_l_reg_to_disp(
  rf: M68kRegFile, bus: MemBus,
  dn: number, disp: i16, an: number,
): void {
  const addr = u32_add(as_u32(rf.a[an] ?? 0), as_u32(raw(sext_16_32(as_u16(raw(disp) & 0xffff)))));
  bus.write32(addr, as_u32(rf.d[dn] ?? 0));
}

/** move.w (d16,An),Dn - only the low word of Dn is written. */
export function move_w_disp_to_reg(
  rf: M68kRegFile, bus: MemBus,
  disp: i16, an: number, dn: number,
): void {
  const addr = u32_add(as_u32(rf.a[an] ?? 0), as_u32(raw(sext_16_32(as_u16(raw(disp) & 0xffff)))));
  const w = bus.read16(addr);
  // MOVE.W (src=mem, dst=Dn): low word updated, high word unchanged.
  const hi = u32_and(as_u32(rf.d[dn] ?? 0), as_u32(0xffff0000));
  rf.d[dn] = raw(u32_or(hi, as_u32(raw(w) & 0xffff)));
}

/** move.w Dn,(d16,An) - writes the low word of Dn. */
export function move_w_reg_to_disp(
  rf: M68kRegFile, bus: MemBus,
  dn: number, disp: i16, an: number,
): void {
  const addr = u32_add(as_u32(rf.a[an] ?? 0), as_u32(raw(sext_16_32(as_u16(raw(disp) & 0xffff)))));
  bus.write16(addr, as_u16(raw(as_u32(rf.d[dn] ?? 0)) & 0xffff));
}

// ─── JSR / RTS / ADDQ.L #n,SP ─────────────────────────────────────────────

/**
 * JSR target: push PC (= start_pc + length_of_instruction), PC := target.
 *
 * Tom Harte validation treats the pushed PC as
 * `start_pc + 2 + ea_extension_words`. For the clean register model here,
 * PC becomes `target`; address-error fixtures are filtered elsewhere.
 *
 * `pushedPc` is explicit so the caller can account for EA extension words.
 */
export function jsr_abs(
  rf: M68kRegFile, bus: MemBus,
  pushedPc: u32, target: u32,
): void {
  push_l(rf, bus, pushedPc);
  rf.pc = target;
}

/**
 * RTS: PC := pop.l().
 * Cycles: 16. CCR: unchanged.
 */
export function rts(rf: M68kRegFile, bus: MemBus): void {
  const newPc = pop_l(rf, bus);
  rf.pc = newPc;
}

/**
 * ADDQ.L #n,An: An += n. Does not set flags (ADDQ with An destination ignores CCR).
 * For SP (An = A7), use A7 directly.
 * n in {1..8} (encoded as 0 = 8).
 * Cycles: 8.
 */
export function addq_l_sp(rf: M68kRegFile, n: number): void {
  rf.a[7] = raw(u32_add(as_u32(rf.a[7] ?? 0), as_u32(n)));
}
