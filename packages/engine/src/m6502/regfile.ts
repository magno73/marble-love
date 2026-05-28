/**
 * regfile.ts - MOS 6502 NMOS register file.
 *
 * Scope: bit-accurate emulation of the Atari System 1 sound CPU path used by
 * Marble Madness. This does not model 65C02 instructions or NMOS undocumented
 * opcodes; if the sound ROM reaches one, `cpu.step` throws. Decimal BCD mode is
 * implemented for Tom Harte coverage even though the Marble sound ROM does not
 * use it.
 *
 * Pattern mirrors `m68k/regfile.ts`: branded types from `wrap.ts`, a factory,
 * and pure helper functions that mutate explicit state.
 *
 * Status flag P (NV-BDIZC):
 *  - bit 7 N  : negative   (bit 7 of the last ALU result)
 *  - bit 6 V  : overflow   (signed overflow ADC/SBC)
 *  - bit 5 -  : always 1 when pushed (hardware quirk)
 *  - bit 4 B  : break      (set when pushed by BRK/PHP; clear for IRQ/NMI)
 *  - bit 3 D  : decimal
 *  - bit 2 I  : irq disable
 *  - bit 1 Z  : zero
 *  - bit 0 C  : carry
 */

import type { u8, u16 } from "../wrap.js";
import { as_u8, as_u16 } from "../wrap.js";

// ─── Status flag bits ─────────────────────────────────────────────────────

export const FLAG_C = 0x01 as const;
export const FLAG_Z = 0x02 as const;
export const FLAG_I = 0x04 as const;
export const FLAG_D = 0x08 as const;
export const FLAG_B = 0x10 as const;
export const FLAG_U = 0x20 as const; // unused, always 1 in hardware
export const FLAG_V = 0x40 as const;
export const FLAG_N = 0x80 as const;

// ─── Register file ────────────────────────────────────────────────────────

export interface M6502RegFile {
  /** Accumulator (8-bit). */
  a: u8;
  /** Index register X (8-bit). */
  x: u8;
  /** Index register Y (8-bit). */
  y: u8;
  /** Stack pointer (8-bit; stack lives on page 1: `0x0100 + sp`). */
  sp: u8;
  /** Processor status (NV-BDIZC). */
  p: u8;
  /** Program counter (16-bit). */
  pc: u16;
}

/** Creates a register file in post-RESET, pre-vector-fetch state.
 *
 * Real MOS 6502 reset leaves A/X/Y undefined, SP=0xFD after three non-writing
 * stack decrements, P with I=1 and U=1, and PC fetched from $FFFC/$FFFD. The
 * caller of `cpu.reset()` fills PC from that vector. */
export function createRegFile(): M6502RegFile {
  return {
    a: as_u8(0),
    x: as_u8(0),
    y: as_u8(0),
    sp: as_u8(0xfd),
    p: as_u8(FLAG_I | FLAG_U),
    pc: as_u16(0),
  };
}

// ─── Status flag helpers ──────────────────────────────────────────────────

/** Sets `flag` in `p` when `cond` is true, clears it otherwise. */
export function setFlag(p: u8, flag: number, cond: boolean): u8 {
  return as_u8(cond ? ((p as number) | flag) : ((p as number) & ~flag));
}

/** Returns true when `flag` is set in `p`. */
export function hasFlag(p: u8, flag: number): boolean {
  return ((p as number) & flag) !== 0;
}

/** Updates Z and N based on an 8-bit value. */
export function updateNZ(p: u8, value: u8): u8 {
  const v = value as number;
  let np = (p as number) & ~(FLAG_Z | FLAG_N);
  if (v === 0) np |= FLAG_Z;
  if ((v & 0x80) !== 0) np |= FLAG_N;
  return as_u8(np);
}
