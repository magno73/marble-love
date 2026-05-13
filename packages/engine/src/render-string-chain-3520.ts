/**
 * render-string-chain-3520.ts - runtime renderer for `FUN_00003520`.
 *
 * This is the 2x2 glyph variant used by `FUN_286EE` for the per-player
 * presentation timer/score fields. It walks the same string-chain entry
 * layout as `FUN_2572`, translates each byte through ROM glyph table
 * `0x72AC`, and dispatches the non-rotated glyph writer `FUN_32BA`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_END = 0x00402000;
const SPRITE_RAM_BASE = 0x00a02000;
const SPRITE_RAM_END = 0x00a03000;
const ALPHA_RAM_BASE = 0x00a03000;
const ALPHA_RAM_END = 0x00a04000;

const VAL_F00_OFF = 0x1f00;
const TICK_OFF = 0x1f3a;
const ROTATION_OFF = 0x1f42;

const ROM_LIMIT_TABLE = 0x7294;
const ROM_STRIDE_TABLE = 0x72a0;
const ROM_SHIFT_TABLE = 0x72a4;
const ROM_GLYPH_INDEX_TABLE = 0x72ac;
const ROM_GLYPH_TABLE_32BA = 0x0ccc;
const ROM_NARROW_GLYPH_TABLE_32BA = 0x0e04;

export const RENDER_STRING_CHAIN_3520_ADDR = 0x00003520 as const;
export const RENDER_GLYPH_32BA_ADDR = 0x000032ba as const;

function readU16(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function readI16(state: GameState, off: number): number {
  const w = readU16(state, off);
  return w & 0x8000 ? w - 0x10000 : w;
}

function sextByte(value: number): number {
  const b = value & 0xff;
  return b & 0x80 ? b - 0x100 : b;
}

function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a < 0x80000) return rom.program[a] ?? 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return state.workRam[a - WORK_RAM_BASE] ?? 0;
  if (a >= SPRITE_RAM_BASE && a < SPRITE_RAM_END) return state.spriteRam[a - SPRITE_RAM_BASE] ?? 0;
  if (a >= ALPHA_RAM_BASE && a < ALPHA_RAM_END) return state.alphaRam[a - ALPHA_RAM_BASE] ?? 0;
  return 0;
}

function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  return (
    ((readByteAbs(state, rom, addr) << 24) |
      (readByteAbs(state, rom, (addr + 1) >>> 0) << 16) |
      (readByteAbs(state, rom, (addr + 2) >>> 0) << 8) |
      readByteAbs(state, rom, (addr + 3) >>> 0)) >>>
    0
  );
}

function readRomWord(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  return (((rom.program[a] ?? 0) << 8) | (rom.program[(a + 1) >>> 0] ?? 0)) & 0xffff;
}

function readRomWordSigned(rom: RomImage, addr: number): number {
  const w = readRomWord(rom, addr);
  return w & 0x8000 ? w - 0x10000 : w;
}

function readRomLongSigned(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  const u = (
    (((rom.program[a] ?? 0) << 24) |
      ((rom.program[(a + 1) >>> 0] ?? 0) << 16) |
      ((rom.program[(a + 2) >>> 0] ?? 0) << 8) |
      (rom.program[(a + 3) >>> 0] ?? 0)) >>>
    0
  );
  return u | 0;
}

function writeAlphaWord(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a < ALPHA_RAM_BASE || a + 1 >= ALPHA_RAM_END) return;
  const off = a - ALPHA_RAM_BASE;
  const v = value & 0xffff;
  state.alphaRam[off] = (v >>> 8) & 0xff;
  state.alphaRam[off + 1] = v & 0xff;
}

export function renderGlyph32BA(
  state: GameState,
  rom: RomImage,
  alphaPtr: number,
  glyphCode: number,
  maskWord: number,
): void {
  const d3 = glyphCode & 0xffff;
  const mask = maskWord & 0xffff;
  const base = alphaPtr >>> 0;

  if (d3 >= 0x27 && d3 <= 0x2e) {
    const idx = ROM_NARROW_GLYPH_TABLE_32BA + (d3 - 0x27) * 4;
    writeAlphaWord(state, base, ((readRomWord(rom, idx) + 0x100) | mask) & 0xffff);
    writeAlphaWord(state, (base + 0x80) >>> 0, ((readRomWord(rom, idx + 2) + 0x100) | mask) & 0xffff);
    return;
  }

  if (d3 === 0x32) {
    writeAlphaWord(state, base, (0x001c | mask) & 0xffff);
    writeAlphaWord(state, (base + 2) >>> 0, (0x00db | mask) & 0xffff);
    writeAlphaWord(state, (base + 0x80) >>> 0, (0x001e | mask) & 0xffff);
    writeAlphaWord(state, (base + 0x82) >>> 0, (0x00dd | mask) & 0xffff);
    return;
  }

  const idx = ROM_GLYPH_TABLE_32BA + d3 * 8;
  writeAlphaWord(state, base, ((readRomWord(rom, idx) + 0x100) | mask) & 0xffff);
  writeAlphaWord(state, (base + 2) >>> 0, ((readRomWord(rom, idx + 2) + 0x100) | mask) & 0xffff);
  writeAlphaWord(state, (base + 0x80) >>> 0, ((readRomWord(rom, idx + 4) + 0x100) | mask) & 0xffff);
  writeAlphaWord(state, (base + 0x82) >>> 0, ((readRomWord(rom, idx + 6) + 0x100) | mask) & 0xffff);
}

export function renderStringChain3520(
  state: GameState,
  rom: RomImage,
  structAddr: number,
  maskWord: number,
): number {
  let a2 = structAddr >>> 0;
  let chainSafety = 1024;

  while (chainSafety-- > 0) {
    const tickOff = sextByte(readByteAbs(state, rom, (a2 + 1) >>> 0));
    const d1Word = (tickOff - readI16(state, TICK_OFF)) & 0xffff;
    const d1 = d1Word & 0x8000 ? d1Word - 0x10000 : d1Word;
    const rotation = readU16(state, ROTATION_OFF);
    const rotationSigned = rotation & 0x8000 ? rotation - 0x10000 : rotation;
    const limit = readRomWordSigned(rom, ROM_LIMIT_TABLE + rotationSigned * 2);

    if (d1 <= limit) {
      const stringPtr = readLongAbs(state, rom, (a2 + 2) >>> 0);
      let posTerm = rotation !== 0 ? (0x29 - d1) | 0 : (d1 << 6) | 0;
      const col = sextByte(readByteAbs(state, rom, a2));
      const shiftByte = rom.program[(ROM_SHIFT_TABLE + 1 + rotationSigned * 2) >>> 0] ?? 0;
      const shift = shiftByte & 0x3f;
      const colTerm = shift >= 32 ? 0 : (col << shift) | 0;
      let alphaPtr = (ALPHA_RAM_BASE + ((colTerm + posTerm) * 2)) >>> 0;

      let a4 = stringPtr >>> 0;
      let charSafety = 0x10000;
      while (charSafety-- > 0) {
        const ch = readByteAbs(state, rom, a4);
        a4 = (a4 + 1) >>> 0;
        if (ch === 0) break;

        const glyphCode = readRomLongSigned(rom, (ROM_GLYPH_INDEX_TABLE + (ch & 0xff) * 4) >>> 0);
        if (rotation === 0) {
          renderGlyph32BA(state, rom, alphaPtr, glyphCode, maskWord);
        }

        const stride = readRomWordSigned(rom, ROM_STRIDE_TABLE + rotationSigned * 2);
        if (glyphCode >= 0x26 && glyphCode <= 0x2e) {
          alphaPtr = (alphaPtr + stride * 2) >>> 0;
        } else {
          alphaPtr = (alphaPtr + stride * 4) >>> 0;
        }
      }
    }

    const marker = sextByte(readByteAbs(state, rom, (a2 + 6) >>> 0));
    if (marker + readI16(state, VAL_F00_OFF) <= 1) return 1;
    a2 = readLongAbs(state, rom, (a2 + 8) >>> 0);
  }

  return 1;
}

export { renderStringChain3520 as FUN_00003520 };
