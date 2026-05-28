/**
 * score-table-update-4790.ts - replica `FUN_00004790`.
 *
 * Processes timer-delta accumulators at 0x401F86 and 0x401F8A, then applies a
 * decay pass when any score-table cell wraps.
 *
 *   A4 = 0x5236 = `setFlagBit` (FUN_00005236, event-flags)
 *   A3 = 0x4442 = sound command dispatcher (FUN_00004442)
 *   A1/D6 = 0x40D8 = config-field fetch (FUN_000040D8)
 *   JSR 0x43D6 = `timerDeltaAccumulate` (FUN_000043D6)
 *   ROM[0x1006F] = config byte (max-records count + field selectors)
 *   ROM[0x7974]  = small lookup table (4 entries; selector = (ROM[0x1006F]>>3)&3)
 *   0x401FFC     = long pointer to the base structure (work RAM)
 *
 *   A6+0x08 = arg1 (D4) - primary score delta (long)
 *   A6+0x0C = arg2 (D2) - row-index cap (long)
 *
 * **Locals @ A6-1..A6-16**:
 *   -0x1  count1     : byte, counts processed entries
 *   -0x3  romByte2   : byte = ROM[0x1006F] (second read, for local[-4])
 *   -0x4/-0x5 word2  : word = (sign_ext(ROM[0x1006F]) >> 5) & 7
 *   -0x5  romByte1   : byte = ROM[0x1006F] (first read, for local[-6])
 *   -0x6  numRec     : word = sign_ext(ROM[0x1006F]) & 7  (numRecords)
 *   -0x7  tblByte    : byte = ROM[0x7974 + ((ROM[0x1006F]>>3)&3)]
 *   -0x8  divisorW   : word = sign_ext(tblByte) * 0x3C (= tblByte * 60, 16-bit)
 *   -0xC  basePtr    : long = *0x401FFC + 0x50  (record base, workRam-relative)
 *
 *
 */

import type { GameState } from "./state.js";
import { timerDeltaAccumulate } from "./timer-delta.js";
import { setFlagBit } from "./event-flags.js";

// ─── Layout Constants ───────────────────────────────────────────────────────

/** Work RAM offset of `*0x401FFC` (long pointer to the base struct). */
const PTR_FFC_OFF = 0x1ffc;

/** Offset from the long pointer to the records base: `A0 += 0x50`. */
const RECORD_BASE_PLUS = 0x50;

const SCORE_ACCUM_ADDR = 0x00401f92 as const;

/** Work RAM offset of the score accumulator. */
const SCORE_ACCUM_OFF = SCORE_ACCUM_OFF_CALC();
function SCORE_ACCUM_OFF_CALC(): number { return SCORE_ACCUM_ADDR - 0x400000; }

const CELL_WRAP_SENTINEL = 0xff;

const COL_CLAMP_MAX = 0x11;

/** Divisor multiplier constant: 0x3C = 60. */
const DIVISOR_MUL = 0x3c;

/** Score-wrap threshold: accum >= 0xE10 (3600 decimal). */
const SCORE_WRAP_THRESHOLD = 0xe10;

const SCORE_FIELD_OFF = 0x12; // 18

/** Adjustment for `subi.w #0x12, D0w`, returning to the row*20 base. */
const SCORE_FIELD_ADJ = 0x12;

const ROW_INDEX_DIV = 0x0a;

/** Addend +6 for setFlagBit (row*2 + 6 / row*2 + 7). */
const FLAG_BIT_OFFSET = 6;

// ─── Helpers ────────────────────────────────────────────────────────────────

