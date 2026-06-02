/**
 * Dispatch table for the 151 documented MOS 6502 NMOS opcodes.
 *
 * Each entry returns runtime extra cycles. Static base cycles as from
 * `baseCyclesFor(opcode)`, so total instruction cycles are base plus extra.
 * Undocumented opcodes are deliberately `null`; `cpu.step` fails loudly if the
 * sound ROM ever reaches one. Decimal-mode ADC/SBC are modeled for Tom Harte
 * parity even though Marble Madness sound code does not use them.
 */

import type { u8, u16 } from "../wrap.js";
import { as_u8, as_u16 } from "../wrap.js";
import type { M6502RegFile } from "./regfile.js";
import {
  FLAG_C, FLAG_Z, FLAG_I, FLAG_D, FLAG_B, FLAG_U, FLAG_V, FLAG_N,
  setFlag, hasFlag, updateNZ,
} from "./regfile.js";
import type { MemBus6502 } from "./bus.js";
import {
  mImmediate, mZeroPage, mZeroPageX, mZeroPageY,
  mAbsolute, mAbsoluteX, mAbsoluteY, mIndirectJMP, mIndirectX, mIndirectY,
  mRelative, readPC,
} from "./addressing.js";
import { BRANCH_TAKEN_CYCLES, BRANCH_PAGE_CROSS_CYCLES, INDEX_PAGE_CROSS_CYCLES } from "./cycle-table.js";

export interface Opcode {
  exec(rf: M6502RegFile, bus: MemBus6502): number;
}

// ─── Stack helpers ────────────────────────────────────────────────────────

function push8(rf: M6502RegFile, bus: MemBus6502, v: u8): void {
  bus.write8(as_u16(0x0100 | (rf.sp as number)), v);
  rf.sp = as_u8(((rf.sp as number) - 1) & 0xff);
}
function pop8(rf: M6502RegFile, bus: MemBus6502): u8 {
  rf.sp = as_u8(((rf.sp as number) + 1) & 0xff);
  return bus.read8(as_u16(0x0100 | (rf.sp as number)));
}
function push16(rf: M6502RegFile, bus: MemBus6502, v: u16): void {
  push8(rf, bus, as_u8((v as number) >>> 8));
  push8(rf, bus, as_u8((v as number) & 0xff));
}
function pop16(rf: M6502RegFile, bus: MemBus6502): u16 {
  const lo = pop8(rf, bus) as number;
  const hi = pop8(rf, bus) as number;
  return as_u16(lo | (hi << 8));
}

// ALU primitives, mutating the register file.

function doLDA(rf: M6502RegFile, v: u8): void { rf.a = v; rf.p = updateNZ(rf.p, v); }
function doLDX(rf: M6502RegFile, v: u8): void { rf.x = v; rf.p = updateNZ(rf.p, v); }
function doLDY(rf: M6502RegFile, v: u8): void { rf.y = v; rf.p = updateNZ(rf.p, v); }

function doAND(rf: M6502RegFile, m: u8): void {
  rf.a = as_u8((rf.a as number) & (m as number));
  rf.p = updateNZ(rf.p, rf.a);
}
function doORA(rf: M6502RegFile, m: u8): void {
  rf.a = as_u8((rf.a as number) | (m as number));
  rf.p = updateNZ(rf.p, rf.a);
}
function doEOR(rf: M6502RegFile, m: u8): void {
  rf.a = as_u8((rf.a as number) ^ (m as number));
  rf.p = updateNZ(rf.p, rf.a);
}

function doCMP(rf: M6502RegFile, lhs: u8, m: u8): void {
  const diff = (lhs as number) - (m as number);
  rf.p = setFlag(rf.p, FLAG_C, diff >= 0);
  rf.p = updateNZ(rf.p, as_u8(diff));
}

