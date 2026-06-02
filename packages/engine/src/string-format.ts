/**
 *
 * The functions replicated here are used by HUD/score code to write formatted
 * numbers into the alpha tilemap. They operate byte-by-byte writes in
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { binToBcd } from "./bcd.js";

// ─── Memory Dispatch (Subset Consistent With bus.ts) ──────────────────────

function writeMemoryU8(state: GameState, addr: number, value: number): void {
  const v = value & 0xff;
  if (addr >= 0x400000 && addr < 0x402000) {
    state.workRam[addr - 0x400000] = v;
  } else if (addr >= 0xa02000 && addr < 0xa03000) {
    state.spriteRam[addr - 0xa02000] = v;
  } else if (addr >= 0xa03000 && addr < 0xa04000) {
    state.alphaRam[addr - 0xa03000] = v;
  } else if (addr >= 0xb00000 && addr < 0xb00800) {
    state.colorRam[addr - 0xb00000] = v;
  }
}

function readMemoryU8(
  state: GameState,
  rom: RomImage | null,
  addr: number,
): number {
  if (rom !== null && addr < 0x80000) return rom.program[addr] ?? 0;
  if (addr >= 0x400000 && addr < 0x402000) return state.workRam[addr - 0x400000] ?? 0;
  if (addr >= 0xa02000 && addr < 0xa03000) return state.spriteRam[addr - 0xa02000] ?? 0;
  if (addr >= 0xa03000 && addr < 0xa04000) return state.alphaRam[addr - 0xa03000] ?? 0;
  if (addr >= 0xb00000 && addr < 0xb00800) return state.colorRam[addr - 0xb00000] ?? 0;
  return 0;
}

// ─── strcpy (FUN_1D74) ────────────────────────────────────────────────────

/**
 * `FUN_00001D74` replica — `strcpy(dest, src)`.
 *
 * Disassembly (5 instructions):
 *   movea.l (0x4,SP),A1      ; A1 = arg1 (dest)
 *   movea.l (0x8,SP),A0      ; A0 = arg2 (src)
 *   loop:
 *     move.b (A0)+,(A1)+     ; *dest++ = *src++ (Z flag = byte == 0)
 *     bne.b loop
 *   rts
 *
 * null byte (including the null terminator). Equivalent to C strcpy.
 *
 * must be in writable RAM.
 *
 */
export function strcpy(
  state: GameState,
  rom: RomImage | null,
  destAddr: number,
  srcAddr: number,
): void {
  let d = destAddr >>> 0;
  let s = srcAddr >>> 0;
  let safety = 4096;
  while (safety-- > 0) {
    const b = readMemoryU8(state, rom, s);
    writeMemoryU8(state, d, b);
    s = (s + 1) >>> 0;
    d = (d + 1) >>> 0;
    if (b === 0) break;
  }
}

// ─── setAlphaTile (FUN_3784) ──────────────────────────────────────────────

/**
 * Replica `FUN_00003784` — `setAlphaTile(arg1, arg2, arg3, arg4)`.
 *
 * (with the, row) in the HUD overlay.
 *
 * Disassembly (cdecl 4 long args):
 *   D1 = arg1.b (low byte of long arg1 @ SP+12)
 *   D0 = arg2.b (low byte of long arg2 @ SP+16)
 *   D2 = arg3.w (low word of long arg3 @ SP+20)
 *   if *0x401F42 != 0:
 *     D3 = 0x29 - sext_l(D0.b)        ; rotation mode
 *   else:
 *     D3 = sext_l(D0.b) << 6           ; row stride 64
 *   D0 = sext_l(D1.b)
 *   D1 = (sext_w(*0x401F42)) * 2 + 1
 *   D1 = sext_l(*(0x72A4 + D1).b)     ; lookup shift count
 *   D0 <<= D1
 *   D0 += D3; D0 *= 2
 *   *(0xA03000 + D0).w = arg4.w | D2.w
 */
