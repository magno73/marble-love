/**
 * sprite-rotate-1c014.ts — replica `FUN_0001C014` (1546 byte, 0x01C014–0x01C61E).
 *
 * "Sprite rotation matrix builder + vertex transform + bubble-sort + slot-fill".
 * `A2+0xA4` (stride 6: word angle @ +0, word X @ +2, word Y @ +4).
 *
 * ## Struct A2 (relevant offsets)
 *
 * | offset | type  | description                                            |
 * |--------|-------|--------------------------------------------------------|
 * | +0x00  | long  | velocity.x Q4.12 (if byte@+0x58 != 0xA)               |
 * | +0x04  | long  | velocity.y Q4.12 (if byte@+0x58 != 0xA)               |
 * | +0x1A  | byte  | type-flag: if == 8 → check ptr @ +0xCC                 |
 * | +0xA4  | slot×6 | 4 slot sprite output (4 × 6 byte, stride 6)          |
 *
 * ## ROM tables
 *   - `0x1EDA2` — sine/cosine word, index (D2.l*2) or ((D2+1).l*2).
 *
 * ## External JSRs
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { lerpFromRom } from "./lerp.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** `*0x400394` word — game mode selector. */
const GAME_MODE_OFF = 0x394;

/** ROM: sine/cosine table (word, signed). */
const ROM_SINE_BASE = 0x1eda2;
/** ROM: angle-tile table (word, unsigned). */
const ROM_ANGLE_BASE = 0x24ade;
/** ROM: offset-Y slot table (byte, signed via ext.w). */
const ROM_OFFY_BASE = 0x24b2c;

const PTR_TYPE_A = 0x00215c6;
const PTR_TYPE_B = 0x00215ea;

// ─── Helpers ───────────────────────────────────────────────────────────────

function ru16(s: GameState, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}
function wu16(s: GameState, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}
function ru32(s: GameState, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}
/** sext16: cast u16 → signed (-32768..32767). */
function sx(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}
/** i32 forced wrap. */
function i32(v: number): number {
  return v | 0;
}
/** muls.w: signed 16×16 → signed 32. */
function muls(a: number, b: number): number {
  return i32(sx(a) * sx(b));
}
/** mulu.w: unsigned 16×16 → unsigned 32 low word of result stored via movea.l. */
function mulu(a: number, b: number): number {
  return ((a & 0xffff) * (b & 0xffff)) >>> 0;
}
/** lsr.l #14 then take .w (unsigned). */
function lsr14w(v: number): number {
  return ((v >>> 14) & 0xffff);
}
/** asr.l #14 then take .w. */
function asr14w(v: number): number {
  return (i32(v) >> 14) & 0xffff;
}
function romS16(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  const r = (((rom.program[a] ?? 0) << 8) | (rom.program[a + 1] ?? 0)) & 0xffff;
  return r & 0x8000 ? r - 0x10000 : r;
}
function romU16(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  return (((rom.program[a] ?? 0) << 8) | (rom.program[a + 1] ?? 0)) & 0xffff;
}
function romU8(rom: RomImage, addr: number): number {
  return (rom.program[addr >>> 0] ?? 0) & 0xff;
}
function romU32(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  return (
    (((rom.program[a] ?? 0) << 24) |
      ((rom.program[a + 1] ?? 0) << 16) |
      ((rom.program[a + 2] ?? 0) << 8) |
      (rom.program[a + 3] ?? 0)) >>>
    0
  );
}

/**
 *   D2 = D6 >> 6 (signed word, = integer index)
 *   D3 = D6 & 0x3F (fraction 0..63)
 *   v1 = ROM[base + (D2+1)*2]  (signed word)
 *   v0 = ROM[base + D2*2]      (signed word)
 *   D1 = v1 - v0
 *   result = D1 * D3 / 64 + v0   (muls.w, asr.l #6, adda.w)
 */
