/**
 * string-render.ts - port of pure leaf `FUN_00002572` (262 bytes).
 *
 * "Render string chain": walks a linked list of entries and writes each string
 * to the alpha tilemap @ 0xA03000, with rotation support (orientation 0..7) and
 * case shifting for 'A'..'Z'.
 *
 * **Layout entry struct (8+ bytes)**:
 *   +0  byte  : with the (column in tile units)
 *   +1  byte  : tick offset (entry becomes due when offset - tick <= lookup)
 *   +2  long  : pointer to the zero-terminated string
 *   +6  byte  : marker for chain end check
 *   +8  long  : pointer to the next entry
 *
 * **Globals workRam**:
 *   0x401F00  word: VALUE_F00 (additive for marker check)
 *   0x401F3A  word: tick counter
 *   0x401F42  word: rotation flag (0..7)
 *
 * **ROM tables** (same as setAlphaTile):
 *   0x7294  word table: max-display-row per rotation
 *   0x72A0  word table: stride between consecutive chars per rotation
 *   0x72A4  byte table @ +1: shift count per rotation (matches setAlphaTile pattern)
 *   0x72A8  word table: XOR mask by rotation
 *
 * **Algorithm**:
 *   1. Read tick offset, compute D1 = offset - tick
 *   2. If D1 > lookup7294[rotation]: skip render
 *   3. Else compute alpha base: ALPHA + 2 * (with the << shift + d3)
 *      with d3 = (rotation != 0) ? (0x29 - D1) : (D1 * 64)
 *   4. For each char in string:
 *      - if char == 0: end string
 *      - if char == 0x20 (space): write attr only
 *      - else if char in 'A'..'Z' AND attr & 0xC000 != 0:
 *        case shift: char +/- 0x40 based on attr & 0x8000
 *        write (attr | char_shifted) ^ XOR mask
 *      - else: write (attr | char) ^ XOR mask
 *      - alpha += 2 * stride
 *   5. After string: marker check. If marker + *0x401F00 > 1, advance to
 *      A1 = *(A1+8) and restart. Otherwise exit.
 *
 * Returns: D0 = 1 (always).
 *
 * **Bit-perfect verified** against `FUN_00002572` through differential tests.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants ───────────────────────────────────────────────────

const VAL_F00_OFF = 0x1f00 as const;
const TICK_OFF = 0x1f3a as const;
const ROTATION_OFF = 0x1f42 as const;
const ALPHA_BASE = 0xa03000 as const;

const ROM_LOOKUP_LIMIT = 0x7294 as const;
const ROM_STRIDE_TABLE = 0x72a0 as const;
const ROM_SHIFT_TABLE = 0x72a4 as const;
const ROM_XOR_TABLE = 0x72a8 as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}
function readU16Signed(state: GameState, off: number): number {
  const w = readU16(state, off);
  return w & 0x8000 ? w - 0x10000 : w;
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
  // Out-of-range writes silently ignored (bin would still write but to non-modeled regions)
}

// ─── Main function: port of FUN_2572 ─────────────────────────────────────

/**
 * Port of `FUN_00002572` - render string chain with rotation support.
 *
 * @param state      GameState
 * @param rom        RomImage for ROM tables 0x7294/0x72A0/0x72A4/0x72A8.
 * @param structAddr Absolute address of the first linked-list entry.
 * @param attrWord   Attribute word passed as arg2; used as palette bitmap and
 *                    case-shift flags.
 * @returns          Always 1 (D0 from disasm).
 */