function readU32(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

function writeU32(r: Uint8Array, off: number, v: number): void {
  const x = v >>> 0;
  r[off] = (x >>> 24) & 0xff;
  r[off + 1] = (x >>> 16) & 0xff;
  r[off + 2] = (x >>> 8) & 0xff;
  r[off + 3] = x & 0xff;
}

// ─── Subroutine Injection Types ─────────────────────────────────────────────

/**
 * Signature of the sound-command dispatcher (FUN_00004442 via A3).
 */
export type SoundDispatch = (cmdIndex: number, data: number) => number;

/**
 * Signature of the config-field fetch (FUN_000040D8 via D6/A5).
 */
export type FieldFetch40D8 = (state: GameState, fieldId: number) => number;

// ─── Subs container ─────────────────────────────────────────────────────────

export interface ScoreTableUpdate4790Subs {
  /**
   *   - second read: `(sign_ext >> 5) & 7`, the col-offset threshold (local[-4])
   * Marble Madness program ROM uses `0xE3`.
   */
  romByte1006F?: number;

  /**
   * ROM 4-byte lookup table @ 0x7974. Index = `(ROM[0x1006F]>>3) & 3`.
   * This yields a divisor of 300 for the Marble Madness ROM.
   */
  romTable7974?: readonly [number, number, number, number];

  /**
   *   - cmdIndex = 5 for score field 5 (A6+8 = arg1)
   *   - cmdIndex = 6 for score field 6 (A2+4)
   *   - cmdIndex = 7 for bonus field @ A6+18
   *   - cmdIndex = 8 for bonus field @ A6+1C
   *   - cmdIndex = 9 for bonus field @ A6+20
   */
  soundDispatch?: SoundDispatch;

  /**
   * Project-specific field fetch. Default = () => 0.
   */
  fieldFetch40D8?: FieldFetch40D8;
}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 *
 *
 * @param r          work RAM
 * @param baseOff    work RAM offset of the record base (= *0x401FFC + 0x50 - 0x400000)
 * @param divisorW   local[-8].word = tblByte * 60
 * @param colThresh  local[-4].word = (sign_ext(ROM[0x1006F]) >> 5) & 7
 * @param numRecW    local[-6].word = ROM[0x1006F] & 7 (numRecords)
 * @param count1     { value: byte } local[-1], mutated in place
 * @param flag2      { value: byte } local[-2], mutated in place
 * @param setFlagFn  callback for setFlagBit (0x5236)
 *                   or -1 when the entry is skipped
 */
function processEntry(
  r: Uint8Array,
  state: GameState,
  baseOff: number,
  deltaVal: number,
  scoreDelta: number,
  divisorW: number,
  colThresh: number,
  numRecW: number,
  rowCap: number,
  count1: { value: number },
  flag2: { value: number },
  setFlagFn: (st: GameState, bit: number) => void,
): { rowPair: number; skipped: boolean } {
  const SKIP = { rowPair: 0, skipped: true };

  // tst.w (-0x6,A6): numRecords; beq skips the entry.
  if ((numRecW & 0xffff) === 0) return SKIP;

  // divu.w local[-8], D1 with D1 = deltaVal.
  // Replicate `divu.w` (unsigned 32-bit / 16-bit word -> 16-bit quotient).
  let colA0 = 0;
  if (divisorW !== 0) {
    // divu.w: D1 / divisorW.w (unsigned)
    const quotD1 = Math.floor((deltaVal >>> 0) / (divisorW & 0xffff));
    // movea.w D1w, A0 -> A0 = quotient word zero-ext.
    const a0Quot = quotD1 & 0xffff;
    // cmpa.w (-0x4,A6), A0 compares A0.w with colThresh.w.
    // bcc: if A0.w >= colThresh unsigned, subtract colThresh; otherwise A0 = 0.
    if (a0Quot < (colThresh & 0xffff)) {
      colA0 = 0;
    } else {
      colA0 = (a0Quot - (colThresh & 0xffff)) & 0xffff;
    }
  }

  // Clamp colA0 to max 0x11 (17).
  // moveq 0x11,D0; cmp.w A0w,D0w; bcc ok else D7=0x11,A0=D7
  if (colA0 > COL_CLAMP_MAX) colA0 = COL_CLAMP_MAX;

  // cmp.l D2, numRecW: if numRecW > rowCap (unsigned), skip; else D2 = numRecW-1.
  let rowD2 = rowCap >>> 0;
  const numRecU = numRecW & 0xffff;
  if (numRecU <= rowD2) {
    rowD2 = (numRecU - 1) & 0xffffffff;
  }

  // ── D5 = rowD2*20 + colA0 ────────────────────────────────────────────
  // asl.w #2, D5w -> *4; save D0; asl.w #2 -> *4 more (=*16); add D0 -> *20; add A0.
  const d5 = ((((rowD2 & 0xffff) * 20) & 0xffff) + colA0) & 0xffff;

  // ── addq.b #1, base[d5] ──────────────────────────────────────────────
  const cellOff = (baseOff + d5) | 0;
  const prev = (r[cellOff] ?? 0) & 0xff;
  const next = (prev + 1) & 0xff;
  r[cellOff] = next;
  // tst.b: if next == 0, count wrapped; set 0xFF and raise flag2.
  if (next === 0) {
    r[cellOff] = CELL_WRAP_SENTINEL;
    flag2.value = 1;
  }

  // ── count1++ ─────────────────────────────────────────────────────────
  count1.value = (count1.value + 1) & 0xff;

  // ── D5' = row*20 + 18 (score field offset) ───────────────────────────
  // move.w D5w, D0w; sub.w A0w, D0w -> D5 - colA0 = row*20.
  // addi.w #0x12, D0w -> row*20 + 18.
  const d5prime = ((d5 - colA0) + SCORE_FIELD_OFF) & 0xffff;

  // ── D4.w = (scoreDelta + 0x80) >> 8 (round-nearest of scoreDelta/256) ──
  // move.l D4,D0; addi.l #0x80,D0; lsr.l #0x8,D0; move.w D0w,D4w
  const scoreRounded = (((scoreDelta >>> 0) + 0x80) >>> 8) & 0xffff;

  // base[d5'+1] -> D1.b; base[d5'] -> D2.b; D2 <<= 8; D1 |= D2.
  const scoreOff = (baseOff + d5prime) | 0;
  const existHi = (r[scoreOff] ?? 0) & 0xff;
  const existLo = (r[scoreOff + 1] ?? 0) & 0xff;
  const existScore = ((existHi << 8) | existLo) >>> 0;

  // ── cmp.l D1, D0: if D0 <= D1 (unsigned), skip write ─────────────────
  // D0 = scoreRounded (long zero-ext from word), D1 = existScore (BE word)
  if ((scoreRounded >>> 0) > (existScore >>> 0)) {
    // move.w D4w,D1w; lsr.w #8,D1w; move.b D1b,(base+d5')
    r[scoreOff] = (scoreRounded >>> 8) & 0xff;
    // move.b D4b,D1b; andi.b #-0x1,D1b; move.b D1b,(base+d5'+1)
    r[scoreOff + 1] = scoreRounded & 0xff;
  }

  // move.w D5w,D0w; subi.w #0x12,D0w -> D0 = row*20.
  // ext.l D1; divs.w #0xa,D1 -> D1.w = row*20 / 10 = row*2.
  const rowBase = (d5prime - SCORE_FIELD_ADJ) & 0xffff;
  // divs.w #0xa: signed 32/16, replicated for small values (no overflow possible)
  const rowPair = Math.trunc(rowBase / ROW_INDEX_DIV) & 0xffff;

  // ── setFlagBit(rowPair + 6) and setFlagBit(rowPair + 7) ──────────────
  setFlagFn(state, (rowPair + FLAG_BIT_OFFSET) >>> 0);
  setFlagFn(state, (rowPair + FLAG_BIT_OFFSET + 1) >>> 0);

  return { rowPair, skipped: false };
}

/**
 *
 *
 * @param state      GameState. Reads/writes work RAM:
 *                   - 0x401FFC..0x1FFF (long ptr)
 *                   - 0x401F86..0x401F8B (two timer-delta accumulators)
 *                   - 0x401F92..0x401F95 (total score accumulator)
 *                   - 0x401F5E..0x401F61 (status flag bitmap, via setFlagBit)
 * @param arg1       Primary score delta (D4, arg @ A6+8).
 * @param arg3       Secondary score delta (D3, arg @ A6+10).
 * @param arg4       Running-max row cap (arg @ A6+14), similar to arg2 but
 *                   applied to the second timer-delta entry.
 *
 *                   `movem.l (SP)+,{...}; unlk; rts` does not set D0 explicitly).
 *
 *
 * 1. `timerDeltaAccumulate(state, 0)` mirrors `clr.l -(SP); jsr 0x43D6`.
 *    It clears the consumed accumulators (`clr.l (A2)` at 0x4852 and 0x49AA).
 *
 * 2. The divisor follows M68k word semantics: `(tblByte * 60) & 0xffff`.
 *
 * 3. When a cell wraps, the decay pass walks all table cells and applies
 *    `lsr.b #1` to each one (logical byte right shift).
 *
 * 4. The "score wrap" blocks (@ 0x4B3E..0x4B88 and 0x4B89..0x4BC1) add
 *    `savedDelta` to the accumulator @ 0x401F92, then when >= 0xE10 (3600)
 *    subtract the wrapped multiple. The second long (A2+4) follows the same idea.
 *
 *    `pea cmdIdx; jsr D6(=40D8); D0=ret; addq +1; D0+bonus; pea sum; pea cmdIdx; jsr A3`.
 */
export function scoreTableUpdate4790(
  state: GameState,
  arg1: number,   // D4 = primary score delta
  arg2: number,
  arg3: number,   // D3 = secondary score delta
  arg4: number,   // A6+14 = second row cap
  arg5: number,   // A6+18 = bonus field 7
  arg6: number,   // A6+1C = bonus field 8
  arg7: number,   // A6+20 = bonus field 9
  subs: ScoreTableUpdate4790Subs = {},
): void {
  const r = state.workRam;

  // ── Normalize args to unsigned longs ─────────────────────────────────────
  let d4 = arg1 >>> 0;     // primary score delta
  let d2 = arg2 >>> 0;     // row cap
  const d3 = arg3 >>> 0;   // secondary score delta
  const a6_14 = arg4 >>> 0;
  const a6_18 = arg5 >>> 0;
  const a6_1c = arg6 >>> 0;
  const a6_20 = arg7 >>> 0;

  // move.b (0x1006F).l, (-0x5,A6)
  const romB = (subs.romByte1006F ?? 0xe3) & 0xff;
  const tbl7974: readonly [number, number, number, number] =
    subs.romTable7974 ?? [0x05, 0x05, 0x05, 0x05];

  // local[-6].word = sign_ext(romB) & 7 = romB & 7  (numRecords)
  // M68k: ext.w (sign byte to word), then andi.w #7.
  // sign_ext byte: (romB & 0x80) ? (romB | 0xFFFFFF00) : romB; & 7 = romB & 7.
  const numRecW = romB & 0x7; // 0..7

  // local[-7] = ROM[0x7974 + ((romB >> 3) & 3)]
  const tblIdx = (romB >>> 3) & 3;
  const tblByte = tbl7974[tblIdx]! & 0xff;

  // local[-8].word = sign_ext(tblByte) * 0x3C (mulu.w, word)
  // M68k: ext.w sign_ext(tblByte), then mulu.w #0x3C.
  // sign_ext byte to word, then mulu.w (unsigned word * imm) yields a 32-bit result.
  // Effectively divisorW = ((tblByte as int8) * 60) & 0xffff.
  const tblByteSigned = (tblByte & 0x80) ? (tblByte - 0x100) : tblByte;
  const divisorW = (tblByteSigned * DIVISOR_MUL) & 0xffff;

  // local[-4].word = (sign_ext(romB) >> 5) & 7  (asr.w #5, andi.w #7)
  // sign_ext byte romB to int16, arithmetic shift right 5, then & 7.
  const romBSigned16 = (romB & 0x80) ? (romB | 0xff00) : romB;
  // arithmetic right shift 5 of 16-bit signed:
  const colThresh = ((romBSigned16 >> 5) & 0x7) & 0xffff; // 0..7

  // ── base = *0x401FFC + 0x50 (workRam offset) ─────────────────────────────
  const ptrFFC = readU32(r, PTR_FFC_OFF);
  const baseAbsAddr = (ptrFFC + RECORD_BASE_PLUS) >>> 0;
  const baseOff = (baseAbsAddr - 0x400000) | 0;

  // ── timerDeltaAccumulate(state, 0) → A2 = 0x401F86 ──────────────────────
  // clr.l -(SP); jsr 0x43D6; movea.l D0,A2
  const a2Abs = timerDeltaAccumulate(state, 0); // = 0x401F86
  const a2Off = a2Abs - 0x400000; // = 0x1F86

  // ── Mutable locals ────────────────────────────────────────────────────────
  let count1 = 0; // local[-1]
  let flag2 = 0;  // local[-2]

  // move.l (A2), local[-10]; addq #4,SP; beq 0x496E
  const savedDelta1 = readU32(r, a2Off);
  if (savedDelta1 !== 0) {
    // addq.b #1,(-0x1,A6); clr.l (A2)
    count1 = (count1 + 1) & 0xff;
    writeU32(r, a2Off, 0);

    const c1 = { value: count1 };
    const f2 = { value: flag2 };
    processEntry(
      r, state, baseOff, savedDelta1, d4,
      divisorW, colThresh, numRecW, d2,
      c1, f2, setFlagBit,
    );
    count1 = c1.value;
    flag2 = f2.value;
  }

  // 0x496e: addq #4, A2 -> A2 = 0x401F8A.
  const a2bOff = a2Off + 4; // 0x1F8A

  // ── Second entry (A2+4 = 0x401F8A) ───────────────────────────────────────
  // tst.l (A2+4); beq 0x4AAC
  const nextVal = readU32(r, a2bOff);
  if (nextVal !== 0) {
    // addq.b #1,(-0x1,A6)
    count1 = (count1 + 1) & 0xff;

    // move.l (-0x10,A6),D7; add.l (A2),D7; move.l D7,(-0x10,A6)
    // local[-16] accumulates; the second entry reuses savedDelta1 + nextVal.
    const savedDelta2 = (savedDelta1 + nextVal) >>> 0;

    // move.l (A2),D1; divu.w local[-8],D1; ...
    writeU32(r, a2bOff, 0);

    let rowCapB = a6_14;
    if ((numRecW & 0xffff) <= (rowCapB >>> 0)) {
      rowCapB = ((numRecW - 1) & 0xffffffff) >>> 0;
    }

    const c1b = { value: count1 };
    const f2b = { value: flag2 };
    processEntry(
      r, state, baseOff, nextVal, d3,
      divisorW, colThresh, numRecW, rowCapB,
      c1b, f2b, setFlagBit,
    );
    count1 = c1b.value;
    flag2 = f2b.value;

    // move.l (-0x10,A6), D0; add.l D0, (0x401F92).l
    let scoreAccum1 = readU32(r, SCORE_ACCUM_OFF);
    scoreAccum1 = (scoreAccum1 + savedDelta2) >>> 0;
    writeU32(r, SCORE_ACCUM_OFF, scoreAccum1);

    // cmpi.l #0xE10, (0x401F92).l; bls skip_wrap_1
    if (scoreAccum1 > SCORE_WRAP_THRESHOLD) {
      // divu.w #0xE10, D1 -> D1.w = quotient.
      const wrapDiv = Math.floor(scoreAccum1 / SCORE_WRAP_THRESHOLD) & 0xffff;
      const d2w = wrapDiv;
      // pea 5; jsr D6(=40D8) -> D0 = fieldFetch(5); D0+1+d2w; pea sum; pea 5; jsr A3.
      const ff5 = subs.fieldFetch40D8
        ? (subs.fieldFetch40D8(state, 5) >>> 0)
        : 0;
      const sum5 = (ff5 + 1 + d2w) >>> 0;
      (subs.soundDispatch ?? (() => 0))(5, sum5);
      // mulu.w #0xE10, D0 -> D0 = wrapDiv * 0xE10; sub.l D0, (0x401F92).l.
      const subVal1 = (d2w * SCORE_WRAP_THRESHOLD) >>> 0;
      writeU32(r, SCORE_ACCUM_OFF, (scoreAccum1 - subVal1) >>> 0);
    }

    // addq #4, A2; cmpi.l #0xE10, (A2); bls skip_wrap_2
    if (nextVal > SCORE_WRAP_THRESHOLD) {
      const wrapDiv2 = Math.floor(nextVal / SCORE_WRAP_THRESHOLD) & 0xffff;
      const ff6 = subs.fieldFetch40D8
        ? (subs.fieldFetch40D8(state, 6) >>> 0)
        : 0;
      const sum6 = (ff6 + 1 + wrapDiv2) >>> 0;
      (subs.soundDispatch ?? (() => 0))(6, sum6);
    }
  }

  // ── Decay pass (0x4AAC..0x4B12): when flag2 is set, halve every cell ─────
  // tst.b (-0x2,A6); beq skip_decay
  if (flag2 !== 0) {
    // clr.w D3w (outer = 0)
    let outer = 0;
    const maxOuter = numRecW * 20; // (numRecW & 0xffff) × 20
    // Loop: while outer < numRecW*20 step 20
    //   inner 0..18: base[outer+inner] >>= 1 (lsr.b #1)
    //   outer += 20
    while (outer < maxOuter) {
      let inner = 0;
      while (inner <= 0x12) { // inner in 0..18
        const off = (baseOff + outer + inner) | 0;
        const b = (r[off] ?? 0) & 0xff;
        r[off] = b >>> 1; // lsr.b #1 (logical right shift byte)
        inner++;
      }
      outer += 0x14; // addi.w #0x14 (20 decimal)
    }

    // divu.w #0x14, D1 with D1 = D3w (low word of D3 = maxOuter & 0xffff).
    // quotient = maxOuter / 20 = numRecW (row count).
    const d3Loop = maxOuter & 0xffff;
    const rowPairDecay = Math.floor(d3Loop / 0x14) & 0xffff; // = numRecW

    // addq.l #6, D1 -> arg = rowPairDecay + 6; jsr A4 (setFlagBit).
    setFlagBit(state, (rowPairDecay + FLAG_BIT_OFFSET) >>> 0);
    setFlagBit(state, (rowPairDecay + FLAG_BIT_OFFSET + 1) >>> 0);
  }

  // ── count1 check (0x4B14..0x4B3C) ────────────────────────────────────────
  // tst.b (-0x1,A6); beq skip_count1_dispatch
  if (count1 !== 0) {
    // move.b (-0x1,A6),D3b; ext.w D3w; addq.w #2,D3w -> D3.w = count1 + 2.
    const d3w = ((count1 & 0xff) + 2) & 0xffff;
    // moveq 0,D2; move.w D3w,D2w; move.l D2,-(SP); jsr D6(=40D8) -> D0.
    const retFf = subs.fieldFetch40D8
      ? (subs.fieldFetch40D8(state, d3w >>> 0) >>> 0)
      : 0;
    // addq.l #1,D1; (D1 = D0+1); addq.l #4,SP
    const d1 = (retFf + 1) >>> 0;
    // move.l D1,-(SP); moveq 0,D0; move.w D3w,D0w; move.l D0,-(SP); jsr A3
    (subs.soundDispatch ?? (() => 0))(d3w >>> 0, d1);
    // addq.l #8,SP
  }

  // ── Bonus fields 7, 8, 9 (0x4BC2..0x4C20) ────────────────────────────────
  // Each block: if arg != 0, fetch via D6, add bonus, then dispatch via A3.
  const bonusArgs: ReadonlyArray<[number, number]> = [
    [7, a6_18],
    [8, a6_1c],
    [9, a6_20],
  ];
  for (const [cmdIdx, bonus] of bonusArgs) {
    if (bonus !== 0) {
      // pea cmdIdx; jsr D6(=40D8) -> D0; D0 += bonus; pea sum; pea cmdIdx; jsr A3.
      const ff = subs.fieldFetch40D8
        ? (subs.fieldFetch40D8(state, cmdIdx) >>> 0)
        : 0;
      const sum = (ff + bonus) >>> 0;
      (subs.soundDispatch ?? (() => 0))(cmdIdx, sum);
    }
  }

  // ── Epilogo: movem.l (SP)+,{D2..D7,A2..A5}; unlk; rts ──────────────────
  void d4; void d2;
}
