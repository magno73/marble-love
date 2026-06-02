/**
 * Port of ROM routine `FUN_00013ADE`.
 *
 * Called from `FUN_000253EC`, this helper emits up to eight orbital sprite
 * records for one slot. It advances a modulo-402 angle, samples the ROM
 * sin/cos table at `0x1EDA2`, applies signed tile deltas from `0x1EF32`, clips
 * each point to the visible range, and writes records as
 * `[charcode.w = iter + 0x10B, x.w, y.w]`.
 *
 * Destination mirrors `FUN_00013D38`: emit indices 0..3 write at `A0+0xA4`,
 * while indices 4..7 write at `A0+0x38`. The quadrant lookup intentionally
 * follows the ROM's four hand-written table branches.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const WORK_RAM_BASE = 0x400000 as const;

/** ROM address of the sin/cos table, word-indexed. */
const SINCOS_TABLE_ROM = 0x1eda2 as const;

/** ROM address of the signed tile-delta stream, consumed in pairs. */
const DELTA_STREAM_ROM = 0x1ef32 as const;

/** Offsets in the A0 record. */
const ARG_READY_BYTE_OFF = 0x1c; // byte: scritto = 1 in epilogue
const ARG_COORDS_LONG_OFF = 0x1e; // long: hi word = ref-X, lo word = ref-Y
const ARG_MIRROR_BYTE_OFF = 0x1a; // byte: == 0x0B → mirror D1 = 0x24 - D1
const ARG_ANGLE_WORD_OFF = 0x2e;
const ARG_OUT_2ND_HALF_OFF = 0x38; // 4 record da 6 byte (emit index 4..7)
const ARG_OUT_1ST_HALF_OFF = 0xa4; // 4 record da 6 byte (emit index 0..3)
const ARG_COUNTER_BYTE_OFF = 0x57; // byte: counter decrementato each call

const HALF_RECORDS = 4 as const;
/** Emitted record stride (6 bytes = 3 words). */
const RECORD_STRIDE = 6 as const;
/** Offset charcode base: iter + 0x10B. */
const CHARCODE_BASE = 0x10b as const;
/**
 */
const ITER_COUNT = 8 as const;
const ANGLE_STEP = 0x32 as const;
const ANGLE_MODULO = 0x192 as const;
/** Angle advance per call (0x0A). */
const ANGLE_ADVANCE = 0x0a as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

function readU16Rom(rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  return (((rom.program[a] ?? 0) << 8) | (rom.program[a + 1] ?? 0)) & 0xffff;
}

/** Signed ROM word read, mirroring `move.w (idx,A2), Dn; ext.l Dn`. */
function readS16Rom(rom: RomImage, addr: number): number {
  const u = readU16Rom(rom, addr);
  return ((u << 16) >> 16) | 0;
}