export function renderStringChain(
  state: GameState,
  rom: RomImage,
  structAddr: number,
  attrWord: number,
): number {
  let a1 = structAddr >>> 0;
  // Safety bound: chain depth limit to avoid loops on malformed data.
  let chainSafety = 1024;
  const attrW = attrWord & 0xffff;

  while (chainSafety-- > 0) {
    // Read tick offset byte at A1+1, sext to word, sub tick
    const tickOff = readByteAbs(state, rom, (a1 + 1) >>> 0);
    const tickOffSigned = tickOff & 0x80 ? tickOff - 0x100 : tickOff;
    const tickSigned = readU16Signed(state, TICK_OFF);
    // sub.w in word arithmetic
    let d1Word = (tickOffSigned - tickSigned) & 0xffff;
    let d1Signed = d1Word & 0x8000 ? d1Word - 0x10000 : d1Word;

    // Read rotation
    const rotation = readU16(state, ROTATION_OFF);
    const rotSigned = rotation & 0x8000 ? rotation - 0x10000 : rotation;
    const lookup = readRomWordSigned(rom, ROM_LOOKUP_LIMIT + rotSigned * 2);

    // bgt: D1 > lookup → skip render
    if (d1Signed <= lookup) {
      // Render
      let a3 = ALPHA_BASE;
      const stringPtr = readLongAbs(state, rom, (a1 + 2) >>> 0);
      let a4 = stringPtr >>> 0;

      let d3: number;
      if (rotation !== 0) {
        d3 = (0x29 - d1Signed) | 0;
      } else {
        d3 = (d1Signed << 6) | 0;
      }

      // Read with the byte at A1
      const colByte = readByteAbs(state, rom, a1);
      const colSigned = colByte & 0x80 ? colByte - 0x100 : colByte;

      // Shift count from ROM @ 0x72A5 + rotation*2
      const shiftIdx = rotSigned * 2 + 1;
      const shiftByte = rom.program[(ROM_SHIFT_TABLE + shiftIdx) >>> 0] ?? 0;
      const shiftCount = shiftByte & 0x80 ? shiftByte - 0x100 : shiftByte;

      let d0 = colSigned;
      // asl.l with out-of-range shift count: 68k caps at 64; >= 32 -> 0
      if (shiftCount >= 32 || shiftCount < 0) {
        d0 = shiftCount < 0 ? d0 : 0;
      } else {
        d0 = (d0 << shiftCount) | 0;
      }
      d0 = ((d0 + d3) * 2) | 0;
      a3 = (ALPHA_BASE + d0) >>> 0;

      // Inner string loop
      let charSafety = 256;
      while (charSafety-- > 0) {
        const ch = readByteAbs(state, rom, a4);
        a4 = (a4 + 1) >>> 0;
        if (ch === 0) break;

        if (ch === 0x20) {
          // Space: write attr only
          writeAlphaWord(state, a3, attrW);
        } else {
          // Compute char (with case shift if applicable)
          let chFinal = ch;
          const attrTopBits = attrW & 0xc000;
          if (attrTopBits !== 0 && ch >= 0x41 && ch <= 0x5a) {
            // 'A'..'Z' AND attr top bits set
            if ((attrW & 0x8000) !== 0) {
              chFinal = (ch - 0x40) & 0xff;
            } else {
              chFinal = (ch + 0x40) & 0xff;
            }
          }
          const xorMask = readRomWordSigned(rom, ROM_XOR_TABLE + rotSigned * 2);
          const composite = (attrW | chFinal) & 0xffff;
          const finalWord = (composite ^ xorMask) & 0xffff;
          writeAlphaWord(state, a3, finalWord);
        }

        // Stride advance
        const stride = readRomWordSigned(rom, ROM_STRIDE_TABLE + rotSigned * 2);
        a3 = (a3 + stride * 2) >>> 0;
      }
    }

    // Chain advance check
    const marker = readByteAbs(state, rom, (a1 + 6) >>> 0);
    const markerSigned = marker & 0x80 ? marker - 0x100 : marker;
    const valF00Signed = readU16Signed(state, VAL_F00_OFF);
    const sum = (markerSigned + valF00Signed) | 0;
    // bge: branch if 1 >= sum → branch when sum <= 1 → exit
    if (sum <= 1) return 1;

    // Advance to next entry
    a1 = readLongAbs(state, rom, (a1 + 8) >>> 0);
  }

  return 1;
}
