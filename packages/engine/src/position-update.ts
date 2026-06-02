/**
 * Pure leaf port of ROM routine `FUN_0001706C`.
 *
 * ROM @ 0x23D40 indexed by "rotation index" and "inverse rotation index".
 *
 * Likely use case: playfield scroll/movement based on trackball direction
 * (4 direction bits plus 4 cardinal conditions).
 *
 *   0x40066A  byte: bitmap of direction flags (bit 0..3)
 *   0x40066C  byte: cardinal +X flag
 *   0x40066E  byte: cardinal +Y flag
 *   0x400670  byte: cardinal -X flag
 *   0x400672  byte: cardinal -Y flag
 *   0x400674  word: speed gate for +X
 *   0x400676  word: speed gate for +Y
 *   0x400678  word: speed gate for -X
 *   0x40067A  word: speed gate for -Y
 *
 * **ROM lookup table @ 0x23D40**: signed delta words. Indices 0..7 represent
 * the 8 cardinal/diagonal directions.
 *
 * **Logic**:
 *   D3 = rotIdx; D2 = 7 - rotIdxSpecial; D1 = 7 - rotIdx; D4 = rotIdxSpecial
 *   delta_a =  rom_table[D3*2]      ; positive offset
 *   delta_b = -rom_table[D2*2]      ; negative offset
 *   delta_c = -rom_table[D1*2]      ; negative offset
 *   delta_d =  rom_table[D4*2]      ; positive offset
 *
 *   For each cardinal flag: if flag != 0 && flag < 3 && rotIdx < 4 && speed > 0,
 *   add the corresponding delta to x or y.
 *
 *   For each bitmap bit at 0x40066A: if bit && rotIdx < 4 && speed > 0, add the
 *   combined diagonal delta to both x and y.
 *
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants (workRam offsets, absolute address minus 0x400000) ─

export const POS_BITMAP_OFF = 0x66a as const;     // 0x40066A
export const POS_FLAG_PX_OFF = 0x66c as const;    // 0x40066C byte
export const POS_FLAG_PY_OFF = 0x66e as const;    // 0x40066E byte
export const POS_FLAG_NX_OFF = 0x670 as const;    // 0x400670 byte
export const POS_FLAG_NY_OFF = 0x672 as const;    // 0x400672 byte
export const POS_GATE_PX_OFF = 0x674 as const;    // 0x400674 word
export const POS_GATE_PY_OFF = 0x676 as const;    // 0x400676 word
export const POS_GATE_NX_OFF = 0x678 as const;    // 0x400678 word
export const POS_GATE_NY_OFF = 0x67a as const;    // 0x40067A word
export const POS_ROT_IDX_OFF = 0x69f as const;    // 0x40069F byte
export const POS_ROT_SPEC_OFF = 0x6a1 as const;   // 0x4006A1 byte

/** ROM lookup table @ 0x23D40. */
const ROM_DELTA_TABLE = 0x23d40 as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

function readU16Signed(state: GameState, off: number): number {
  const w = ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
  return w & 0x8000 ? w - 0x10000 : w;
}
function readU32Signed(state: GameState, addr: number): number {
  const off = addr - 0x400000;
  const v =
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>> 0;
  return v >= 0x80000000 ? v - 0x100000000 : v;
}
function writeU32(state: GameState, addr: number, value: number): void {
  const off = addr - 0x400000;
  const v = value >>> 0;
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}
function readRomWordSigned(rom: RomImage, romAddr: number): number {
  const w = ((rom.program[romAddr] ?? 0) << 8) | (rom.program[romAddr + 1] ?? 0);
  return w & 0x8000 ? w - 0x10000 : w;
}

// ─── Main function: replica FUN_1706C ────────────────────────────────────

/**
 * Runs `FUN_0001706C`, updating position with deltas from the ROM table.
 *
 * @param state    GameState
 * @param rom      RomImage used for the ROM lookup table.
 */