function readU32Ram(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function writeU16Ram(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

/** sign-extend word (16-bit) → int32. */
function sextWord(v: number): number {
  return ((v & 0xffff) << 16) >> 16;
}

/** sign-extend byte (8-bit) → int32. */
function sextByte(v: number): number {
  const b = v & 0xff;
  return b < 0x80 ? b : b - 0x100;
}

/**
 *
 *
 *   Q0 (0..0x64):         cos = tbl[D3],        sin = tbl[0x64-D3]
 *   Q1 (0x65..0xC8):      cos = -tbl[0xC8-D3],  sin = tbl[D3-0x64]
 *   Q2 (0xC9..0x12D):     cos = -tbl[D3-0xC9],  sin = -tbl[0x12D-D3]
 *   Q3 (0x12E..0x191):    cos = tbl[0x191-D3],  sin = -tbl[D3-0x12D]
 *
 */
function lookupSinCos(
  rom: RomImage,
  d3w: number,
): { d2w: number; d4w: number } {
  const d3 = d3w & 0xffff;

  let d2: number; // cos
  let d4: number; // sin

  if (d3 <= 0x64) {
    // Q0: D3 ≤ 0x64
    // cos: move.w D3w,D0w; ext.l D0; add.l D0,D0; tbl[D0]
    d2 = readS16Rom(rom, SINCOS_TABLE_ROM + d3 * 2);
    // sin: moveq 0x64,D0; ext.l D1(=D3w); sub.l D1,D0; add.l D0,D0; tbl[D0]
    d4 = readS16Rom(rom, SINCOS_TABLE_ROM + (0x64 - d3) * 2);
  } else if (d3 <= 0xc8) {
    // Q1: 0x65 ≤ D3 ≤ 0xC8
    // cos: move.l #0xc8,D1; D0=D3; sub.l D0,D1; D0=D1; add.l D0,D0; tbl[D0]; neg
    const cosIdx = 0xc8 - d3;
    const cosRaw = readS16Rom(rom, SINCOS_TABLE_ROM + cosIdx * 2);
    d2 = (-cosRaw) & 0xffff; // neg.l D0; move.w D0w,D2w
    // sin: D0=D3; ext.l D0; moveq 0x64,D1; sub.l D1,D0; add.l D0,D0; tbl[D0]
    const sinIdx = d3 - 0x64;
    d4 = readS16Rom(rom, SINCOS_TABLE_ROM + sinIdx * 2);
  } else if (d3 <= 0x12d) {
    // Q2: 0xC9 ≤ D3 ≤ 0x12D
    // cos: D1=D3; ext.l; subi.l #0xC9; D0=D1; add.l; tbl[D0]; neg
    const cosIdx = d3 - 0xc9;
    const cosRaw = readS16Rom(rom, SINCOS_TABLE_ROM + cosIdx * 2);
    d2 = (-cosRaw) & 0xffff;
    // sin: move.l #0x12D,D1; D0=D3; ext.l; sub.l D0,D1; D0=D1; add.l; tbl[D0]; neg
    const sinIdx = 0x12d - d3;
    const sinRaw = readS16Rom(rom, SINCOS_TABLE_ROM + sinIdx * 2);
    d4 = (-sinRaw) & 0xffff;
  } else {
    // Q3: 0x12E ≤ D3 ≤ 0x191
    // cos: move.l #0x191,D0; D1=D3; ext.l; sub.l D1,D0; add.l D0,D0; tbl[D0]
    const cosIdx = 0x191 - d3;
    d2 = readS16Rom(rom, SINCOS_TABLE_ROM + cosIdx * 2);
    // sin: D1=D3; ext.l; subi.l #0x12D,D1; D0=D1; add.l; tbl[D0]; neg
    const sinIdx = d3 - 0x12d;
    const sinRaw = readS16Rom(rom, SINCOS_TABLE_ROM + sinIdx * 2);
    d4 = (-sinRaw) & 0xffff;
  }

  return { d2w: d2 & 0xffff, d4w: d4 & 0xffff };
}

/**
 * Emits the circular trajectory records for `argPtr`.
 *
 * @param state   GameState. Modifica `workRam` su:
 *                - `(argPtr+0x57).b` decrement (with optional reset trigger)
 *                - `(argPtr+0x1c).b = 1`
 *                - up to 4 record × 6 byte @ `(argPtr+0xA4)..(argPtr+0xBB)`
 *                - up to 4 record × 6 byte @ `(argPtr+0x38)..(argPtr+0x4F)`
 * @param rom     ROM image (per sin/cos table @ `0x1EDA2` and delta stream
 *                @ `0x1EF32`).
 * @param argPtr  Long pushato from the caller. MUST be in work RAM
 *                (`0x400000..0x401FFF`).
 */
export function objectOrbitEmit13ADE(
  state: GameState,
  rom: RomImage,
  argPtr: number,
): number {
  const a0 = argPtr >>> 0;
  const argOff = (a0 - WORK_RAM_BASE) >>> 0;

  // ── Counter reset triggers ──────────────────────────────────────────
  let d1b = state.workRam[argOff + ARG_COUNTER_BYTE_OFF] ?? 0;
  const d1wSext = sextByte(d1b); // ext.w D1w (sign-extend byte → word)

  if (d1wSext === 0x64) {
    state.workRam[argOff + ARG_COUNTER_BYTE_OFF] = 0x30;
    writeU16Ram(state, argOff + ARG_ANGLE_WORD_OFF, 0);
  } else if (d1wSext === 0x65) {
    state.workRam[argOff + ARG_COUNTER_BYTE_OFF] = 0x18;
    writeU16Ram(state, argOff + ARG_ANGLE_WORD_OFF, 0);
  } else if (d1wSext === 0x66) {
    state.workRam[argOff + ARG_COUNTER_BYTE_OFF] = 0x24;
    writeU16Ram(state, argOff + ARG_ANGLE_WORD_OFF, 0);
  }

  // move.b (0x57,A0),D1b; ext.w D1w  <- rereads (may have changed)
  d1b = state.workRam[argOff + ARG_COUNTER_BYTE_OFF] ?? 0;
  let d1w = sextByte(d1b) & 0xffff; // ext.w → word

  // subq.b #0x1,(0x57,A0) ← decrement (modulo 256)
  state.workRam[argOff + ARG_COUNTER_BYTE_OFF] = (d1b - 1) & 0xff;

  // cmpi.b #0xB,(0x1A,A0); mirror if == 11
  const mirrorByte = state.workRam[argOff + ARG_MIRROR_BYTE_OFF] ?? 0;
  if ((mirrorByte & 0xff) === 0x0b) {
    // moveq 0x24,D2; sub.w D1w,D2w; move.w D2w,D1w
    d1w = (0x24 - d1w) & 0xffff;
  }

  const frameMinusA = d1w; // move.w D1w,(-0xa,A6)

  const d6w = (sextWord(d1w) >> 1) & 0xffff;

  // ── Angle: advance by 0x0A and wrap at 0x192 ───────────────────────
  let d3w = (
    ((state.workRam[argOff + ARG_ANGLE_WORD_OFF] ?? 0) << 8) |
    (state.workRam[argOff + ARG_ANGLE_WORD_OFF + 1] ?? 0)
  ) & 0xffff;
  d3w = (d3w + ANGLE_ADVANCE) & 0xffff;
  if (d3w >= ANGLE_MODULO) d3w = (d3w - ANGLE_MODULO) & 0xffff;
  writeU16Ram(state, argOff + ARG_ANGLE_WORD_OFF, d3w);

  // movea.l #0x1ef32,A4  (stream ptr handled as ROM index)
  let a4 = DELTA_STREAM_ROM >>> 0;

  const coordsLong = readU32Ram(state, argOff + ARG_COORDS_LONG_OFF);
  // move.l D2,D0; moveq 0x10,D1; asr.l D1,D0 → signed right shift 16
  const frameMinusEight = (coordsLong >>> 16) & 0xffff; // high word (signed via asr.l)
  // then move.w D0w,(-0x8,A6) saves only the word → save as uint16
  const frameMinusFour = coordsLong & 0xffff; // low word

  for (let k = 0; k < HALF_RECORDS; k++) {
    writeU16Ram(state, argOff + ARG_OUT_2ND_HALF_OFF + k * RECORD_STRIDE, 0);
    writeU16Ram(state, argOff + ARG_OUT_1ST_HALF_OFF + k * RECORD_STRIDE, 0);
  }

  let emitIndex = 0; // (-0x6, A6)
  let iterCtr = 0;  // (-0x2, A6)

  while (iterCtr < ITER_COUNT) {
    // ── Sin/cos lookup ────────────────────────────────────────────
    const { d2w, d4w } = lookupSinCos(rom, d3w);

    // ── muls.w + asr.l #0xC (shift-by-12 = /4096) ────────────────
    // cosScaled = (D6w * D2w) >> 12 (signed multiply → long → asr.l #0xC)
    // A1w = low word of cosScaled (used as signed word)
    const cosLong = (sextWord(d6w) * sextWord(d2w)) | 0;
    const cosScaledLong = cosLong >> 12; // asr.l #0xC
    const a1w = cosScaledLong & 0xffff; // movea.w D0w,A1 → low word

    // sinScaled = (D6w * D4w) >> 12
    const sinLong = (sextWord(d6w) * sextWord(d4w)) | 0;
    const sinScaledLong = sinLong >> 12; // asr.l #0xC
    const d0w = sinScaledLong & 0xffff; // move.w D0w → D0w post-asr

    // ── Read tile deltas from stream ──────────────────────────────
    const tileDx = sextByte(rom.program[a4] ?? 0); // move.b (A4)+,D4b; ext.w
    a4 = (a4 + 1) >>> 0;
    const tileDy = sextByte(rom.program[a4] ?? 0); // move.b (A4)+,D5b; ext.w
    a4 = (a4 + 1) >>> 0;

    // ── Compute x ────────────────────────────────────────────────
    // D2w = D0w(sinScaled) + frame[-8] - A1w
    // D4w(tile) + D2w → x_out
    // Disasm:
    //   move.w D0w,D2w                 ; D2 = sin_scaled
    //   add.w (-0x8,A6),D2w            ; D2 += frame[-8]
    //   sub.w A1w,D2w                  ; D2 -= cos_scaled
    //   add.w D2w,D4w                  ; D4 = tile_dx + D2 → x_out
    let d2wX = (sextWord(d0w) + sextWord(frameMinusEight) - sextWord(a1w)) & 0xffff;
    const xOut = (sextWord(tileDx & 0xffff) + sextWord(d2wX)) & 0xffff;

    // ── Compute y ─────────────────────────────────────────────────
    // D2w = frame[-A] + frame[-4]     (sum)
    // avg_long = (sin_scaled_long + cos_scaled_long) >> 1 (asr.l #1, signed)
    // D2w -= avg_long.w
    // y_out = D5w + D2w
    // Disasm:
    //   move.w (-0xa,A6),D2w           ; D2 = frame[-A] = D1 (radius-like)
    //   add.w (-0x4,A6),D2w            ; D2 += frame[-4] = low word of coords
    //   move.w D0w,D1w; ext.l D1       ; D1 = sext_l(sin_scaled)
    //   move.w A1w,D0w; ext.l D0       ; D0 = sext_l(cos_scaled)
    //   add.l D0,D1                    ; D1 = sin_long + cos_long
    //   asr.l #0x1,D1                  ; D1 >>= 1 (avg)
    //   move.w D1w,D0w                 ; D0w = avg.w
    //   sub.w D0w,D2w                  ; D2 -= avg.w
    //   add.w D2w,D5w                  ; D5 = tile_dy + D2 → y_out
    const sumLong = (sinScaledLong + cosScaledLong) | 0; // add.l (signed)
    const avgLong = sumLong >> 1; // asr.l #1
    const avgW = avgLong & 0xffff; // move.w D1w,D0w
    let d2wY = (sextWord(frameMinusA) + sextWord(frameMinusFour) - sextWord(avgW)) & 0xffff;
    const yOut = (tileDy + sextWord(d2wY)) & 0xffff;

    // ── Bounds check ─────────────────────────────────────────────
    // Disasm: skip (goto epilogue) when:
    //   cmp.w D4w,D0w(-8); bge → branch if -8 >= x_out → skip when x_out <= -8
    //   cmpi.w #0x120,D4w; bge → skip when x_out >= 0x120
    //   cmp.w D5w,D0w(-8); bge → skip when y_out <= -8
    //   cmpi.w #0xF0,D5w; bge  → skip when y_out >= 0xF0
    // Keep (emit) when: x_out > -8 AND x_out < 0x120 AND y_out > -8 AND y_out < 0xF0
    const xS = sextWord(xOut);
    const yS = sextWord(yOut);
    const inRange =
      xS > -8 && xS < 0x120 && yS > -8 && yS < 0xf0;

    if (inRange) {
      let destOff: number;
      if (emitIndex < HALF_RECORDS) {
        destOff = argOff + ARG_OUT_1ST_HALF_OFF + emitIndex * RECORD_STRIDE;
      } else {
        destOff =
          argOff + ARG_OUT_2ND_HALF_OFF + (emitIndex - HALF_RECORDS) * RECORD_STRIDE;
      }
      emitIndex++;

      // charcode = iterCtr + 0x10B
      writeU16Ram(state, destOff, (iterCtr + CHARCODE_BASE) & 0xffff);
      writeU16Ram(state, destOff + 2, xOut);
      writeU16Ram(state, destOff + 4, yOut);
    }

    d3w = (d3w + ANGLE_STEP) & 0xffff;
    if (d3w >= ANGLE_MODULO) d3w = (d3w - ANGLE_MODULO) & 0xffff;

    iterCtr++;
    // bgt: `moveq 0x8,D0; cmp.w iter,D0w; bgt loop_top`
    // → loop while 8 > iter → iter ∈ [0..7], 8 iters total
  }

  // ── Epilogue ──────────────────────────────────────────────────────
  state.workRam[argOff + ARG_READY_BYTE_OFF] = 0x01;

  // moveq #0,D0; tst.b (0x57,A0); seq D0b; neg.b D0b
  const counterPost = state.workRam[argOff + ARG_COUNTER_BYTE_OFF] ?? 0;
  return counterPost === 0 ? 0x00000001 : 0x00000000;
}
