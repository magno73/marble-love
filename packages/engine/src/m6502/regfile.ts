/**
 * regfile.ts — Register file MOS 6502 NMOS.
 *
 * Scope: emulazione bit-perfect del sound CPU di Atari System 1 (Marble
 * Madness). NON modella il 65C02 (no BBR/BBS/SMB/RMB/WAI/STP), NON modella
 * gli undocumented opcode dell'NMOS (KIL/SLO/RLA/...). Se il sound ROM
 * `136033.421/.422` ne usa, `cpu.step` lancia errore (fail loud, CLAUDE Rule
 * 12). Mode decimale BCD: implementato per completezza Tom Harte; il sound
 * ROM Marble non lo usa.
 *
 * Pattern mirror di `m68k/regfile.ts`: tipi branded da `wrap.ts`, factory
 * `createRegFile`, helper come funzioni pure che mutano stato.
 *
 * Status flag P (NV-BDIZC):
 *  - bit 7 N  : negative   (bit 7 dell'ultimo result ALU)
 *  - bit 6 V  : overflow   (signed overflow ADC/SBC)
 *  - bit 5 -  : sempre 1 quando pushato (hardware quirk)
 *  - bit 4 B  : break      (set quando pushato da BRK/PHP; clear da IRQ/NMI)
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
export const FLAG_U = 0x20 as const; // unused, sempre 1 in hardware
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
  /** Stack pointer (8-bit; stack vive su page 1: `0x0100 + sp`). */
  sp: u8;
  /** Processor status (NV-BDIZC). */
  p: u8;
  /** Program counter (16-bit). */
  pc: u16;
}

/** Crea un regfile in stato post-RESET pre-vector-fetch.
 *
 * Lo stato reale post-RESET in MOS 6502: A/X/Y indefiniti, SP=0xFD (dopo 3
 * decrement che NON scrivono memoria, sequence del reset interrupt), P con
 * I=1 e U=1, PC letto dal vector $FFFC/$FFFD. Il caller di `cpu.reset()`
 * popola PC dal vector. */
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

/** Set bit di `p` se `cond`, clear altrimenti. Ritorna nuovo P. */
export function setFlag(p: u8, flag: number, cond: boolean): u8 {
  return as_u8(cond ? ((p as number) | flag) : ((p as number) & ~flag));
}

/** Ritorna true se `flag` è set in `p`. */
export function hasFlag(p: u8, flag: number): boolean {
  return ((p as number) & flag) !== 0;
}

/** Aggiorna Z e N in base al valore 8-bit. Ritorna nuovo P. */
export function updateNZ(p: u8, value: u8): u8 {
  const v = value as number;
  let np = (p as number) & ~(FLAG_Z | FLAG_N);
  if (v === 0) np |= FLAG_Z;
  if ((v & 0x80) !== 0) np |= FLAG_N;
  return as_u8(np);
}