export function setAlphaTile(
  state: GameState,
  rom: { program: Uint8Array },
  arg1Byte: number,
  arg2Byte: number,
  arg3Word: number,
  arg4Word: number,
): void {
  const ALPHA_RAM_BASE = 0xa03000;
  const ROM_LOOKUP_TABLE = 0x72a4;
  const ROTATION_FLAG_OFF = 0x1f42;

  const arg1Long = ((arg1Byte & 0xff) << 24) >> 24;
  const arg2Long = ((arg2Byte & 0xff) << 24) >> 24;

  const rotFlag =
    ((state.workRam[ROTATION_FLAG_OFF] ?? 0) << 8) |
    (state.workRam[ROTATION_FLAG_OFF + 1] ?? 0);

  let d3: number;
  if (rotFlag !== 0) {
    d3 = (0x29 - arg2Long) | 0;
  } else {
    d3 = (arg2Long << 6) | 0;
  }

  const rotFlagSigned = (rotFlag & 0x8000) ? rotFlag - 0x10000 : rotFlag;
  // movea.l #0x72A4, A0; move.b (1, A0, D1*1), D1.b
  // D1 = sext_l(rotFlag) * 2, then read byte at A0 + D1 + 1
  const lookupIdx = (rotFlagSigned * 2 + 1) | 0;
  const shiftByte = rom.program[(ROM_LOOKUP_TABLE + lookupIdx) >>> 0] ?? 0;
  const shiftCount = ((shiftByte & 0xff) << 24) >> 24;

  let d0 = arg1Long;
  if (shiftCount >= 32 || shiftCount < 0) {
    d0 = shiftCount < 0 ? d0 : 0;
  } else {
    d0 = (d0 << shiftCount) | 0;
  }

  d0 = ((d0 + d3) * 2) | 0;

  const destAddr = (ALPHA_RAM_BASE + d0) >>> 0;
  const value = ((arg3Word | arg4Word) & 0xffff) >>> 0;
  if (destAddr >= 0xa03000 && destAddr < 0xa04000) {
    const off = destAddr - 0xa03000;
    state.alphaRam[off] = (value >>> 8) & 0xff;
    state.alphaRam[off + 1] = value & 0xff;
  }
}

// ─── formatHex (FUN_3A08) ─────────────────────────────────────────────────

/**
 * Replica `FUN_00003A08` — formatHex(value, bufEnd, numDigits, showSpaces).
 *
 *
 *   - If `value == 0` e `showSpaces == 1`: leading zero diventa space (' ').
 *
 * Disassembly:
 *   D1 = value (long, arg1 a SP+8)
 *   A0 = bufEnd (arg2 a SP+12)
 *   D0 = numDigits (arg3 a SP+16)
 *   showSpaces = (0x16, SP).w (arg4, word low of un long a SP+20)
 *
 *   A0 += D0
 *   *A0 = 0 (null terminator)
 *   if D1 == 0:
 *     *--A0 = '0'; D0 -= 1
 *   D0 -= 1
 *   if D0 < 0: goto end
 *   loop:
 *     D2 = D1 & 0xF
 *     if D2 >= 10: D2 += 7 (gap '9'+1..'A')
 *     if D1 == 0 AND showSpaces == 1: D2 = -16 (= ' '-0x30)
 *     D2 += '0'
 *     *--A0 = D2
 *     D1 >>= 4 (lsr.l)
 *     if D0 != 0: D0 -= 1, loop
 *   end: rts
 */
export function formatHex(
  state: GameState,
  value: number,
  bufEnd: number,
  numDigits: number,
  showSpaces: number,
): void {
  let d1 = value >>> 0;
  let a0 = (bufEnd + numDigits) >>> 0;
  let d0 = numDigits | 0;
  const showSp = (showSpaces & 0xffff) === 1;

  // Null terminator
  writeMemoryU8(state, a0, 0);

  // if D1 == 0: write '0' and decrement D0
  if (d1 === 0) {
    a0 = (a0 - 1) >>> 0;
    writeMemoryU8(state, a0, 0x30); // '0'
    d0 = (d0 - 1) | 0;
  }

  // D0 -= 1
  d0 = (d0 - 1) | 0;
  // if D0 < 0 (signed bmi): exit
  if (d0 < 0) return;

  while (true) {
    let d2 = d1 & 0xf;
    if (d2 >= 10) d2 += 7;
    if (d1 === 0 && showSp) d2 = -16;
    d2 = (d2 + 0x30) & 0xff;
    a0 = (a0 - 1) >>> 0;
    writeMemoryU8(state, a0, d2);
    d1 = d1 >>> 4;
    if (d0 === 0) break;
    d0 = (d0 - 1) | 0;
  }
}

// ─── formatDecimal (FUN_3A54) ─────────────────────────────────────────────