function doADC(rf: M6502RegFile, m: u8): void {
  const a = rf.a as number;
  const v = m as number;
  const c = hasFlag(rf.p, FLAG_C) ? 1 : 0;
  if (hasFlag(rf.p, FLAG_D)) {
    // BCD mode (NMOS): intermediate N/V/Z behavior is quirky, but the decimal
    // value and carry are well-defined for these tests.
    let lo = (a & 0x0f) + (v & 0x0f) + c;
    let hi = (a >>> 4) + (v >>> 4) + (lo > 0x09 ? 1 : 0);
    if (lo > 0x09) lo = (lo + 6) & 0x0f;
    rf.p = setFlag(rf.p, FLAG_Z, ((a + v + c) & 0xff) === 0);
    rf.p = setFlag(rf.p, FLAG_N, (hi & 0x08) !== 0);
    rf.p = setFlag(rf.p, FLAG_V, (((a ^ v) & 0x80) === 0) && (((a ^ (hi << 4)) & 0x80) !== 0));
    if (hi > 0x09) hi += 6;
    rf.p = setFlag(rf.p, FLAG_C, hi > 0x0f);
    rf.a = as_u8((hi << 4) | (lo & 0x0f));
  } else {
    const sum = a + v + c;
    rf.p = setFlag(rf.p, FLAG_C, sum > 0xff);
    rf.p = setFlag(rf.p, FLAG_V, (~(a ^ v) & (a ^ sum) & 0x80) !== 0);
    rf.a = as_u8(sum);
    rf.p = updateNZ(rf.p, rf.a);
  }
}

function doSBC(rf: M6502RegFile, m: u8): void {
  const a = rf.a as number;
  const v = m as number;
  const c = hasFlag(rf.p, FLAG_C) ? 1 : 0;
  // Binary SBC is ADC with a complemented operand. This also models NMOS BCD,
  // including its known V-flag quirks.
  const sum = a + (v ^ 0xff) + c;
  if (hasFlag(rf.p, FLAG_D)) {
    let lo = (a & 0x0f) - (v & 0x0f) - (1 - c);
    let hi = (a >>> 4) - (v >>> 4);
    if (lo & 0x10) { lo -= 6; hi -= 1; }
    if (hi & 0x10) hi -= 6;
    rf.p = setFlag(rf.p, FLAG_C, sum > 0xff);
    rf.p = setFlag(rf.p, FLAG_V, ((a ^ v) & (a ^ sum) & 0x80) !== 0);
    rf.a = as_u8(((hi & 0x0f) << 4) | (lo & 0x0f));
    rf.p = updateNZ(rf.p, as_u8(sum));
  } else {
    rf.p = setFlag(rf.p, FLAG_C, sum > 0xff);
    rf.p = setFlag(rf.p, FLAG_V, ((a ^ v) & (a ^ sum) & 0x80) !== 0);
    rf.a = as_u8(sum);
    rf.p = updateNZ(rf.p, rf.a);
  }
}

function doBIT(rf: M6502RegFile, m: u8): void {
  const v = m as number;
  rf.p = setFlag(rf.p, FLAG_Z, ((rf.a as number) & v) === 0);
  rf.p = setFlag(rf.p, FLAG_N, (v & 0x80) !== 0);
  rf.p = setFlag(rf.p, FLAG_V, (v & 0x40) !== 0);
}

function doASL(rf: M6502RegFile, m: u8): u8 {
  const v = m as number;
  rf.p = setFlag(rf.p, FLAG_C, (v & 0x80) !== 0);
  const r = as_u8(v << 1);
  rf.p = updateNZ(rf.p, r);
  return r;
}
function doLSR(rf: M6502RegFile, m: u8): u8 {
  const v = m as number;
  rf.p = setFlag(rf.p, FLAG_C, (v & 0x01) !== 0);
  const r = as_u8(v >>> 1);
  rf.p = updateNZ(rf.p, r);
  return r;
}
function doROL(rf: M6502RegFile, m: u8): u8 {
  const v = m as number;
  const cIn = hasFlag(rf.p, FLAG_C) ? 1 : 0;
  rf.p = setFlag(rf.p, FLAG_C, (v & 0x80) !== 0);
  const r = as_u8((v << 1) | cIn);
  rf.p = updateNZ(rf.p, r);
  return r;
}
function doROR(rf: M6502RegFile, m: u8): u8 {
  const v = m as number;
  const cIn = hasFlag(rf.p, FLAG_C) ? 0x80 : 0;
  rf.p = setFlag(rf.p, FLAG_C, (v & 0x01) !== 0);
  const r = as_u8((v >>> 1) | cIn);
  rf.p = updateNZ(rf.p, r);
  return r;
}

