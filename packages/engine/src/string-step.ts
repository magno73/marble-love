/**
 * string-step.ts — `FUN_00002CD4` (204 byte) e `FUN_00002DA0` (120 byte).
 *
 * Sub di FUN_2E18: rendering/clear INCREMENTALE (un char per frame).
 *
 * - **FUN_2CD4 — `stepRenderState3(structAddr, attrWord, charIdx) → byte`**:
 *   Renderizza il char[charIdx] della stringa. Returns 0 se fine string,
 *   3 altrimenti (continue state machine).
 *
 * - **FUN_2DA0 — `stepClearState4(structAddr, charIdx) → byte`**:
 *   Clear (azzera alpha word) del char[charIdx]. Returns 0 se fine, 4 continue.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const ROTATION_OFF = 0x1f42 as const;
const ALPHA_BASE = 0xa03000 as const;
const ROM_SHIFT_TABLE = 0x72a4 as const;
const ROM_XOR_TABLE = 0x72a8 as const;

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
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
function writeAlphaWord(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a >= 0xa03000 && a < 0xa04000) {
    const off = a - 0xa03000;
    const v = value & 0xffff;
    state.alphaRam[off] = (v >>> 8) & 0xff;
    state.alphaRam[off + 1] = v & 0xff;
  }
}

function computeAlphaBase(state: GameState, rom: RomImage, structAddr: number, charIdx: number): number {
  const rotation = readU16(state, ROTATION_OFF);
  const rotSigned = rotation & 0x8000 ? rotation - 0x10000 : rotation;

  let d3: number;
  const tickOff = readByteAbs(state, rom, (structAddr + 1) >>> 0);
  const tickOffSigned = tickOff & 0x80 ? tickOff - 0x100 : tickOff;
  if (rotation !== 0) {
    d3 = (0x29 - tickOffSigned) | 0;
  } else {
    d3 = (tickOffSigned << 6) | 0;
  }

  const colByte = readByteAbs(state, rom, structAddr);
  const colSigned = colByte & 0x80 ? colByte - 0x100 : colByte;

  const shiftIdx = rotSigned * 2 + 1;
  const shiftByte = rom.program[(ROM_SHIFT_TABLE + shiftIdx) >>> 0] ?? 0;
  const shiftCount = shiftByte & 0x80 ? shiftByte - 0x100 : shiftByte;

  // d0 = col + charIdx (charIdx is unsigned byte → just add)
  let d0 = (colSigned + (charIdx & 0xff)) | 0;
  // lsl.l shift count (logical, not arithmetic — for shift purposes same effect on small positive)
  if (shiftCount >= 32 || shiftCount < 0) {
    d0 = shiftCount < 0 ? d0 : 0;
  } else {
    d0 = (d0 << shiftCount) >>> 0;
    // Re-interpret as signed for the add (nope, just keep unsigned arithmetic)
    if (d0 & 0x80000000) d0 = d0 - 0x100000000;
  }
  d0 = ((d0 + d3) * 2) | 0;
  return (ALPHA_BASE + d0) >>> 0;
}

/**
 * Replica `FUN_00002CD4` — render single char at index.
 */
export function stepRenderState3(
  state: GameState,
  rom: RomImage,
  structAddr: number,
  attrWord: number,
  charIdx: number,
): number {
  const stringPtr = readLongAbs(state, rom, (structAddr + 2) >>> 0);
  const charAddr = (stringPtr + (charIdx & 0xff)) >>> 0;
  const charByte = readByteAbs(state, rom, charAddr);

  if (charByte === 0) return 0;

  const a3 = computeAlphaBase(state, rom, structAddr, charIdx);
  const attrW = attrWord & 0xffff;

  if (charByte === 0x20) {
    writeAlphaWord(state, a3, attrW);
    return 3;
  }

  // Case shift logic (same as FUN_2572)
  let chFinal = charByte;
  const attrTopBits = attrW & 0xc000;
  if (attrTopBits !== 0 && charByte >= 0x41 && charByte <= 0x5a) {
    if ((attrW & 0x8000) !== 0) {
      chFinal = (charByte - 0x40) & 0xff;
    } else {
      chFinal = (charByte + 0x40) & 0xff;
    }
  }
  const rotation = readU16(state, ROTATION_OFF);
  const rotSigned = rotation & 0x8000 ? rotation - 0x10000 : rotation;
  const xorMask = readRomWordSigned(rom, ROM_XOR_TABLE + rotSigned * 2);
  const composite = (attrW | chFinal) & 0xffff;
  const finalWord = (composite ^ xorMask) & 0xffff;
  writeAlphaWord(state, a3, finalWord);
  return 3;
}

/**
 * Replica `FUN_00002DA0` — clear single alpha cell at char index.
 */
export function stepClearState4(
  state: GameState,
  rom: RomImage,
  structAddr: number,
  charIdx: number,
): number {
  const stringPtr = readLongAbs(state, rom, (structAddr + 2) >>> 0);
  const charAddr = (stringPtr + (charIdx & 0xff)) >>> 0;
  const charByte = readByteAbs(state, rom, charAddr);

  if (charByte === 0) return 0;

  const a3 = computeAlphaBase(state, rom, structAddr, charIdx);
  writeAlphaWord(state, a3, 0);
  return 4;
}
