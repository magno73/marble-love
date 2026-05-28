/**
 * cycle-table.ts - MOS 6502 NMOS base cycle counts plus page-cross penalties.
 *
 * References: NMOS 6502 datasheets, MAME `cpu/m6502/m6502.cpp` micro-ops, and
 * Tom Harte's 65x02 test dataset (`cycles` field).
 *
 * These are base instruction cycles. Branch taken, branch page-cross, and index
 * page-cross deltas are applied at runtime. Undocumented opcodes use cycle 0 as
 * a sentinel and `cpu.step` fails loudly if one is encountered.
 */

import type { u8 } from "../wrap.js";

/** 256-entry cycle table: base cycles per opcode byte. 0 = undocumented. */
// prettier-ignore
export const BASE_CYCLES: ReadonlyArray<number> = [
  // 0x00-0x0F
  7, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 0, 4, 6, 0,
  // 0x10-0x1F
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  // 0x20-0x2F
  6, 6, 0, 0, 3, 3, 5, 0, 4, 2, 2, 0, 4, 4, 6, 0,
  // 0x30-0x3F
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  // 0x40-0x4F
  6, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 3, 4, 6, 0,
  // 0x50-0x5F
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  // 0x60-0x6F
  6, 6, 0, 0, 0, 3, 5, 0, 4, 2, 2, 0, 5, 4, 6, 0,
  // 0x70-0x7F
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  // 0x80-0x8F
  0, 6, 0, 0, 3, 3, 3, 0, 2, 0, 2, 0, 4, 4, 4, 0,
  // 0x90-0x9F
  2, 6, 0, 0, 4, 4, 4, 0, 2, 5, 2, 0, 0, 5, 0, 0,
  // 0xA0-0xAF
  2, 6, 2, 0, 3, 3, 3, 0, 2, 2, 2, 0, 4, 4, 4, 0,
  // 0xB0-0xBF
  2, 5, 0, 0, 4, 4, 4, 0, 2, 4, 2, 0, 4, 4, 4, 0,
  // 0xC0-0xCF
  2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0,
  // 0xD0-0xDF
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  // 0xE0-0xEF
  2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0,
  // 0xF0-0xFF
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
];

/** Delta cycle penalty per branch taken (no page cross). */
export const BRANCH_TAKEN_CYCLES = 1;
/** Delta cycle penalty per branch taken + page cross. */
export const BRANCH_PAGE_CROSS_CYCLES = 2;
/** Delta cycle penalty per index-mode (abs,X / abs,Y / ind,Y) page cross. */
export const INDEX_PAGE_CROSS_CYCLES = 1;

export function baseCyclesFor(opcode: u8): number {
  return BASE_CYCLES[opcode as number] ?? 0;
}