function doINC(rf: M6502RegFile, m: u8): u8 {
  const r = as_u8((m as number) + 1);
  rf.p = updateNZ(rf.p, r);
  return r;
}
function doDEC(rf: M6502RegFile, m: u8): u8 {
  const r = as_u8((m as number) - 1);
  rf.p = updateNZ(rf.p, r);
  return r;
}

// ─── R-M-W helper ─────────────────────────────────────────────────────────

function rmw(rf: M6502RegFile, bus: MemBus6502, addr: u16, op: (rf: M6502RegFile, v: u8) => u8): void {
  const v = bus.read8(addr);
  bus.write8(addr, op(rf, v));
}

// ─── Branch helper ────────────────────────────────────────────────────────

function branchIf(rf: M6502RegFile, bus: MemBus6502, cond: boolean): number {
  const r = mRelative(rf, bus);
  if (!cond) return 0;
  rf.pc = r.addr;
  return r.pageCross ? BRANCH_PAGE_CROSS_CYCLES : BRANCH_TAKEN_CYCLES;
}

// ─── Interrupt helper (per BRK) ───────────────────────────────────────────

function doBRK(rf: M6502RegFile, bus: MemBus6502): void {
  // BRK is a 2-byte instruction (opcode + padding), and PC has already advanced
  // by 1 (opcode fetch in cpu.ts); advance it by 1 more to skip the
  // padding byte and push the correct return PC.
  rf.pc = as_u16(((rf.pc as number) + 1) & 0xffff);
  push16(rf, bus, rf.pc);
  push8(rf, bus, as_u8((rf.p as number) | FLAG_B | FLAG_U));
  rf.p = setFlag(rf.p, FLAG_I, true);
  const lo = bus.read8(as_u16(0xfffe)) as number;
  const hi = bus.read8(as_u16(0xffff)) as number;
  rf.pc = as_u16(lo | (hi << 8));
}

// ─── Dispatch table ───────────────────────────────────────────────────────