/**
 * Replica `FUN_00003A54` — `formatDecimal(value, bufEnd, numDigits, showSpaces)`.
 *
 * Trampolino: converte value in BCD via FUN_3A6A (binToBcd), poi formatta
 */
export function formatDecimal(
  state: GameState,
  value: number,
  bufEnd: number,
  numDigits: number,
  showSpaces: number,
): void {
  const bcdValue = binToBcd(value);
  formatHex(state, bcdValue, bufEnd, numDigits, showSpaces);
}

const FUN_3874_DEC_TABLE = [
  1_000_000_000,
  100_000_000,
  10_000_000,
  1_000_000,
  100_000,
  10_000,
  1_000,
  100,
  10,
] as const;

function isCommaPowerIndex(index: number): boolean {
  return index === 0 || index === 3 || index === 6;
}

function writeRepeatedBuffer(state: GameState, addr: number, len: number, value: number): void {
  const count = len & 0xff;
  writeMemoryU8(state, (addr + count) >>> 0, 0);
  for (let i = count - 1; i >= 0; i--) {
    writeMemoryU8(state, (addr + i) >>> 0, value);
  }
}

/**
 * Replica the general `FUN_00003874` number formatter for the decimal paths
 * used by HUD/high-score rendering.
 *
 * Unlike `FUN_3A54`, this writes forward into a pre-sized buffer, inserts
 * thousands separators, and uses `fillExtra` to choose how many decimal
 * places to reserve. This is the formatter called by `FUN_28E3C/28EB2`.
 */
export function formatNumber3874(
  state: GameState,
  value: number,
  bufAddr: number,
  fmtMode: number,
  width: number,
  fillExtra: number,
): void {
  const mode = fmtMode & 0xff;
  if (mode !== 0x64 && mode !== 0x73) {
    formatDecimal(state, value, bufAddr, width, fillExtra);
    return;
  }

  const originalDigits = fillExtra & 0xff;
  let digitsAndCommas = originalDigits;
  if (mode === 0x73) digitsAndCommas = (digitsAndCommas + 1) & 0xff;

  const startIndex = Math.max(0, Math.min(FUN_3874_DEC_TABLE.length, 10 - originalDigits));
  let fill = 0x20;
  if ((width & 0xff) !== 1) {
    digitsAndCommas = (digitsAndCommas + Math.floor((((originalDigits - 1) & 0xff) >>> 0) / 3)) & 0xff;
  } else {
    fill = 0x30;
  }

  writeRepeatedBuffer(state, bufAddr, digitsAndCommas, fill);

  let d1 = value >>> 0;
  let a0 = bufAddr >>> 0;
  let d4 = width & 0xff;
  let signChar = 0;

  if (mode === 0x73) {
    if ((d1 & 0x80000000) !== 0) {
      signChar = 0x2d;
      d1 = (-d1) >>> 0;
    } else {
      signChar = 0x2b;
    }
    if (d4 === 0) {
      const savedSign = signChar;
      signChar = savedSign;
      writeMemoryU8(state, a0, 0x20);
    } else {
      writeMemoryU8(state, a0, signChar);
    }
    a0 = (a0 + 1) >>> 0;
  }

  for (let i = startIndex; i < FUN_3874_DEC_TABLE.length; i++) {
    const divisor = FUN_3874_DEC_TABLE[i]!;
    let digit = 0;
    while (d1 >= divisor) {
      d1 = (d1 - divisor) >>> 0;
      digit++;
    }

    if (digit === 0) {
      if (d4 === 2) {
        continue;
      }
      if (d4 === 0) {
        a0 = (a0 + 1) >>> 0;
        if (isCommaPowerIndex(i)) a0 = (a0 + 1) >>> 0;
        continue;
      }
    } else if (d4 === 0 && mode === 0x73) {
      writeMemoryU8(state, (a0 - 1) >>> 0, signChar);
    }

    d4 |= 0x04;
    writeMemoryU8(state, a0, (digit + 0x30) & 0xff);
    a0 = (a0 + 1) >>> 0;
    if ((d4 & 1) === 0 && isCommaPowerIndex(i)) {
      writeMemoryU8(state, a0, 0x2c);
      a0 = (a0 + 1) >>> 0;
    }
  }

  if (d4 === 0 && mode === 0x73) {
    writeMemoryU8(state, (a0 - 1) >>> 0, signChar);
  }
  writeMemoryU8(state, a0, ((d1 & 0xff) + 0x30) & 0xff);
}
