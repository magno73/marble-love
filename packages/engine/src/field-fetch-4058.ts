/**
 * Bit-perfect port of `FUN_00004058`.
 *
 * Looks up a byte or big-endian word inside a table of 20-byte records. The
 * table base is `*0x401FFC + 0x50`; the valid record count is read from ROM
 * byte `0x1006F` and masked to three bits.
 *
 * Return values:
 * - `0xffffffff` when `arg2 > 0x12` (offset out of range);
 * - `0xfffffffe` when `arg1 >= maxRecords` (index out of range);
 * - `0..0xffff` for the word at record offset 0x12;
 * - `0..0xff` for all other valid byte offsets.
 *
 * The original routine compares full 32-bit arguments, so sign-extended
 * negative caller values naturally fail the unsigned `D4 > arg1` test. Parity
 * is covered by `test-field-fetch-4058-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Work RAM offset of `*0x401FFC`, the long pointer to the active struct. */
const PTR_FFC_OFF = 0x1ffc;

/** Constant offset from the struct pointer to the record table base. */
const RECORD_BASE_PLUS = 0x50;

/** Record size in bytes, matching the hard-coded `arg1 * 20` sequence. */
export const RECORD_SIZE = 20 as const;

/** In-record offset of the word field. */
export const RECORD_WORD_OFF = 0x12 as const;

/** ROM address of the max-records byte (`signext(byte) & 7`). */
export const ROM_MAX_RECORDS_ADDR = 0x0001006f as const;

/** Low-bit mask applied after the ROM byte sign extension. */
const MAX_RECORDS_MASK = 0x7;

/** Absolute 68k work RAM base. */
const WORK_RAM_BASE = 0x400000;

/** Exclusive upper bound of work RAM. */
const WORK_RAM_END = 0x402000;

/** Return code "offset out of range" (`arg2 > 0x12`). Long M68k = 0xFFFFFFFF. */
export const RET_OFFSET_OOR = 0xffffffff as const;

/** Return code "index out of range" (`arg1 >= D4`). Long M68k = 0xFFFFFFFE. */
export const RET_INDEX_OOR = 0xfffffffe as const;

/**
 * Sub injection hook for the ROM byte that stores the valid-record count.
 */
export interface FieldFetch4058Subs {
  /**
   * Raw ROM byte at `0x1006F`; this module applies the 68k sign-extension and
   * `& 7` mask internally.
   */
  romMaxRecordsByte?: number;
}

/**
 * Read an absolute 68k work RAM byte; out-of-range addresses read as 0.
 */
function read8(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (state.workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

/**
 * Read big-endian long from workRam @ offset (4 byte).
 */
function readLongBE(workRam: Uint8Array, off: number): number {
  return (
    (((workRam[off] ?? 0) << 24) |
      ((workRam[off + 1] ?? 0) << 16) |
      ((workRam[off + 2] ?? 0) << 8) |
      (workRam[off + 3] ?? 0)) >>>
    0
  );
}

/**
 * Bit-perfect port of `FUN_00004058`, a record-field lookup helper.
 *
 * @param state Game state containing the work RAM pointer and record bytes.
 * @param arg1 Full 32-bit record index as seen by the 68k compare.
 * @param arg2 Full 32-bit byte offset inside the record.
 * @param romMaxRecordsByte Raw ROM byte at `0x1006F`.
 * @returns D0 as an unsigned 32-bit return value.
 */
export function fieldFetch4058(
  state: GameState,
  arg1: number,
  arg2: number,
  romMaxRecordsByte: number,
): number {
  // Full 32-bit unsigned arguments, matching the 68k long compares.
  const arg1l = arg1 >>> 0;
  const arg2l = arg2 >>> 0;

  // A0 = *0x401FFC (big-endian long pointer in work RAM).
  const ptr = readLongBE(state.workRam, PTR_FFC_OFF);
  // D5 = ptr + 0x50 (record base, long add wrap a 32-bit).
  const recordBase = (ptr + RECORD_BASE_PLUS) >>> 0;

  // D4 = sign-ext-long(byte ROM[0x1006F]) & 7. The sign extension does not
  // affect the low three bits, but the sequence matters for parity notes.
  const d4 = (romMaxRecordsByte & 0xff & MAX_RECORDS_MASK) >>> 0;

  // 0x4080..0x4088: D3 = (arg2 > 0x12) ? 1 : 0.
  // M68k: cmp.l D1,D0 with D0=0x12 -> carry if 0x12 < D1 unsigned.
  // `arg2l` is an unsigned 32-bit value.
  const d3 = arg2l > 0x12 ? 1 : 0;

  // 0x408C..0x4090: `bhi` if D4 > arg1 unsigned, entering the work path.
  const goWork = !(d3 !== 0) && d4 > arg1l;

  if (!goWork) {
    // 0x4092 fail path: tst.l D3; beq -> ret -2 else ret -1.
    if (d3 === 0) {
      return RET_INDEX_OOR;
    }
    return RET_OFFSET_OOR;
  }

  // 0x409E work path: D2 = arg1*20 + arg2 (record byte offset).
  // M68k computes this as arg1*4 plus arg1*16, with 32-bit wrapping.
  const recordOff = (((arg1l * 20) >>> 0) + arg2l) >>> 0;

  // 0x40A8..0x40AC: branch on `arg2 == 0x12`.
  // M68k: cmp.l D1,D0 with D0=0x12; bne -> single byte path.
  if (arg2l !== RECORD_WORD_OFF) {
    // 0x40C8 single-byte path: D1 = byte @ recordBase + recordOff (zero-ext).
    const addr = (recordBase + recordOff) >>> 0;
    return read8(state, addr) & 0xff;
  }

  // 0x40AE word path: read recordOff as high byte and recordOff+1 as low.
  // M68k: D0 = recordOff+1; A0 = D5+D0; D1 = byte (low).
  //       A0 = D5+recordOff; D0 = byte (high); D0 <<= 8; D1 += D0.
  const addrHi = (recordBase + recordOff) >>> 0;
  const addrLo = (recordBase + recordOff + 1) >>> 0;
  const high = read8(state, addrHi);
  const low = read8(state, addrLo);
  return (((high << 8) | low) & 0xffff) >>> 0;
}