function build(): ReadonlyArray<Opcode | null> {
  const t: Array<Opcode | null> = new Array(256).fill(null);

  // 0x00 BRK
  t[0x00] = { exec(rf, bus) { doBRK(rf, bus); return 0; } };

  // ─── ORA ────────────────────────────────────────────────────────────────
  t[0x01] = { exec(rf, bus) { const r = mIndirectX(rf, bus); doORA(rf, bus.read8(r.addr)); return 0; } };
  t[0x05] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doORA(rf, bus.read8(r.addr)); return 0; } };
  t[0x09] = { exec(rf, bus) { doORA(rf, mImmediate(rf, bus)); return 0; } };
  t[0x0d] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doORA(rf, bus.read8(r.addr)); return 0; } };
  t[0x11] = { exec(rf, bus) { const r = mIndirectY(rf, bus); doORA(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x15] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); doORA(rf, bus.read8(r.addr)); return 0; } };
  t[0x19] = { exec(rf, bus) { const r = mAbsoluteY(rf, bus); doORA(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x1d] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); doORA(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };

  // ─── ASL ────────────────────────────────────────────────────────────────
  t[0x06] = { exec(rf, bus) { const r = mZeroPage(rf, bus); rmw(rf, bus, r.addr, doASL); return 0; } };
  t[0x0a] = { exec(rf) { rf.a = doASL(rf, rf.a); return 0; } };
  t[0x0e] = { exec(rf, bus) { const r = mAbsolute(rf, bus); rmw(rf, bus, r.addr, doASL); return 0; } };
  t[0x16] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); rmw(rf, bus, r.addr, doASL); return 0; } };
  t[0x1e] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); rmw(rf, bus, r.addr, doASL); return 0; } };

  // ─── PHP / PLP / PHA / PLA ──────────────────────────────────────────────
  t[0x08] = { exec(rf, bus) { push8(rf, bus, as_u8((rf.p as number) | FLAG_B | FLAG_U)); return 0; } };
  t[0x28] = { exec(rf, bus) { rf.p = as_u8(((pop8(rf, bus) as number) & ~FLAG_B) | FLAG_U); return 0; } };
  t[0x48] = { exec(rf, bus) { push8(rf, bus, rf.a); return 0; } };
  t[0x68] = { exec(rf, bus) { rf.a = pop8(rf, bus); rf.p = updateNZ(rf.p, rf.a); return 0; } };

  // ─── BPL / JSR / AND / BIT / ROL / ──────────────────────────────────────
  t[0x10] = { exec(rf, bus) { return branchIf(rf, bus, !hasFlag(rf.p, FLAG_N)); } };

  t[0x20] = {
    exec(rf, bus) {
      // JSR push (PC + 2 - 1) = PC of the last byte of the JSR instruction.
      // PC has already advanced by 1 here (post opcode fetch). Read the
      // target word, then push (target_addr - 1)? No: we push
      // the address byte next (= addr of the last byte of operand JSR).
      const targetLo = readPC(rf, bus) as number;
      // PC is now at the hi byte of the operand
      push16(rf, bus, rf.pc); // Push address of the high byte.
      const targetHi = bus.read8(rf.pc) as number;
      rf.pc = as_u16(targetLo | (targetHi << 8));
      return 0;
    },
  };

  t[0x21] = { exec(rf, bus) { const r = mIndirectX(rf, bus); doAND(rf, bus.read8(r.addr)); return 0; } };
  t[0x24] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doBIT(rf, bus.read8(r.addr)); return 0; } };
  t[0x25] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doAND(rf, bus.read8(r.addr)); return 0; } };
  t[0x26] = { exec(rf, bus) { const r = mZeroPage(rf, bus); rmw(rf, bus, r.addr, doROL); return 0; } };
  t[0x29] = { exec(rf, bus) { doAND(rf, mImmediate(rf, bus)); return 0; } };
  t[0x2a] = { exec(rf) { rf.a = doROL(rf, rf.a); return 0; } };
  t[0x2c] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doBIT(rf, bus.read8(r.addr)); return 0; } };
  t[0x2d] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doAND(rf, bus.read8(r.addr)); return 0; } };
  t[0x2e] = { exec(rf, bus) { const r = mAbsolute(rf, bus); rmw(rf, bus, r.addr, doROL); return 0; } };
  t[0x30] = { exec(rf, bus) { return branchIf(rf, bus, hasFlag(rf.p, FLAG_N)); } };
  t[0x31] = { exec(rf, bus) { const r = mIndirectY(rf, bus); doAND(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x35] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); doAND(rf, bus.read8(r.addr)); return 0; } };
  t[0x36] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); rmw(rf, bus, r.addr, doROL); return 0; } };
  t[0x39] = { exec(rf, bus) { const r = mAbsoluteY(rf, bus); doAND(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x3d] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); doAND(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x3e] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); rmw(rf, bus, r.addr, doROL); return 0; } };

  // ─── RTI / EOR / LSR / JMP / RTS / ADC / ROR ────────────────────────────
  t[0x40] = {
    exec(rf, bus) {
      rf.p = as_u8(((pop8(rf, bus) as number) & ~FLAG_B) | FLAG_U);
      rf.pc = pop16(rf, bus);
      return 0;
    },
  };
  t[0x41] = { exec(rf, bus) { const r = mIndirectX(rf, bus); doEOR(rf, bus.read8(r.addr)); return 0; } };
  t[0x45] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doEOR(rf, bus.read8(r.addr)); return 0; } };
  t[0x46] = { exec(rf, bus) { const r = mZeroPage(rf, bus); rmw(rf, bus, r.addr, doLSR); return 0; } };
  t[0x49] = { exec(rf, bus) { doEOR(rf, mImmediate(rf, bus)); return 0; } };
  t[0x4a] = { exec(rf) { rf.a = doLSR(rf, rf.a); return 0; } };
  t[0x4c] = { exec(rf, bus) { const r = mAbsolute(rf, bus); rf.pc = r.addr; return 0; } };
  t[0x4d] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doEOR(rf, bus.read8(r.addr)); return 0; } };
  t[0x4e] = { exec(rf, bus) { const r = mAbsolute(rf, bus); rmw(rf, bus, r.addr, doLSR); return 0; } };
  t[0x50] = { exec(rf, bus) { return branchIf(rf, bus, !hasFlag(rf.p, FLAG_V)); } };
  t[0x51] = { exec(rf, bus) { const r = mIndirectY(rf, bus); doEOR(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x55] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); doEOR(rf, bus.read8(r.addr)); return 0; } };
  t[0x56] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); rmw(rf, bus, r.addr, doLSR); return 0; } };
  t[0x59] = { exec(rf, bus) { const r = mAbsoluteY(rf, bus); doEOR(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x5d] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); doEOR(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x5e] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); rmw(rf, bus, r.addr, doLSR); return 0; } };
  t[0x60] = { exec(rf, bus) { rf.pc = as_u16(((pop16(rf, bus) as number) + 1) & 0xffff); return 0; } };
  t[0x61] = { exec(rf, bus) { const r = mIndirectX(rf, bus); doADC(rf, bus.read8(r.addr)); return 0; } };
  t[0x65] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doADC(rf, bus.read8(r.addr)); return 0; } };
  t[0x66] = { exec(rf, bus) { const r = mZeroPage(rf, bus); rmw(rf, bus, r.addr, doROR); return 0; } };
  t[0x69] = { exec(rf, bus) { doADC(rf, mImmediate(rf, bus)); return 0; } };
  t[0x6a] = { exec(rf) { rf.a = doROR(rf, rf.a); return 0; } };
  t[0x6c] = { exec(rf, bus) { rf.pc = mIndirectJMP(rf, bus); return 0; } };
  t[0x6d] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doADC(rf, bus.read8(r.addr)); return 0; } };
  t[0x6e] = { exec(rf, bus) { const r = mAbsolute(rf, bus); rmw(rf, bus, r.addr, doROR); return 0; } };
  t[0x70] = { exec(rf, bus) { return branchIf(rf, bus, hasFlag(rf.p, FLAG_V)); } };
  t[0x71] = { exec(rf, bus) { const r = mIndirectY(rf, bus); doADC(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x75] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); doADC(rf, bus.read8(r.addr)); return 0; } };
  t[0x76] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); rmw(rf, bus, r.addr, doROR); return 0; } };
  t[0x79] = { exec(rf, bus) { const r = mAbsoluteY(rf, bus); doADC(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x7d] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); doADC(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0x7e] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); rmw(rf, bus, r.addr, doROR); return 0; } };

  // ─── STA / STY / STX / DEY / TXA / BCC / TYA / TXS ──────────────────────
  t[0x81] = { exec(rf, bus) { const r = mIndirectX(rf, bus); bus.write8(r.addr, rf.a); return 0; } };
  t[0x84] = { exec(rf, bus) { const r = mZeroPage(rf, bus); bus.write8(r.addr, rf.y); return 0; } };
  t[0x85] = { exec(rf, bus) { const r = mZeroPage(rf, bus); bus.write8(r.addr, rf.a); return 0; } };
  t[0x86] = { exec(rf, bus) { const r = mZeroPage(rf, bus); bus.write8(r.addr, rf.x); return 0; } };
  t[0x88] = { exec(rf) { rf.y = as_u8(((rf.y as number) - 1) & 0xff); rf.p = updateNZ(rf.p, rf.y); return 0; } };
  t[0x8a] = { exec(rf) { rf.a = rf.x; rf.p = updateNZ(rf.p, rf.a); return 0; } };
  t[0x8c] = { exec(rf, bus) { const r = mAbsolute(rf, bus); bus.write8(r.addr, rf.y); return 0; } };
  t[0x8d] = { exec(rf, bus) { const r = mAbsolute(rf, bus); bus.write8(r.addr, rf.a); return 0; } };
  t[0x8e] = { exec(rf, bus) { const r = mAbsolute(rf, bus); bus.write8(r.addr, rf.x); return 0; } };
  t[0x90] = { exec(rf, bus) { return branchIf(rf, bus, !hasFlag(rf.p, FLAG_C)); } };
  t[0x91] = { exec(rf, bus) { const r = mIndirectY(rf, bus); bus.write8(r.addr, rf.a); return 0; } };
  t[0x94] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); bus.write8(r.addr, rf.y); return 0; } };
  t[0x95] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); bus.write8(r.addr, rf.a); return 0; } };
  t[0x96] = { exec(rf, bus) { const r = mZeroPageY(rf, bus); bus.write8(r.addr, rf.x); return 0; } };
  t[0x98] = { exec(rf) { rf.a = rf.y; rf.p = updateNZ(rf.p, rf.a); return 0; } };
  t[0x99] = { exec(rf, bus) { const r = mAbsoluteY(rf, bus); bus.write8(r.addr, rf.a); return 0; } };
  t[0x9a] = { exec(rf) { rf.sp = rf.x; return 0; } };
  t[0x9d] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); bus.write8(r.addr, rf.a); return 0; } };

  // ─── LDY / LDA / LDX / TAY / TAX / BCS / CLV / TSX ──────────────────────
  t[0xa0] = { exec(rf, bus) { doLDY(rf, mImmediate(rf, bus)); return 0; } };
  t[0xa1] = { exec(rf, bus) { const r = mIndirectX(rf, bus); doLDA(rf, bus.read8(r.addr)); return 0; } };
  t[0xa2] = { exec(rf, bus) { doLDX(rf, mImmediate(rf, bus)); return 0; } };
  t[0xa4] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doLDY(rf, bus.read8(r.addr)); return 0; } };
  t[0xa5] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doLDA(rf, bus.read8(r.addr)); return 0; } };
  t[0xa6] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doLDX(rf, bus.read8(r.addr)); return 0; } };
  t[0xa8] = { exec(rf) { rf.y = rf.a; rf.p = updateNZ(rf.p, rf.y); return 0; } };
  t[0xa9] = { exec(rf, bus) { doLDA(rf, mImmediate(rf, bus)); return 0; } };
  t[0xaa] = { exec(rf) { rf.x = rf.a; rf.p = updateNZ(rf.p, rf.x); return 0; } };
  t[0xac] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doLDY(rf, bus.read8(r.addr)); return 0; } };
  t[0xad] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doLDA(rf, bus.read8(r.addr)); return 0; } };
  t[0xae] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doLDX(rf, bus.read8(r.addr)); return 0; } };
  t[0xb0] = { exec(rf, bus) { return branchIf(rf, bus, hasFlag(rf.p, FLAG_C)); } };
  t[0xb1] = { exec(rf, bus) { const r = mIndirectY(rf, bus); doLDA(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0xb4] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); doLDY(rf, bus.read8(r.addr)); return 0; } };
  t[0xb5] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); doLDA(rf, bus.read8(r.addr)); return 0; } };
  t[0xb6] = { exec(rf, bus) { const r = mZeroPageY(rf, bus); doLDX(rf, bus.read8(r.addr)); return 0; } };
  t[0xb8] = { exec(rf) { rf.p = setFlag(rf.p, FLAG_V, false); return 0; } };
  t[0xb9] = { exec(rf, bus) { const r = mAbsoluteY(rf, bus); doLDA(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0xba] = { exec(rf) { rf.x = rf.sp; rf.p = updateNZ(rf.p, rf.x); return 0; } };
  t[0xbc] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); doLDY(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0xbd] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); doLDA(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0xbe] = { exec(rf, bus) { const r = mAbsoluteY(rf, bus); doLDX(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };

  // ─── CPY / CMP / DEC / INY / DEX / BNE / CLD / ──────────────────────────
  t[0xc0] = { exec(rf, bus) { doCMP(rf, rf.y, mImmediate(rf, bus)); return 0; } };
  t[0xc1] = { exec(rf, bus) { const r = mIndirectX(rf, bus); doCMP(rf, rf.a, bus.read8(r.addr)); return 0; } };
  t[0xc4] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doCMP(rf, rf.y, bus.read8(r.addr)); return 0; } };
  t[0xc5] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doCMP(rf, rf.a, bus.read8(r.addr)); return 0; } };
  t[0xc6] = { exec(rf, bus) { const r = mZeroPage(rf, bus); rmw(rf, bus, r.addr, doDEC); return 0; } };
  t[0xc8] = { exec(rf) { rf.y = as_u8(((rf.y as number) + 1) & 0xff); rf.p = updateNZ(rf.p, rf.y); return 0; } };
  t[0xc9] = { exec(rf, bus) { doCMP(rf, rf.a, mImmediate(rf, bus)); return 0; } };
  t[0xca] = { exec(rf) { rf.x = as_u8(((rf.x as number) - 1) & 0xff); rf.p = updateNZ(rf.p, rf.x); return 0; } };
  t[0xcc] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doCMP(rf, rf.y, bus.read8(r.addr)); return 0; } };
  t[0xcd] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doCMP(rf, rf.a, bus.read8(r.addr)); return 0; } };
  t[0xce] = { exec(rf, bus) { const r = mAbsolute(rf, bus); rmw(rf, bus, r.addr, doDEC); return 0; } };
  t[0xd0] = { exec(rf, bus) { return branchIf(rf, bus, !hasFlag(rf.p, FLAG_Z)); } };
  t[0xd1] = { exec(rf, bus) { const r = mIndirectY(rf, bus); doCMP(rf, rf.a, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0xd5] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); doCMP(rf, rf.a, bus.read8(r.addr)); return 0; } };
  t[0xd6] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); rmw(rf, bus, r.addr, doDEC); return 0; } };
  t[0xd8] = { exec(rf) { rf.p = setFlag(rf.p, FLAG_D, false); return 0; } };
  t[0xd9] = { exec(rf, bus) { const r = mAbsoluteY(rf, bus); doCMP(rf, rf.a, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0xdd] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); doCMP(rf, rf.a, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0xde] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); rmw(rf, bus, r.addr, doDEC); return 0; } };

  // ─── CPX / SBC / INC / INX / NOP / BEQ / SED ────────────────────────────
  t[0xe0] = { exec(rf, bus) { doCMP(rf, rf.x, mImmediate(rf, bus)); return 0; } };
  t[0xe1] = { exec(rf, bus) { const r = mIndirectX(rf, bus); doSBC(rf, bus.read8(r.addr)); return 0; } };
  t[0xe4] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doCMP(rf, rf.x, bus.read8(r.addr)); return 0; } };
  t[0xe5] = { exec(rf, bus) { const r = mZeroPage(rf, bus); doSBC(rf, bus.read8(r.addr)); return 0; } };
  t[0xe6] = { exec(rf, bus) { const r = mZeroPage(rf, bus); rmw(rf, bus, r.addr, doINC); return 0; } };
  t[0xe8] = { exec(rf) { rf.x = as_u8(((rf.x as number) + 1) & 0xff); rf.p = updateNZ(rf.p, rf.x); return 0; } };
  t[0xe9] = { exec(rf, bus) { doSBC(rf, mImmediate(rf, bus)); return 0; } };
  t[0xea] = { exec() { return 0; } }; // NOP
  t[0xec] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doCMP(rf, rf.x, bus.read8(r.addr)); return 0; } };
  t[0xed] = { exec(rf, bus) { const r = mAbsolute(rf, bus); doSBC(rf, bus.read8(r.addr)); return 0; } };
  t[0xee] = { exec(rf, bus) { const r = mAbsolute(rf, bus); rmw(rf, bus, r.addr, doINC); return 0; } };
  t[0xf0] = { exec(rf, bus) { return branchIf(rf, bus, hasFlag(rf.p, FLAG_Z)); } };
  t[0xf1] = { exec(rf, bus) { const r = mIndirectY(rf, bus); doSBC(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0xf5] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); doSBC(rf, bus.read8(r.addr)); return 0; } };
  t[0xf6] = { exec(rf, bus) { const r = mZeroPageX(rf, bus); rmw(rf, bus, r.addr, doINC); return 0; } };
  t[0xf8] = { exec(rf) { rf.p = setFlag(rf.p, FLAG_D, true); return 0; } };
  t[0xf9] = { exec(rf, bus) { const r = mAbsoluteY(rf, bus); doSBC(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0xfd] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); doSBC(rf, bus.read8(r.addr)); return r.pageCross ? INDEX_PAGE_CROSS_CYCLES : 0; } };
  t[0xfe] = { exec(rf, bus) { const r = mAbsoluteX(rf, bus); rmw(rf, bus, r.addr, doINC); return 0; } };

  // ─── Flag ops missing: CLC / SEC / CLI / SEI ────────────────────────────
  t[0x18] = { exec(rf) { rf.p = setFlag(rf.p, FLAG_C, false); return 0; } };
  t[0x38] = { exec(rf) { rf.p = setFlag(rf.p, FLAG_C, true); return 0; } };
  t[0x58] = { exec(rf) { rf.p = setFlag(rf.p, FLAG_I, false); return 0; } };
  t[0x78] = { exec(rf) { rf.p = setFlag(rf.p, FLAG_I, true); return 0; } };

  return t;
}

export const OPCODES: ReadonlyArray<Opcode | null> = build();
