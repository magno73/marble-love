/**
 * string-clear.ts - ports of `FUN_00002678` (74 bytes) and `FUN_00002ABC` (148 bytes).
 *
 * Sub-functions of `FUN_2E18` (state-machine dispatcher).
 *
 * - **FUN_2678 - `removeFromSlots(dataPtr)`**: searches for `dataPtr` in the
 *   four state-machine slots (data[0..3] @ 0x401F04). For each match, clears
 *   state[D2] (@ 0x401F1C) and data[D2], then calls FUN_2ABC.
 *   Returns: D0 = 1.
 *
 * - **FUN_2ABC - `clearStringChain(dataPtr)`**: walks the linked list of string
 *   entries. For each non-null char, writes 0 to the alpha tilemap. It shares
 *   FUN_2572's rotation/stride/marker logic without char-specific rendering.
 *
 * **Bit-perfect verified** against the binary via `cli/src/test-string-clear-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const VAL_F00_OFF = 0x1f00 as const;
const ROTATION_OFF = 0x1f42 as const;
const ALPHA_BASE = 0xa03000 as const;
const ROM_STRIDE_TABLE = 0x72a0 as const;
const ROM_SHIFT_TABLE = 0x72a4 as const;

const SLOT_COUNT = 4;
const DATA_PTR_BASE_OFF = 0x1f04;
const STATE_BASE_OFF = 0x1f1c;

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}
function readU16Signed(state: GameState, off: number): number {
  const w = readU16(state, off);
  return w & 0x8000 ? w - 0x10000 : w;
}
function readU32(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>> 0
  );
}
function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a < 0x80000) return rom.program[a] ?? 0;
  if (a >= 0x400000 && a < 0x402000) return state.workRam[a - 0x400000] ?? 0;
  if (a >= 0xa02000 && a < 0xa03000) return state.spriteRam[a - 0xa02000] ?? 0;
  if (a >= 0xa03000 && a < 0xa04000) return state.alphaRam[a - 0xa03000] ?? 0;
  if (a >= 0xb00000 && a < 0xb00800) return state.colorRam[a - 0xb00000] ?? 0;
  return 0;
}
function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  return (
    ((readByteAbs(state, rom, addr) << 24) |
      (readByteAbs(state, rom, (addr + 1) >>> 0) << 16) |
      (readByteAbs(state, rom, (addr + 2) >>> 0) << 8) |
      readByteAbs(state, rom, (addr + 3) >>> 0)) >>> 0
  );
}
function readRomWordSigned(rom: RomImage, romAddr: number): number {
  const w = ((rom.program[romAddr] ?? 0) << 8) | (rom.program[romAddr + 1] ?? 0);
  return w & 0x8000 ? w - 0x10000 : w;
}
function clearAlphaWord(state: GameState, addr: number): void {
  const a = addr >>> 0;
  if (a >= 0xa03000 && a < 0xa04000) {
    const off = a - 0xa03000;
    state.alphaRam[off] = 0;
    state.alphaRam[off + 1] = 0;
  }
}

/**
 * Port of `FUN_00002ABC` - clear string chain by zeroing alpha tiles.
 */
export function clearStringChain(state: GameState, rom: RomImage, structAddr: number): void {
  let a0 = structAddr >>> 0;
  let chainSafety = 1024;

  while (chainSafety-- > 0) {
    const rotation = readU16(state, ROTATION_OFF);
    const rotSigned = rotation & 0x8000 ? rotation - 0x10000 : rotation;
    const stringPtr = readLongAbs(state, rom, (a0 + 2) >>> 0);
    let a4 = stringPtr >>> 0;

    let d2: number;
    if (rotation !== 0) {
      // d2 = 0x29 - sext_l(byte_at(A0+1))
      const tickOff = readByteAbs(state, rom, (a0 + 1) >>> 0);
      const tickOffSigned = tickOff & 0x80 ? tickOff - 0x100 : tickOff;
      d2 = (0x29 - tickOffSigned) | 0;
    } else {
      // d2 = sext_l(byte_at(A0+1)) << 6
      const tickOff = readByteAbs(state, rom, (a0 + 1) >>> 0);
      const tickOffSigned = tickOff & 0x80 ? tickOff - 0x100 : tickOff;
      d2 = (tickOffSigned << 6) | 0;
    }

    const colByte = readByteAbs(state, rom, a0);
    const colSigned = colByte & 0x80 ? colByte - 0x100 : colByte;

    const shiftIdx = rotSigned * 2 + 1;
    const shiftByte = rom.program[(ROM_SHIFT_TABLE + shiftIdx) >>> 0] ?? 0;
    const shiftCount = shiftByte & 0x80 ? shiftByte - 0x100 : shiftByte;

    let d0 = colSigned;
    if (shiftCount >= 32 || shiftCount < 0) {
      d0 = shiftCount < 0 ? d0 : 0;
    } else {
      d0 = (d0 << shiftCount) | 0;
    }
    d0 = ((d0 + d2) * 2) | 0;
    let a3 = (ALPHA_BASE + d0) >>> 0;

    let charSafety = 256;
    while (charSafety-- > 0) {
      const ch = readByteAbs(state, rom, a4);
      a4 = (a4 + 1) >>> 0;
      if (ch === 0) break;

      clearAlphaWord(state, a3);

      const stride = readRomWordSigned(rom, ROM_STRIDE_TABLE + rotSigned * 2);
      a3 = (a3 + stride * 2) >>> 0;
    }

    // Chain check
    const marker = readByteAbs(state, rom, (a0 + 6) >>> 0);
    const markerSigned = marker & 0x80 ? marker - 0x100 : marker;
    const valF00Signed = readU16Signed(state, VAL_F00_OFF);
    const sum = (markerSigned + valF00Signed) | 0;
    if (sum <= 1) return;

    a0 = readLongAbs(state, rom, (a0 + 8) >>> 0);
  }
}

/**
 * Port of `FUN_00002678` - `removeFromSlots(dataPtr)` plus clearStringChain.
 *
 * @returns Always 1.
 */
export function removeFromSlots(state: GameState, rom: RomImage, dataPtr: number): number {
  const r = state.workRam;

  // Iterate 4 slots
  for (let d2 = 0; d2 < SLOT_COUNT; d2++) {
    const slotData = readU32(state, DATA_PTR_BASE_OFF + d2 * 4);
    if (slotData === (dataPtr >>> 0)) {
      // Clear state[d2]
      r[STATE_BASE_OFF + d2] = 0;
      // Clear data[d2]
      r[DATA_PTR_BASE_OFF + d2 * 4] = 0;
      r[DATA_PTR_BASE_OFF + d2 * 4 + 1] = 0;
      r[DATA_PTR_BASE_OFF + d2 * 4 + 2] = 0;
      r[DATA_PTR_BASE_OFF + d2 * 4 + 3] = 0;
    }
  }

  clearStringChain(state, rom, dataPtr);

  return 1;
}
