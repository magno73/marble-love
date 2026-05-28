/**
 * Port of ROM routine `FUN_00025B40`.
 *
 * Called by the object initializer and the adjacent state-machine entry, this
 * helper initializes three 8-word arrays in an object struct. Two arrays are
 * loaded from ROM byte tables (`0x1D3F4` and `0x1D3FC`), sign-extended, shifted
 * left by 11 with 16-bit wrap, then written at `A1+0x74` and `A1+0x84`. The
 * third array at `A1+0x94` is cleared, and byte `A1+0xCA` is cleared once.
 *
 * Important parity points:
 *   - `asl.w` is word-wide, so the shifted result is masked to 16 bits.
 *   - Negative table bytes sign-extend before the shift.
 *   - `move.w` writes big-endian words into work RAM.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Absolute work RAM base (`0x400000` on the M68K bus). */
const WORK_RAM_BASE = 0x400000;
/** Exclusive workRam upper bound (`0x400000 + 0x2000`). */
const WORK_RAM_END = 0x402000;

export const OBJECT_ARRAY_INIT_25B40_TABLE_A_ROM = 0x0001d3f4 as const;
export const OBJECT_ARRAY_INIT_25B40_TABLE_B_ROM = 0x0001d3fc as const;

export const OBJECT_ARRAY_INIT_25B40_ADDR = 0x00025b40 as const;

export const OBJECT_ARRAY_INIT_25B40_COUNT = 8 as const;

/** Shift count for `asl.w` (11 bits). */
export const OBJECT_ARRAY_INIT_25B40_SHIFT = 11 as const;

/** Offsets for direct writes through A1. */
export const OBJECT_ARRAY_INIT_25B40_FIELDS = {
  arrayABase: 0x74,
  arrayBBase: 0x84,
  arrayZBase: 0x94,
  /** Byte clear @ +0xCA. */
  byteAtCA: 0xca,
} as const;

export const OBJECT_ARRAY_INIT_25B40_WRITTEN_RANGE = {
  /** [0x74, 0xA3] inclusive: 48 contiguous bytes (24 words). */
  contiguousLow: 0x74,
  contiguousHigh: 0xa3,
  /** Byte isolato. */
  isolatedByte: 0xca,
} as const;

// ─── Internal helpers ────────────────────────────────────────────────────

function readRomByte(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a >= rom.program.length) return 0;
  return (rom.program[a] ?? 0) & 0xff;
}

/** Sign-extend a byte to a word, returned as an unsigned 16-bit representation. */
function sextByteToWord(b: number): number {
  const v = b & 0xff;
  return v >= 0x80 ? (v - 0x100) & 0xffff : v;
}

function writeU16BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value & 0xffff;
  workRam[off] = (v >>> 8) & 0xff;
  workRam[off + 1] = v & 0xff;
}

function writeU8(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return;
  workRam[a - WORK_RAM_BASE] = value & 0xff;
}

/** Runs `FUN_00025B40` for one object pointer in work RAM. */
export function objectArrayInit25B40(
  state: GameState,
  rom: RomImage,
  objPtr: number,
): void {
  const wr = state.workRam;
  const objAbs = objPtr >>> 0;

  // 0x25B48: A1[+0xCA].b = 0
  writeU8(wr, objAbs + 0xca, 0);

  // 0x25B4C..0x25BA6: loop i in 0..7
  for (let i = 0; i < OBJECT_ARRAY_INIT_25B40_COUNT; i++) {
    // tableA[i]: byte -> sext_w -> << 11 (16-bit wrap)
    const ba = readRomByte(rom, OBJECT_ARRAY_INIT_25B40_TABLE_A_ROM + i);
    const va = (sextByteToWord(ba) << OBJECT_ARRAY_INIT_25B40_SHIFT) & 0xffff;

    // tableB[i]: byte -> sext_w -> << 11 (16-bit wrap)
    const bb = readRomByte(rom, OBJECT_ARRAY_INIT_25B40_TABLE_B_ROM + i);
    const vb = (sextByteToWord(bb) << OBJECT_ARRAY_INIT_25B40_SHIFT) & 0xffff;

    // A1[+0x74 + i*2].w = va
    writeU16BE(wr, objAbs + OBJECT_ARRAY_INIT_25B40_FIELDS.arrayABase + i * 2, va);
    // A1[+0x84 + i*2].w = vb
    writeU16BE(wr, objAbs + OBJECT_ARRAY_INIT_25B40_FIELDS.arrayBBase + i * 2, vb);
    // A1[+0x94 + i*2].w = 0
    writeU16BE(wr, objAbs + OBJECT_ARRAY_INIT_25B40_FIELDS.arrayZBase + i * 2, 0);
  }
}