export function positionUpdate(
  state: GameState,
  rom: RomImage,
  posAddr: number,
): void {
  const r = state.workRam;

  // D5 = *A1.l (x), D6 = *(A1+4).l (y) — read signed 32-bit
  let d5 = readU32Signed(state, posAddr) | 0;
  let d6 = readU32Signed(state, (posAddr + 4) >>> 0) | 0;

  // Indices
  const d3 = (r[POS_ROT_IDX_OFF] ?? 0) & 0xff;
  const d2 = (7 - (r[POS_ROT_SPEC_OFF] ?? 0)) & 0xff;
  const d1 = (7 - (r[POS_ROT_IDX_OFF] ?? 0)) & 0xff;
  const d4 = (r[POS_ROT_SPEC_OFF] ?? 0) & 0xff;

  // sext.b -> sext.w (`ext.w D0w` after `move.b`).
  const d3s = d3 & 0x80 ? d3 - 0x100 : d3;
  const d2s = d2 & 0x80 ? d2 - 0x100 : d2;
  const d1s = d1 & 0x80 ? d1 - 0x100 : d1;
  const d4s = d4 & 0x80 ? d4 - 0x100 : d4;

  // ROM table lookups (sext_w then we compute neg as sext_l(-w))
  // Disasm: `move.w (0,A0,D0w*1),(-4,A6)` reads word from ROM, stored as word;
  // later sext.l before add.
  // For neg paths: `move.w (...),D0w; ext.l D0; neg.l D0` then store to A4 (word low).
  // The neg is on a long (sext-then-neg), so neg of a positive word stays negative,
  // and neg of -32768 = 32768 wraps to negative still in long? -(-32768) = 32768.
  // Long neg of a word-sign-extended value: sext_l(0x8000) = -32768 → neg = 32768 (positive).
  // Then move A4w (low word) keeps low 16 bits → 0x8000 (which sexts to -32768 again).
  // Edge case but rare.
  const localM4 = readRomWordSigned(rom, ROM_DELTA_TABLE + d3s * 2);
  const localM2 = -readRomWordSigned(rom, ROM_DELTA_TABLE + d2s * 2);
  const a4Word = -readRomWordSigned(rom, ROM_DELTA_TABLE + d1s * 2);
  const a0Word = readRomWordSigned(rom, ROM_DELTA_TABLE + d4s * 2);

  // Truncate to word (low 16 bit), then sext_l for the addition steps below
  const localM4Stored = (localM4 & 0xffff) & 0x8000 ? (localM4 & 0xffff) - 0x10000 : localM4 & 0xffff;
  const localM2Stored = (localM2 & 0xffff) & 0x8000 ? (localM2 & 0xffff) - 0x10000 : localM2 & 0xffff;
  const a4WordStored = (a4Word & 0xffff) & 0x8000 ? (a4Word & 0xffff) - 0x10000 : a4Word & 0xffff;
  const a0WordStored = (a0Word & 0xffff) & 0x8000 ? (a0Word & 0xffff) - 0x10000 : a0Word & 0xffff;

  // ─── Cardinals (4 independent ifs) ───────────────────────────────────

  // +X (D5 += localM4 if flag@66C != 0 && < 3 && d3 < 4 && gate@674 > 0 signed)
  const flagPx = r[POS_FLAG_PX_OFF] ?? 0;
  if (flagPx !== 0 && flagPx < 3 && d3s < 4 && readU16Signed(state, POS_GATE_PX_OFF) > 0) {
    d5 = (d5 + localM4Stored) | 0;
  }

  // +Y
  const flagPy = r[POS_FLAG_PY_OFF] ?? 0;
  if (flagPy !== 0 && flagPy < 3 && d2s < 4 && readU16Signed(state, POS_GATE_PY_OFF) > 0) {
    d6 = (d6 + localM2Stored) | 0;
  }

  // -X (D5 += a4Word)
  const flagNx = r[POS_FLAG_NX_OFF] ?? 0;
  if (flagNx !== 0 && flagNx < 3 && d1s < 4 && readU16Signed(state, POS_GATE_NX_OFF) > 0) {
    d5 = (d5 + a4WordStored) | 0;
  }

  // -Y (D6 += a0Word)
  const flagNy = r[POS_FLAG_NY_OFF] ?? 0;
  if (flagNy !== 0 && flagNy < 3 && d4s < 4 && readU16Signed(state, POS_GATE_NY_OFF) > 0) {
    d6 = (d6 + a0WordStored) | 0;
  }

  // ─── Bitmap @ 0x40066A: 4 bits for diagonal movements ─────────────────
  const bitmap = r[POS_BITMAP_OFF] ?? 0;

  // bit 0: D5 += localM4, D6 += localM2 (NE diagonal-ish)
  if ((bitmap & 0x01) !== 0 && d3s < 4 && d2s < 4 && readU16Signed(state, POS_GATE_PX_OFF) > 0) {
    d5 = (d5 + localM4Stored) | 0;
    d6 = (d6 + localM2Stored) | 0;
  }

  // bit 1: D6 += localM2, D5 += a4Word (NW)
  if ((bitmap & 0x02) !== 0 && d2s < 4 && d1s < 4 && readU16Signed(state, POS_GATE_PY_OFF) > 0) {
    d6 = (d6 + localM2Stored) | 0;
    d5 = (d5 + a4WordStored) | 0;
  }

  // bit 2: D5 += a4Word, D6 += a0Word (SW)
  if ((bitmap & 0x04) !== 0 && d1s < 4 && d4s < 4 && readU16Signed(state, POS_GATE_NX_OFF) > 0) {
    d5 = (d5 + a4WordStored) | 0;
    d6 = (d6 + a0WordStored) | 0;
  }

  // bit 3: D6 += a0Word, D5 += localM4 (SE)
  if ((bitmap & 0x08) !== 0 && d4s < 4 && d3s < 4 && readU16Signed(state, POS_GATE_NY_OFF) > 0) {
    d6 = (d6 + a0WordStored) | 0;
    d5 = (d5 + localM4Stored) | 0;
  }

  // Write back x and y
  writeU32(state, posAddr, d5 >>> 0);
  writeU32(state, (posAddr + 4) >>> 0, d6 >>> 0);
}