function sineInterp(rom: RomImage, d6: number): { a1: number; d6cos: number } {
  const d6u = d6 & 0xffff;

  // First sine (for the D3 slot at 0x1c1d0)
  const d2a = (sx(d6u) >> 6) & 0xffff; // asr.w #6
  const d3a = d6u & 0x3f;
  const d2aI = sx(d2a); // signed index
  const v1a = romS16(rom, ROM_SINE_BASE + ((d2aI + 1) * 2));
  const v0a = romS16(rom, ROM_SINE_BASE + (d2aI * 2));
  const d1a = (v1a - v0a) & 0xffff;
  const mulA = i32(sx(d1a) * d3a) >> 6; // asr.l #6
  const a1 = (sx(mulA & 0xffff) + v0a) & 0xffff; // adda.w: A1 = lerp + v0

  // Second sine: angle = (0x1922 - D6) for cosine (at 0x1c208)
  const d6b = (0x1922 - d6u) & 0xffff;
  const d2b = (sx(d6b) >> 6) & 0xffff;
  const d3b = d6b & 0x3f;
  const d2bI = sx(d2b);
  const v1b = romS16(rom, ROM_SINE_BASE + ((d2bI + 1) * 2));
  const v0b = romS16(rom, ROM_SINE_BASE + (d2bI * 2));
  const d1b = (v1b - v0b) & 0xffff;
  const mulB = i32(sx(d1b) * d3b) >> 6;
  const d6cos = (sx(mulB & 0xffff) + v0b) & 0xffff; // add.w

  return { a1, d6cos };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 *
 * @param rom     ROM image — per `lerpFromRom` and lookup tables.
 */
export function spriteRotate1C014(
  state: GameState,
  rom: RomImage,
  objOff: number,
): void {

  // cmpi.b #0xA,(0x58,A2); beq 0x1c040
  const flagByte = (state.workRam[objOff + 0x58] ?? 0) & 0xff;

  let a4W: number; // A4.w = velocity-X integer part (word, used as signed)
  let localN2: number; // (-0x2,A6).w = velocity-Y integer part (signed word)

  if (flagByte === 0xa) {
    // 0x1c040: clr.w D7; movea.w D7,A4; move.w A4w,(-0x2,A6)
    a4W = 0;
    localN2 = 0;
  } else {
    // 0x1c02e: D0 = *(A2+0).l; D0 = asr.l #4; A4.w = D0.w
    const vx = ru32(state, objOff + 0x00);
    a4W = (i32(vx) >> 4) & 0xffff;
    // 0x1c034: D0 = *(A2+4).l; asr.l #4; (-0x2,A6).w = D0.w
    const vy = ru32(state, objOff + 0x04);
    localN2 = (i32(vy) >> 4) & 0xffff;
  }

  // ─── 0x1c048: |A4| → D2, |localN2| → D6 ──────────────────────────────

  // exg D7,A4; tst.w D7w; exg D7,A4 → bge 0x1c058
  let d2: number; // abs(a4W) as unsigned 16-bit
  if (sx(a4W) < 0) {
    // 0x1c050: moveq 0,D0; move.w A4w,D0w; neg.l D0
    d2 = (-(sx(a4W)) >>> 0) & 0xffff;
  } else {
    // 0x1c058: moveq 0,D0; move.w A4w,D0w
    d2 = a4W & 0xffff;
  }

  let d6: number; // abs(localN2)
  if (sx(localN2) < 0) {
    d6 = (-(sx(localN2)) >>> 0) & 0xffff;
  } else {
    d6 = localN2 & 0xffff;
  }

  // ─── 0x1c076: branch logic ────────────────────────────────────────────

  let d3: number; // rotation magnitude (angle ×7)
  let d4: number; // cos component
  let d5: number; // sin component

  // tst.w D2w; beq 0x1c082; tst.w D6w; bne 0x1c0de
  // → if D2!=0 && D6!=0 → goto 0x1c0de (full atan)
  // → if D2!=0 && D6==0 → goto 0x1c0a4
  // → if D2==0 && D6!=0 → goto 0x1c0a4
  // → if D2==0 && D6==0 → special
  if (d2 === 0 && d6 === 0) {
    // 0x1c082: both zero
    // 0x1c08a: moveq #4,D0; cmp.w (0x400394),D0w; bne 0x1c458
    const gm = ru16(state, GAME_MODE_OFF);
    if (gm !== 4) {
      // bne → skip rotation, go to slot output
      slotOutput(state, rom, objOff);
      return;
    }
    // 0x1c096: moveq #0x10,D0; ...
    localN2 = 0x10;
    d6 = 0x10;
    d2 = 0x10;
    a4W = 0x10;
    // bra 0x1c0de → falls into atan block with d2=d6=0x10
    // We don't set D4/D5 here; they as from the atan block.
    // Fall through to atan block below.
  }

  if (d2 !== 0 && d6 !== 0) {
    // ─── 0x1c0de: full atan path ────────────────────────────────────────
    // cmp.w D6w,D2w; bls 0x1c0f4
    let localNA: number; // (-0xa,A6).w
    if (d2 > d6) {
      // 0x1c0e2: D0 = D6; lsl.l #0xe,D0; D1=D0; divu.w D2w,D1; localNA = D1.w
      const num = (d6 & 0xffff) << 14; // lsl.l #0xe
      localNA = ((num / (d2 & 0xffff)) >>> 0) & 0xffff;
    } else {
      // 0x1c0f4: D0 = D2; lsl.l #0xe,D0; D1=D0; divu.w D6w,D1; localNA = D1.w
      const num = (d2 & 0xffff) << 14;
      localNA = ((num / (d6 & 0xffff)) >>> 0) & 0xffff;
    }

    // 0x1c104: D0 = localNA; mulu.w localNA,D0 → D0.l = localNA²
    // movea.l D0,A1; lsr.l #0xe,D7; D3.w = A1.w + 0x4000
    const sq = mulu(localNA, localNA);
    d3 = (lsr14w(sq) + 0x4000) & 0xffff;

    // jsr FUN_1C61E (lerpFromRom): push D3 as word arg
    d3 = lerpFromRom(rom, d3) & 0xffff;

    // cmp.w D6w,D2w; bls 0x1c14e
    // divu.w D3w,D1 where D1=0x10000000: if quotient > 0xFFFF → overflow, D1 unchanged
    // D1.w = 0x10000000 & 0xffff = 0x0000 when overflow; normal case D1.w = quotient & 0xffff
    if (d2 > d6) {
      // 0x1c130: D1 = 0x10000000; divu.w D3w,D1; D4w = D1.w
      const q4 = d3 !== 0 ? (0x10000000 / (d3 & 0xffff)) >>> 0 : 0; // unsigned division
      d4 = (q4 > 0xffff) ? 0 : (q4 & 0xffff); // overflow → D1 unchanged → D1.w=0
      // mulu D4,localNA; lsr.l #0xe → D5.w
      d5 = lsr14w(mulu(localNA, d4));
    } else {
      // 0x1c14e: D1 = 0x10000000; divu.w D3w,D1; D5w = D1.w
      const q5 = d3 !== 0 ? (0x10000000 / (d3 & 0xffff)) >>> 0 : 0;
      d5 = (q5 > 0xffff) ? 0 : (q5 & 0xffff); // overflow → D1 unchanged → D1.w=0
      // mulu D5,localNA; lsr.l #0xe → D4.w
      d4 = lsr14w(mulu(localNA, d5));
    }

    // 0x1c16a: sign of a4W → neg D4 if a4W >= 0
    // exg D7,A4; tst.w D7; exg D7,A4; blt 0x1c17a
    if (sx(a4W) >= 0) {
      // neg D4
      d4 = (-(sx(d4))) & 0xffff;
    }
    // 0x1c17a: sign of localN2 → neg D5 if localN2 < 0
    if (sx(localN2) < 0) {
      d5 = (-(sx(d5))) & 0xffff;
    }

    // 0x1c188: cmp.w D6w,D2w; bls 0x1c19e
    if (d2 > d6) {
      // mulu D2,D3; lsr.l #0xe → D3.w
      d3 = lsr14w(mulu(d2, d3));
    } else {
      // mulu D6,D3; lsr.l #0xe → D3.w
      d3 = lsr14w(mulu(d6, d3));
    }
    // fall to 0x1c1ae
  } else if (d2 !== 0 || d6 !== 0) {
    // ─── 0x1c0a4: single-axis path ──────────────────────────────────────
    // tst.w D2w; beq 0x1c0b2
    if (d2 !== 0) {
      // 0x1c0a8: move.w #0x4000,D4; D3=D2; D5=0
      d4 = 0x4000;
      d3 = d2;
      d5 = 0;
    } else {
      // 0x1c0b2: D4=0; D3=D6; D5=0x4000
      d4 = 0;
      d3 = d6;
      d5 = 0x4000;
    }

    // 0x1c0ba: sign of a4W → neg D4 if a4W >= 0
    if (sx(a4W) >= 0) {
      d4 = (-(sx(d4))) & 0xffff;
    }
    // 0x1c0ca: sign of localN2 → if < 0: neg D5; bra 0x1c1ae
    if (sx(localN2) < 0) {
      d5 = (-(sx(d5))) & 0xffff;
    }
    // bra 0x1c1ae → fall through
  } else {
    // Both were 0 and gameMode==4: set above, d2=d6=a4W=localN2=0x10
    // Re-enter atan block (done by the if(d2!==0&&d6!==0) branch above)
    // This branch is unreachable because both d2=d6=0x10 after the set.
    d3 = 0; d4 = 0; d5 = 0;
  }

  // ─── 0x1c1ae: D3 / 7 → D6 (rotation speed) ────────────────────────────

  // moveq 0,D0; move.w D3w,D0w; move.l D0,D1; divu.w #7,D1; D6.w = D1.w
  d6 = ((d3 & 0xffff) / 7) & 0xffff;

  // 0x1c1ba: moveq #4,D0; cmp.w (0x400394),D0w; bne 0x1c1d0
  const gm2 = ru16(state, GAME_MODE_OFF);
  if (gm2 === 4) {
    // 0x1c1c4: D0 = 0x600; sub D6; move D0→D6; bge 0x1c1d0; clr D6
    const tmp = (0x600 - (d6 & 0xffff)) & 0xffff;
    d6 = sx(tmp) < 0 ? 0 : tmp;
  }

  // ─── 0x1c1d0: sine/cosine lookup via ROM table @ A3=0x1eda2 ────────────

  const { a1: a1Val, d6cos: d6CosW } = sineInterp(rom, d6);
  // a1Val = sine value (A1.w signed word)
  // d6CosW = cosine value (D6.w after 0x1c244 add, unsigned word)

  // ─── 0x1c248: build 3×3 rotation matrix locals ─────────────────────────

  // D2w = D5² >> 14 (muls since D5 is signed 16)
  const d2m = asr14w(muls(d5, d5));

  // (-0xc,A6) = D4² >> 14
  const localNC = asr14w(muls(d4, d4));

  // A3.w = (A1 * localNC) >> 14 + D2m
  //   move.w A1w,D0w; muls (-0xc),D0; >>14; movea.w D0w,A3; adda.w D2w,A3
  const a3m = ((asr14w(muls(a1Val, localNC)) & 0xffff) + d2m) & 0xffff;

  // D3w = 0x4000 - A1; then D3 = D5*D3>>14; then D3 = D4*D3>>14
  //   move.w #0x4000,D3; sub.w A1,D3; muls D5,D3 >>14; muls D4,D3 >>14
  let d3m = (0x4000 - (a1Val & 0xffff)) & 0xffff;
  d3m = asr14w(muls(d5, d3m));
  const d3Final = asr14w(muls(d4, d3m));

  // (-0xe,A6) = -(D6cos * D4) >> 14   [neg.l first]
  //   move.w D6w,D0w; muls D4w,D0; neg.l D0; >>14
  const localNE = asr14w(i32(-muls(d6CosW, d4)));

  // (-0x18,A6) = D3Final
  const localN18 = d3Final;

  // A4.w = (A1 * D2m) >> 14 + localNC
  const a4m = ((asr14w(muls(a1Val, d2m)) & 0xffff) + localNC) & 0xffff;

  // (-0x10,A6) = (D6cos * D5) >> 14
  const localN10 = asr14w(muls(d6CosW, d5));

  // (-0x16,A6) = -localNE (ext.l, neg.l, take .w)
  const localN16 = (-(sx(localNE))) & 0xffff;

  // (-0x14,A6) = -localN10
  const localN14 = (-(sx(localN10))) & 0xffff;

  // (-0x12,A6) = A1.w
  const localN12 = a1Val;

  // ─── 0x1c2ce: main loop D4=0,1 — transform rotation matrix cols ──────────
  // clr.w D4w → D4=0; addq #1,D4; moveq #2,D0; cmp.w D4w,D0w; bne → loop
  // exits when D4.w = 2 → runs for D4=0 and D4=1 only (2 iterations)

  for (let lp = 0; lp <= 1; lp++) {
    const off2 = lp * 2;

    // Read current with the values
    const localN4 = ru16(state, objOff + 0x74 + off2); // (-0x4,A6)
    const localN6 = ru16(state, objOff + 0x84 + off2); // (-0x6,A6)
    const localN8 = ru16(state, objOff + 0x94 + off2); // (-0x8,A6)

    // Compute new D5: localNE*localN8 + d3Final*localN6 + a3m*localN4 >> 14
    // m68k: add.l D1,D2; add.l D2,D0 → each add wraps at 32 bits
    const sum5 = i32(i32(muls(localNE, localN8) + muls(d3Final, localN6)) + muls(a3m, localN4));
    const newD5 = (sum5 >> 14) & 0xffff;

    // Compute new D6: localN10*localN8 + a4m*localN6 + localN18*localN4 >> 14
    const sum6 = i32(i32(muls(localN10, localN8) + muls(a4m, localN6)) + muls(localN18, localN4));
    const newD6 = (sum6 >> 14) & 0xffff;

    // Compute new D2: localN12*localN8 + localN14*localN6 + localN16*localN4 >> 14
    const sum2 = i32(i32(muls(localN12, localN8) + muls(localN14, localN6)) + muls(localN16, localN4));
    let newD2 = (sum2 >> 14) & 0xffff;

    // 0x1c360: move.b (0xca,A2),D0b; ext.w D0w; cmp.w D4w,D0w; bne 0x1c3d4
    const caB = (state.workRam[objOff + 0xca] ?? 0) & 0xff;
    const caW = (caB << 24 >> 24) & 0xffff; // ext.w from byte

    if (caW === lp) {
      // ─── Normalize if needed ─────────────────────────────────────────
      // Compute D2²+D6²+D5² (all muls.w = signed)
      const sqSum =
        (muls(newD2, newD2) >>> 0) +
        (muls(newD6, newD6) >>> 0) +
        (muls(newD5, newD5) >>> 0);

      // D0 = 0x80000; D1 = D0<<6 = 0x2000000; A1=D1; A1-=D0 → A1=0x1f80000
      // cmpa.l A1,A0 (A0=sqSum): bcs 0x1c39c → if sqSum < 0x1f80000: normalize
      // else: A1 = D0+D1 = 0x2080000; cmpa.l A1,A0; bls → skip → if sqSum > 0x2080000: normalize
      const LO = 0x1f80000;
      const HI = 0x2080000;

      if ((sqSum >>> 0) < LO || (sqSum >>> 0) > HI) {
        // 0x1c39c: A1=sqSum; D7 = sqSum>>14
        const d7w = ((sqSum >>> 0) >>> 14) & 0xffff;
        // D1 = 0x2000000; divu.w D7w,D1 → scale
        // divu overflow: if quotient > 0xFFFF or D7w=0, D1 unchanged → D1.w=0
        let scale: number;
        if (d7w !== 0) {
          const qnorm = (0x2000000 / d7w) >>> 0;
          scale = qnorm > 0xffff ? 0x0000 : (qnorm & 0xffff);
        } else {
          scale = 0x0000; // m68k divu-by-zero: D1 unchanged, D1.w=low16(0x2000000)=0
        }
        // jsr FUN_1C61E(scale)
        const iscale = lerpFromRom(rom, scale) & 0xffff;

        // D5 = iscale*D5>>14; D6 = iscale*D6>>14; D2 = iscale*D2>>14
        const ns5 = asr14w(muls(iscale, newD5));
        const ns6 = asr14w(muls(iscale, newD6));
        const ns2 = asr14w(muls(iscale, newD2));

        wu16(state, objOff + 0x74 + off2, ns5);
        wu16(state, objOff + 0x84 + off2, ns6);
        wu16(state, objOff + 0x94 + off2, ns2);
        continue;
      }
    }

    // 0x1c3d4: store without normalization
    wu16(state, objOff + 0x74 + off2, newD5);
    wu16(state, objOff + 0x84 + off2, newD6);
    wu16(state, objOff + 0x94 + off2, newD2);
  }

  // ─── 0x1c402: expand cols 3..7 from D2/D3 pairs from the 0..3 ──────────

  // lea (0x74,A2),A0; clr.w D4w; loop D4=0: bgt D4<3 (moveq #3, bgt 0x1c408)
  // Each iteration reads 2 words D2/D3 from A0 and writes 6 derived words.
  {
    let aPtr = objOff + 0x74; // A0
    let d4c = 0;
    while (true) {
      const d2c = ru16(state, aPtr); aPtr += 2;
      const d3c = ru16(state, aPtr); aPtr += 2;
      // -D2
      wu16(state, aPtr, (-(sx(d2c))) & 0xffff); aPtr += 2;
      // -D3
      wu16(state, aPtr, (-(sx(d3c))) & 0xffff); aPtr += 2;
      // D3+D2  (move.w D3w,D0w; add.w D2w,D0w)
      wu16(state, aPtr, (sx(d3c) + sx(d2c)) & 0xffff); aPtr += 2;
      // -D2-D3 (move.w D2w,D1w; ext.l D1; neg.l D1 → -D2; move.w D1w,D0w; sub.w D3w,D0w → -D2-D3)
      wu16(state, aPtr, (-(sx(d2c)) - sx(d3c)) & 0xffff); aPtr += 2;
      // D2-D3
      wu16(state, aPtr, (sx(d2c) - sx(d3c)) & 0xffff); aPtr += 2;
      // -D2+D3 (move.w D2w,D1w; neg → -D2; add D3 → -D2+D3)
      wu16(state, aPtr, (-(sx(d2c)) + sx(d3c)) & 0xffff); aPtr += 2;

      d4c++;
      if (d4c > 3) break; // bgt → loop while D4 <= 3, i.e. 4 iterations
    }
  }

  // ─── 0x1c448: increment CA counter (sub-step) ─────────────────────────
  {
    const caOld = (state.workRam[objOff + 0xca] ?? 0) & 0xff;
    const caNew = (caOld + 1) & 0xff;
    state.workRam[objOff + 0xca] = (caNew >= 8) ? 0 : caNew;
  }

  // ─── 0x1c458: slot output section ────────────────────────────────────
  slotOutput(state, rom, objOff);
}

// ─── Slot output (0x1c458..0x1c61c) ───────────────────────────────────────

/**
 * Slot output section: starts at 0x1c458 and is also the jump target
 * from the early-exit (D2==D6==0 && gameMode != 4).
 */
function slotOutput(state: GameState, rom: RomImage, objOff: number): void {
  // 0x1c458: lea (0x1e,A2),A0; move.w (A0),(-0x1a,A6)
  const localN1A = ru16(state, objOff + 0x1e); // base-X (signed word)

  // 0x1c460: move.w (0x20,A2),D6w; andi.w #-1,D6w; addq.w #7,D6w
  const d6Base = (ru16(state, objOff + 0x20) + 7) & 0xffff;

  // 0x1c46e: clr.b D3b
  let d3Type = 0; // 0=normal, 1=type-A, 2=type-B

  // 0x1c470: cmpi.b #8,(0x1a,A2); bne 0x1c49a
  const typeFlag = (state.workRam[objOff + 0x1a] ?? 0) & 0xff;
  if (typeFlag === 8) {
    // movea.l #0x215c6,A1
    // movea.l (0xcc,A2),A0   → A0 = ptr stored at objOff+0xcc (32-bit addr)
    // cmpa.l (A0),A1         → compare A1 to *A0 (long at that address)
    const ccPtrAddr = ru32(state, objOff + 0xcc);
    // ccPtrAddr is a ROM or RAM address. Read the long at that address.
    let targetLong: number;
    if (ccPtrAddr < 0x400000) {
      // ROM address
      targetLong = romU32(rom, ccPtrAddr);
    } else {
      // workRam address
      targetLong = ru32(state, ccPtrAddr - 0x400000);
    }
    if (targetLong === PTR_TYPE_A) {
      d3Type = 1;
    } else {
      // movea.l #0x215ea,A1; movea.l (0xcc,A2),A0; cmpa.l (A0),A1; bne 0x1c49a
      if (targetLong === PTR_TYPE_B) {
        d3Type = 2;
      }
    }
  }

  // ─── 0x1c49a: loop D4=0..7: compute 8 vertex coords ──────────────────

  // buf[8] of 32-bit packed entries: hi16=X (signed), lo16=Y (signed)
  const buf = new Int32Array(8);

  for (let d4v = 0; d4v < 8; d4v++) {
    const off2v = d4v * 2;

    // Read matrix column D4
    const matC0 = ru16(state, objOff + 0x74 + off2v); // A1 = col0[D4]
    const matC1 = ru16(state, objOff + 0x84 + off2v); // A4 = col1[D4]
    let d5v = ru16(state, objOff + 0x94 + off2v);     // D5 = col2[D4]

    // 0x1c4c0: tst.b D3b; beq 0x1c4d8
    if (d3Type !== 0) {
      // cmpi.b #1,D3b; bne 0x1c4d2
      if (d3Type === 1) {
        // move.w D5w,D0w; asr.w #2,D0w; sub.w D0w,D5w → D5 = D5 - (D5>>2) = D5*3/4
        const tmp = (sx(d5v) >> 2) & 0xffff;
        d5v = (d5v - tmp) & 0xffff;
      } else {
        // move.w D5w,D0w; asr.w #1,D0w; add.w D0w,D5w → D5 = D5 + (D5>>1) = D5*3/2
        const tmp = (sx(d5v) >> 1) & 0xffff;
        d5v = (d5v + tmp) & 0xffff;
      }
    }

    // 0x1c4d8: compute X coord
    // D0 = sext(localN1A) << 1 (asl.l #1)
    // D1 = sext(A4) - sext(A1) = matC1 - matC0 (ext.l each, sub.l)
    // D1 = D1 >> 10 (asr.l #0xa)
    // D0 = (D0 + D1) >> 1 (asr.l #1)
    // A0.w = D0.w (movea.w)
    let d0x = i32(sx(localN1A) << 1);
    const d1x = i32(sx(matC1) - sx(matC0)) >> 10;
    d0x = i32(d0x + d1x) >> 1;
    const outX = d0x & 0xffff; // A0.w

    // 0x1c4f4: compute Y coord
    // D0 = sext(d6Base) << 1
    // D1 = sext(D5v)
    // D2 = sext(matC1) + sext(matC0) (A4+A1); D2 >>= 1
    // D1 = D1 - D2
    // D1 >>= 10
    // D0 = (D0 + D1) >> 1
    let d0y = i32(sx(d6Base) << 1);
    let d1y = sx(d5v);
    let d2y = i32(sx(matC1) + sx(matC0));
    d2y = i32(d2y >> 1);
    d1y = i32(d1y - d2y) >> 10;
    d0y = i32(d0y + d1y) >> 1;
    const outY = d0y & 0xffff;

    // 0x1c514: pack: D0=sext(outY)&0xffff, D2=sext(outX)<<16, D0+=D2
    // → packed = (sext(outX)<<16) | (sext(outY)&0xffff)
    const packed = i32((sx(outX) << 16) | (sx(outY) & 0xffff));
    buf[d4v] = packed;
  }

  // ─── 0x1c538: selection sort buf[0..7] by hi16 (X) ascending ─────────

  // D4=0..6; A3=buf[D4]; A0=buf[D4+1]; D2=D4+1..7
  // Each outer iteration: inner loop A0=buf[D4+1..7]
  for (let si = 0; si < 7; si++) {
    // A3 = &buf[si], A0 starts at &buf[si+1]
    for (let sj = si + 1; sj < 8; sj++) {
      // cmp.l: andi.l #-0x10000 → compare hi words as signed longs
      const hiSi = i32(buf[si]! & ~0xffff);
      const hiSj = i32(buf[sj]! & ~0xffff);
      // ble → skip swap (swap if A3_hi > A0_hi)
      if (hiSi > hiSj) {
        const tmp = buf[si]!;
        buf[si] = buf[sj]!;
        buf[sj] = tmp;
      }
    }
  }

  // ─── 0x1c580: output 4 slots (pairs of sorted entries) ───────────────

  // lea (-0x3a,A6),A3 → buf[0]
  // lea (0xa4,A2),A2  → output base
  // D4=0..3: loop bne 0x1c58a (4 iterations)

  const outBase = objOff + 0xa4;

  // A3 walks through buf; initially A3=buf[0].
  // 0x1c58a: A1 = A3; A3+=4; A0 = A1; A3+=4
  // → A0=A1=&buf[D4*2]; then A0 reads: hi16(A)→A1, lo16(A)→A4, hi16(B)→D3, lo16(B)→D6
  // Wait: A0 = old A3 (before +8), A3 moves to buf[(D4+1)*2]?
  // Let me re-read 0x1c58a-0x1c59c:
  //   movea.l A3,A1      → A1 = A3 (= &buf[D4*2])
  //   addq.l #4,A3       → A3 = &buf[D4*2+1]
  //   movea.l A1,A0      → A0 = &buf[D4*2]  (same)
  //   addq.l #4,A3       → A3 = &buf[(D4+1)*2]
  //   movea.w (A0)+,A1   → A1.w = buf[D4*2].hi16 = outX_A; A0 → next word
  //   movea.w (A0)+,A4   → A4.w = buf[D4*2].lo16 = outY_A; A0 → buf[D4*2+1]
  //   move.w (A0)+,D3w   → D3.w = buf[D4*2+1].hi16 = outX_B; A0 →
  //   sub.w A1w,D3w      → D3 = outX_B - outX_A
  //   move.w (A0)+,D6w   → D6.w = buf[D4*2+1].lo16 = outY_B
  //   sub.w A4w,D6w      → D6 = outY_B - outY_A

  for (let d4o = 0; d4o < 4; d4o++) {
    const entA = buf[d4o * 2]!;
    const entB = buf[d4o * 2 + 1]!;

    // hi16 = X, lo16 = Y
    const a1x = (entA >> 16) & 0xffff; // outX_A
    const a4y = entA & 0xffff;         // outY_A
    let d3dx = ((entB >> 16) & 0xffff);
    d3dx = (d3dx - a1x) & 0xffff;     // outX_B - outX_A
    let d6dy = (entB & 0xffff);
    d6dy = (d6dy - a4y) & 0xffff;     // outY_B - outY_A

    // 0x1c59e: moveq #2,D0; cmp.w D3w,D0w; bge 0x1c5a6
    // cmp.w D3w,D0w = D0-D3 = 2-D3; bge → branch if 2>=D3 (D3<=2) → skip moveq
    // → moveq executes only when D3>2 → sets D3=2 (upper-clamp to 2)
    if (sx(d3dx) > 2) {
      d3dx = 2;
    }

    // 0x1c5a6: tst.w D6w; bge 0x1c5b2 → abs(D6) → D5
    let d5abs: number;
    if (sx(d6dy) < 0) {
      // moveq 0,D0; move.w D6w,D0w; neg.l D0 → abs
      d5abs = (-(sx(d6dy)) >>> 0) & 0xffff;
    } else {
      d5abs = d6dy & 0xffff;
    }

    // 0x1c5b8: moveq #0xc,D0; cmp.w D5w,D0w; bge 0x1c5c0
    // cmp.w D5w,D0w = D0-D5 = 0xc-D5; bge → if D5<=0xc → skip moveq
    // → moveq executes when D5>0xc → sets D5=0xc (upper-clamp to 0xc)
    if (d5abs > 0xc) {
      d5abs = 0xc;
    }

    // 0x1c5c0: D0 = sext(D5) << 2; D1 = sext(D3); D2 = sext(D5)
    // D1 = D3 - D5; D0 = (D5<<2) + (D3-D5) → D0 = D5*3 + D3? No:
    // D0 = (D5_signed << 2) = D5*4
    // D1 = D3 - D5
    // D0 = D0 + D1 = D5*4 + D3 - D5 = D5*3 + D3
    // add.w D0w,D0w → *2 → D0 = (D5*3 + D3) * 2
    // → table offset
    let d0idx = i32(sx(d5abs) << 2);
    const d1idx = i32(sx(d3dx) - sx(d5abs));
    d0idx = i32(d0idx + d1idx);
    d0idx = (d0idx * 2) & 0xffff; // add.w D0w,D0w

    const d1Angle = romU16(rom, ROM_ANGLE_BASE + d0idx);

    // 0x1c5de: tst.w D6w; bge 0x1c5ee
    let angleOut = d1Angle;
    let a1xOut = a1x;
    let a4yOut = a4y;

    if (sx(d6dy) < 0) {
      // 0x1c5e2: addi.w #-0x8000,D1w → D1 += 0x8000 (mod 0x10000 = flip bit15)
      angleOut = (d1Angle + 0x8000) & 0xffff;
      // 0x1c5e6: D0 = D3 - 6; adda.w D0,A1 → A1 += (D3-6)
      a1xOut = ((a1x & 0xffff) + ((sx(d3dx) - 6) & 0xffff)) & 0xffff;
      // 0x1c5ec: adda.w D6w,A4 → A4 += D6 (signed word)
      a4yOut = ((a4y & 0xffff) + sx(d6dy)) & 0xffff;
    }

    // 0x1c5ee: move.w A1w,(0x2,A2) → slot.x = A1.w
    wu16(state, outBase + d4o * 6 + 2, a1xOut);

    // 0x1c5f2: D0 = D5; ROM[0x24b2c + D5] = offset-Y byte; ext.w; add A4 → slot.y
    const offY = romU8(rom, ROM_OFFY_BASE + (d5abs & 0xffff));
    const offYExt = (offY << 24 >> 24) & 0xffff; // ext.w from byte
    const slotY = (sx(offYExt) + sx(a4yOut)) & 0xffff;
    wu16(state, outBase + d4o * 6 + 4, slotY);

    // 0x1c60a: move.w D1w,(A1) → store angle first (A1 → movea.l A2,A1 → base slot)
    wu16(state, outBase + d4o * 6 + 0, angleOut);
  }
}
