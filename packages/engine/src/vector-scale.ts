/**
 * vector-scale.ts — pure-leaf `FUN_00025E7C` replica (326 bytes).
 *
 * 2D vector scaling/normalization function with 4 modes:
 *   - mode 2: scaling with D2 *= 4 before divide
 *   - mode 3: two divides (one for x, one for y)
 *   - mode 4: D4 = (D2 >> 2) + D3
 *   - default: D4 = max(0, D3 - D2)
 *
 * Output: writes (x: long, y: long) to `*A0`, mutating the vector in place.
 *
 * **Algorithm**:
 *   1. Compute D2 = abs(x), D4 = abs(y)
 *   2. D3 = approx Manhattan distance: max(|x|,|y|) + min/8 * 3
 *   3. Lookup ROM @ 0x1EEF8 for interpolation (D4*2, D4*2+2)
 *   4. D2 = sext(D5) + ((ROM[D4+1]-ROM[D4]) * D2_mid_bits) >> 3
 *   5. D3 clamp to 0x100 unsigned
 *   6. Switch on mode → compute D4
 *   7. D5 = (D4 << 6) / (D3 >> 8) — divu.w
 *   8. D1 = D5 (mode != 3) or second divide (mode 3)
 *   9. *A0 = (*A0 >> 8) * D5 >> 6 (signed mul, asr)
 *   10. *(A0+4) = (*(A0+4) >> 8) * D1 >> 6
 *
 * **Pure leaf**: 0 jsr, 0 workRam globals.
 *
 * **Verified bit-perfect** against `FUN_00025E7C` via differential test.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** ROM lookup table @ 0x1EEF8 (16+ word entries). */
const ROM_TABLE_OFF = 0x1eef8 as const;

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

function absLongM68k(v: number): number {
  // M68k neg.l (0x80000000) = 0x80000000 (overflow stays).
  if (v >= 0) return v >>> 0;
  if (v === -0x80000000) return 0x80000000;
  return -v >>> 0;
}

