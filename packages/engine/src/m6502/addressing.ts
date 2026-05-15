/**
 * addressing.ts — 13 addressing mode del MOS 6502 NMOS.
 *
 * Ogni mode espone:
 *  - `fetch`: ricava (address, pageCross?) dalla sequenza di byte post-opcode.
 *    Avanza PC. Mode `imm` e `acc` non hanno address (caller usa register).
 *  - `read`: convenience wrapper per leggere il byte all'indirizzo risolto.
 *
 * Page cross detection: rilevante per `abs,X`, `abs,Y`, `(ind),Y`. Il
 * delta cycle penalty (1) viene aggiunto solo per le READ-modify opcodes:
 *  - LDA/LDX/LDY/EOR/AND/ORA/ADC/SBC/CMP/CPX/CPY/BIT: +1 se page cross
 *  - STA/STX/STY/INC/DEC/ASL/ROL/LSR/ROR (R-M-W): cycle fisso (+0)
 *
 * Il caller (`opcodes.ts`) decide se applicare il penalty.
 *
 * Bug emulati:
 *  - **JMP indirect bug**: `JMP ($xxFF)` non incrementa l'high byte del
 *    puntatore — legge low byte da `$xxFF` e high da `$xx00`. Implementato
 *    in `cpu.ts` non qui (è un'eccezione di JMP, non un mode generico).
 *  - **Zero-page wrap**: `LDA $80,X` con X=$80 wrappa a $00, non $100.
 *    Implementato in `zpx`/`zpy`/`indx`.
 */

import type { u8, u16 } from "../wrap.js";
import { as_u8, as_u16 } from "../wrap.js";
import type { M6502RegFile } from "./regfile.js";
import type { MemBus6502 } from "./bus.js";

export interface AddrResolved {
  /** Indirizzo effettivo (16-bit). */
  addr: u16;
  /** True se l'aggiunta dell'index ha causato cross di una pagina (256B). */
  pageCross: boolean;
}

/** Legge un byte da PC e avanza PC. */
function readPC(rf: M6502RegFile, bus: MemBus6502): u8 {
  const b = bus.read8(rf.pc);
  rf.pc = as_u16((rf.pc as number) + 1);
  return b;
}

/** Legge una word LE da PC (lo, hi) e avanza PC di 2. */
function readPCWord(rf: M6502RegFile, bus: MemBus6502): u16 {
  const lo = readPC(rf, bus) as number;
  const hi = readPC(rf, bus) as number;
  return as_u16(lo | (hi << 8));
}

/** Legge una word LE da `addr` e `addr+1`, no page wrap. */
function readWord(bus: MemBus6502, addr: u16): u16 {
  const lo = bus.read8(addr) as number;
  const hi = bus.read8(as_u16((addr as number) + 1)) as number;
  return as_u16(lo | (hi << 8));
}

/** Legge una word LE con zero-page wrap (per `(ind,X)` e `(ind),Y`):
 * il puntatore deve restare in zero-page, quindi `(ptr+1) & 0xff`. */
function readWordZP(bus: MemBus6502, zp: u8): u16 {
  const lo = bus.read8(as_u16(zp as number)) as number;
  const hi = bus.read8(as_u16(((zp as number) + 1) & 0xff)) as number;
  return as_u16(lo | (hi << 8));
}

// ─── Modes ────────────────────────────────────────────────────────────────

/** Implied / Accumulator: nessun operando, nessun address. */
export function mImplied(): void {
  // nop
}

/** Immediate: byte literal a PC. Il caller usa il valore, non l'address. */
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

/** Absolute,X: abs + X. Cross se hi(abs+X) != hi(abs). */
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

/** Indirect: usato solo da JMP — fetch della target word a (abs). NB: bug
 * NMOS sul page boundary gestito in cpu.ts (caso speciale di JMP ($xxFF)). */
export function mIndirectJMP(rf: M6502RegFile, bus: MemBus6502): u16 {
  const ptr = readPCWord(rf, bus) as number;
  const lo = bus.read8(as_u16(ptr)) as number;
  // NMOS bug: high byte fetch wrap nello stesso byte alto del puntatore.
  // $xxFF → high da $xx00, NON da $(xx+1)00.
  const hiAddr = (ptr & 0xff00) | ((ptr + 1) & 0xff);
  const hi = bus.read8(as_u16(hiAddr)) as number;
  return as_u16(lo | (hi << 8));
}

/** (Indirect,X): zp wrap, target word a $(zp+X). */
export function mIndirectX(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  const zpBase = readPC(rf, bus) as number;
  const zp = as_u8((zpBase + (rf.x as number)) & 0xff);
  return { addr: readWordZP(bus, zp), pageCross: false };
}

/** (Indirect),Y: target word a $zp, then +Y; page cross possibile. */
export function mIndirectY(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  const zp = as_u8(readPC(rf, bus) as number);
  const base = readWordZP(bus, zp) as number;
  const eff = (base + (rf.y as number)) & 0xffff;
  return { addr: as_u16(eff), pageCross: (base & 0xff00) !== (eff & 0xff00) };
}

/** Relative branch: signed displacement, ritorna PC target + cross flag. */
export function mRelative(rf: M6502RegFile, bus: MemBus6502): AddrResolved {
  const off = readPC(rf, bus) as number;
  const signed = off & 0x80 ? off - 0x100 : off;
  const base = rf.pc as number; // PC già avanzato post-displacement-read
  const target = (base + signed) & 0xffff;
  return { addr: as_u16(target), pageCross: (base & 0xff00) !== (target & 0xff00) };
}

// Re-export helper utili a opcodes.ts/cpu.ts
export { readPC, readPCWord, readWord };
