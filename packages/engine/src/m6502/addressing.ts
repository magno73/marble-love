/**
 * addressing.ts - the 13 MOS 6502 NMOS addressing modes.
 *
 * Each mode exposes the fetch/read behavior needed by opcodes. Fetch advances
 * PC and returns the effective address plus page-cross information when
 * applicable. Immediate and accumulator modes have no effective address.
 *
 * Page-cross detection matters for `abs,X`, `abs,Y`, and `(ind),Y`. The extra
 * cycle is added only for read-style opcodes:
 *  - LDA/LDX/LDY/EOR/AND/ORA/ADC/SBC/CMP/CPX/CPY/BIT: +1 on page cross
 *  - STA/STX/STY/INC/DEC/ASL/ROL/LSR/ROR (R-M-W): fixed cycles (+0)
 *
 * The caller (`opcodes.ts`) decides whether to apply the penalty.
 *
 * Emulated hardware quirks:
 *  - **JMP indirect bug**: `JMP ($xxFF)` reads the high byte from `$xx00`.
 *    The JMP-specific exception is handled in `cpu.ts`.
 *  - **Zero-page wrap**: `LDA $80,X` with X=$80 wraps to $00, not $100.
 */

import type { u8, u16 } from "../wrap.js";
import { as_u8, as_u16 } from "../wrap.js";
import type { M6502RegFile } from "./regfile.js";
import type { MemBus6502 } from "./bus.js";

export interface AddrResolved {
  /** Effective 16-bit address. */
  addr: u16;
  /** True when index addition crossed a 256-byte page. */
  pageCross: boolean;
}

/** Reads one byte from PC and advances PC. */
function readPC(rf: M6502RegFile, bus: MemBus6502): u8 {
  const b = bus.read8(rf.pc);
  rf.pc = as_u16((rf.pc as number) + 1);
  return b;
}

/** Reads one little-endian word from PC and advances PC by 2. */
function readPCWord(rf: M6502RegFile, bus: MemBus6502): u16 {
  const lo = readPC(rf, bus) as number;
  const hi = readPC(rf, bus) as number;
  return as_u16(lo | (hi << 8));
}

/** Reads one little-endian word from `addr` and `addr+1`, with no page wrap. */
function readWord(bus: MemBus6502, addr: u16): u16 {
  const lo = bus.read8(addr) as number;
  const hi = bus.read8(as_u16((addr as number) + 1)) as number;
  return as_u16(lo | (hi << 8));
}

/** Reads a little-endian word with zero-page wrap for `(ind,X)` and `(ind),Y`.
 * The pointer stays in zero page, so the high-byte address is `(ptr+1)&0xff`. */
function readWordZP(bus: MemBus6502, zp: u8): u16 {
  const lo = bus.read8(as_u16(zp as number)) as number;
  const hi = bus.read8(as_u16(((zp as number) + 1) & 0xff)) as number;
  return as_u16(lo | (hi << 8));
}

// ─── Modes ────────────────────────────────────────────────────────────────

/** Implied / accumulator: no operand and no effective address.
 * @public */
export function mImplied(): void {
  // nop
}

/** Immediate: byte literal at PC; the caller uses the value, not an address. */
export function mImmediate(rf: M6502RegFile, bus: MemBus6502): u8 {
  return readPC(rf, bus);
}

/** Zero page: 1-byte addr in $0000-$00FF. */
export function mZeroPage(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  return { addr: as_u16(readPC(rf, bus) as number), pageCross: false };
}

/** Zero page,X: (zp + X) wrap zero-page. */
export function mZeroPageX(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  const zp = readPC(rf, bus) as number;
  return { addr: as_u16((zp + (rf.x as number)) & 0xff), pageCross: false };
}

/** Zero page,Y: (zp + Y) wrap zero-page. */
export function mZeroPageY(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  const zp = readPC(rf, bus) as number;
  return { addr: as_u16((zp + (rf.y as number)) & 0xff), pageCross: false };
}

/** Absolute: 2-byte LE address. */
export function mAbsolute(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  return { addr: readPCWord(rf, bus), pageCross: false };
}

/** Absolute,X: abs + X. Crosses if hi(abs+X) differs from hi(abs). */
export function mAbsoluteX(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  const base = readPCWord(rf, bus) as number;
  const eff = (base + (rf.x as number)) & 0xffff;
  return { addr: as_u16(eff), pageCross: (base & 0xff00) !== (eff & 0xff00) };
}

/** Absolute,Y: abs + Y. */
export function mAbsoluteY(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  const base = readPCWord(rf, bus) as number;
  const eff = (base + (rf.y as number)) & 0xffff;
  return { addr: as_u16(eff), pageCross: (base & 0xff00) !== (eff & 0xff00) };
}

/** Indirect: used only by JMP to fetch the target word at (abs). The NMOS page
 * boundary bug is handled in cpu.ts as the special JMP ($xxFF) case. */
export function mIndirectJMP(rf: M6502RegFile, bus: MemBus6502): u16 {
  const ptr = readPCWord(rf, bus) as number;
  const lo = bus.read8(as_u16(ptr)) as number;
  // NMOS bug: high-byte fetch wraps inside the pointer's high page.
  const hiAddr = (ptr & 0xff00) | ((ptr + 1) & 0xff);
  const hi = bus.read8(as_u16(hiAddr)) as number;
  return as_u16(lo | (hi << 8));
}

/** (Indirect,X): zero-page wrap, target word at $(zp+X). */
export function mIndirectX(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  const zpBase = readPC(rf, bus) as number;
  const zp = as_u8((zpBase + (rf.x as number)) & 0xff);
  return { addr: readWordZP(bus, zp), pageCross: false };
}

/** (Indirect),Y: target word at $zp, then +Y; page crossing is possible. */
export function mIndirectY(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  const zp = as_u8(readPC(rf, bus) as number);
  const base = readWordZP(bus, zp) as number;
  const eff = (base + (rf.y as number)) & 0xffff;
  return { addr: as_u16(eff), pageCross: (base & 0xff00) !== (eff & 0xff00) };
}

/** Relative branch: signed displacement, returns target PC plus cross flag. */
export function mRelative(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  const off = readPC(rf, bus) as number;
  const signed = off & 0x80 ? off - 0x100 : off;
  const base = rf.pc as number; // PC already advanced past displacement.
  const target = (base + signed) & 0xffff;
  return { addr: as_u16(target), pageCross: (base & 0xff00) !== (target & 0xff00) };
}

// Re-export helpers used by opcodes.ts/cpu.ts.
/** @public */
export { readPC, readPCWord, readWord };