/** Read signed 16-bit ROM word. */
function readRomWordSigned(rom: RomImage, addr: number): number {
  const w = ((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0);
  return w & 0x8000 ? w - 0x10000 : w;
}

/**
 * Replica `FUN_00025E7C` — vector scale 2D in-place.
 *
 * @param state    GameState
 * @param rom      RomImage (for the ROM table @ 0x1EEF8)
 * @param vecAddr  Absolute address of the vector (8 bytes: x.l, y.l)
 * @param mode     Mode byte (2, 3, 4, or default)
 */
export function vectorScale(
  state: GameState,
  rom: RomImage,
  vecAddr: number,
  mode: number,
): void {
  const xLong = readU32Signed(state, vecAddr);
  const yLong = readU32Signed(state, (vecAddr + 4) >>> 0);

  // D2 = abs(x), D4 = abs(y)
  const d2abs = absLongM68k(xLong);
  const d4abs = absLongM68k(yLong);

  // D3 = approx distance
  // if D2 > D4 (unsigned): D3 = (D4 >> 3) * 3 + D2
  // else:                   D3 = (D2 >> 3) * 3 + D4
  // bls = branch low or same (unsigned <=). Therefore if D2 <= D4: branch (else path).
  let d3: number;
  if ((d2abs >>> 0) > (d4abs >>> 0)) {
    // D0 = D4 >> 3 (unsigned, lsr.l), then D3 = sext_w(D0.w) (= move.w D0w,D3w; ext.l D3),
    // then D3 = mulu.w 3 (unsigned multiply word → long), then add.l D2,D3
    const d0 = (d4abs >>> 3) >>> 0;
    const d3w = d0 & 0xffff;
    const d3sext = d3w & 0x8000 ? d3w - 0x10000 : d3w;
    d3 = ((d3sext * 3) + d2abs) >>> 0;
  } else {
    const d0 = (d2abs >>> 3) >>> 0;
    const d3w = d0 & 0xffff;
    const d3sext = d3w & 0x8000 ? d3w - 0x10000 : d3w;
    d3 = ((d3sext * 3) + d4abs) >>> 0;
  }
  // d3 stays 32-bit (sum of two longs)

  // D4 = (D3 >> 15) & 0xF — high nibble of D3 word slice
  // D0 = D3 >> 15 (lsr.l) → keep low word, then & 0xF
  let d0 = d3 >>> 15;
  let d4w = d0 & 0xffff;
  d4w = d4w & 0x0f;

  // D2 = (D3 >> 12) & 0x7
  d0 = d3 >>> 12;
  let d2w = d0 & 0xffff;
  d2w = d2w & 0x07;

  // D5 = ROM[D4*2] (word, sext_w). add.l D0,D0 means D0 *= 2.
  const d4sext = d4w; // d4w is in [0,15], always positive small
  const romIdx1 = (ROM_TABLE_OFF + d4sext * 2) >>> 0;
  const d5word = readRomWordSigned(rom, romIdx1);
  // D0 = ROM[(D4+1)*2] (word)
  const romIdx2 = (ROM_TABLE_OFF + (d4sext + 1) * 2) >>> 0;
  const d0word = readRomWordSigned(rom, romIdx2);

  // D0 = D0w - D5w (word sub) — sub.w D5w,D0w. Result in D0w as low word.
  // Then muls.w D2w, D0 (signed mul word → long, replaces D0).
  let d0sub = (d0word - d5word) | 0;
  // Truncate to word (signed -32768..32767):
  d0sub = ((d0sub & 0xffff) << 16) >> 16;
  // muls.w D2w, D0: d0 = d0sub.w * d2w.w (signed)
  let d2long = (d0sub * d2w) | 0;
  // D2 = D0 (long copy from muls)
  // asr.l #3, D2 — signed shift right by 3
  d2long = d2long >> 3;
  // D2 += sext_l(D5w)
  d2long = (d2long + d5word) | 0;
  // D2 final long stored in d2long

  // cmpi.l #0x100, D3; bcc skip → branch if 0x100 - D3 carry-clear unsigned (D3 >= 0x100)
  // Wait: cmp #imm, D3 = D3 - imm. bcc: branch if no borrow = D3 >= imm unsigned.
  // So skip clamp if D3 >= 0x100. Else clamp to 0x100.
  // Actually re-check: if D3 < 0x100 unsigned, we DON'T branch (bcc is "branch if carry clear" after sub).
  // After D3 - 0x100: borrow if D3 < 0x100 → C set → bcc DOESN'T branch.
  // So: if D3 < 0x100: fall through, clamp D3 to 0x100.
  // Actually wait, the disasm sequence:
  //   cmpi.l #0x100, D3
  //   bcc.b skip_clamp
  //   move.l #0x100, D3
  //   skip_clamp:
  // bcc branches if D3 >= 0x100. So clamp only when D3 < 0x100 (forces D3 UP to 0x100, not down).
  // Wait that's WRONG. Let me re-read:
  //   bcc skip; move #0x100, D3; skip:
  // If branch taken: skip the assignment. If not: D3 = 0x100.
  // So D3 = 0x100 only if D3 < 0x100. Forces D3 to be at LEAST 0x100.
  // Hmm that's a lower bound clamp, not upper bound.
  if ((d3 >>> 0) < 0x100) d3 = 0x100;

  // Switch on mode (D1.b)
  let d4final: number;
  let secondDivide = false;
  let secondD0Out = 0;
  if (mode === 2) {
    // D2 *= 4 (asl.l #2)
    d2long = (d2long << 2) | 0;
    // if D2 >= D3 unsigned: D4 = 0, else D4 = D3 - D2
    if ((d2long >>> 0) >= (d3 >>> 0)) {
      d4final = 0;
    } else {
      d4final = (d3 - d2long) >>> 0;
    }
  } else if (mode === 3) {
    // First D4 = (D2 >= D3) ? 0 : D3 - D2
    if ((d2long >>> 0) >= (d3 >>> 0)) {
      d4final = 0;
    } else {
      d4final = (d3 - d2long) >>> 0;
    }
    // Then D2 = D2 + D2*4 = D2*5 (asl.l #2; add.l D0,D2)
    const d0tmp = (d2long << 2) | 0;
    d2long = (d2long + d0tmp) | 0;
    // Then D0 = (D2 >= D3) ? 0 : D3 - D2
    if ((d2long >>> 0) >= (d3 >>> 0)) {
      secondD0Out = 0;
    } else {
      secondD0Out = (d3 - d2long) >>> 0;
    }
    secondDivide = true;
  } else if (mode === 4) {
    // D0 = (D2 >> 2) + D3
    d4final = ((d2long >> 2) + d3) >>> 0;
  } else {
    // default
    if ((d2long >>> 0) >= (d3 >>> 0)) {
      d4final = 0;
    } else {
      d4final = (d3 - d2long) >>> 0;
    }
  }

  // common: D2 = D4 << 6 (lsl.l #6); D0 = D3 >> 8 (lsr.l #8); divu.w D0w, D2
  // divu.w D0w, D2: D2_long / D0_word → quotient in low word, remainder in high word
  const dividend1 = (d4final << 6) >>> 0;
  const divisor1 = (d3 >>> 8) & 0xffff; // word
  let d5final: number;
  if (divisor1 === 0) {
    // div by 0 in 68k → trap, undefined. In our test we ensure non-zero.
    // Best-effort: return 0.
    d5final = 0;
  } else {
    const quotient = Math.floor(dividend1 / divisor1) & 0xffff;
    d5final = quotient;
  }

  let d1final: number;
  if (mode === 3 && secondDivide) {
    // mode 3: second divide for D1
    const dividend2 = (secondD0Out << 6) >>> 0;
    if (divisor1 === 0) {
      d1final = 0;
    } else {
      d1final = Math.floor(dividend2 / divisor1) & 0xffff;
    }
  } else {
    // Mode 3 without second path? In disasm, "if mode != 3: D1 = D5"
    d1final = d5final;
  }

  // Apply scaling
  // D0 = (*A0).l >> 8 (asr.l #8)
  // D0 = muls.w D5w, D0 (signed word mul) → long
  // D0 = D0 >> 6 (asr.l)
  // *A0 = D0
  let dx = xLong >> 8;
  // muls.w: signed word mul. We need low word of dx (signed).
  let dxLow = dx & 0xffff;
  if (dxLow & 0x8000) dxLow -= 0x10000;
  let d5sign = d5final & 0xffff;
  if (d5sign & 0x8000) d5sign -= 0x10000;
  let dxNew = (dxLow * d5sign) | 0;
  dxNew = dxNew >> 6;
  writeU32(state, vecAddr, dxNew >>> 0);

  let dy = yLong >> 8;
  let dyLow = dy & 0xffff;
  if (dyLow & 0x8000) dyLow -= 0x10000;
  let d1sign = d1final & 0xffff;
  if (d1sign & 0x8000) d1sign -= 0x10000;
  let dyNew = (dyLow * d1sign) | 0;
  dyNew = dyNew >> 6;
  writeU32(state, (vecAddr + 4) >>> 0, dyNew >>> 0);
}
