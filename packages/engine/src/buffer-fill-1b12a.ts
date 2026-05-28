/**
 * Replica of `FUN_0001B12A`, a bounding-box fill helper.
 *
 * Given a 14-byte `localRect` buffer, it reads `localRect[0]` (`typeCode`) and
 * `localRect[1]` (`subIdx`), then fills six big-endian words at offsets 2..0xC
 * with an axis-aligned bounding box:
 *
 *   localRect[2..3]  = xMin  (output = A1[0xc] + xDelta)
 *   localRect[4..5]  = yMin  (output = A1[0x10] + yDelta)
 *   localRect[6..7]  = zMin  (output = A1[0x14] + zDelta)
 *   localRect[8..9]  = xMax  (= xMin + xSize)
 *   localRect[A..B]  = yMax  (= yMin + ySize)
 *   localRect[C..D]  = zMax  (= zMin + zSize)
 *
 * All fields are 68000 words: 16-bit, big-endian, with signed arithmetic
 * wrapping at writeback.
 *
 * Canonical epilogue `0x1b554..0x1b5a4`:
 *   D5 -> xDelta added to A1[0x0c]
 *   D4 -> yDelta added to A1[0x10]
 *   D6 -> zDelta added to A1[0x14]
 *   D1 -> xSize offset from xMin to xMax
 *   D2 -> ySize offset from yMin to yMax
 *   D3 -> zSize offset from zMin to zMax
 *
 * Epilogue `0x1b576` is used by type 1/2 and 4/0xe paths with `local[-2]`
 * as xMin, D5 as yMin, D4 as zMin, and D1/D2/D3 as sizes.
 *
 * Dispatch by typeCode:
 *   0x00        -> all fields 0x7fff / 0, invalid sentinel
 *   0x01        -> table 0x1eff6, fixed offsets -3/-3/+1, size 6/6/6
 *   0x02        -> table 0x1effe, fixed offsets -3/-3/+1, size 6/6/6
 *   0x04        -> table 0x1f006, sub-object via A2[0x58], a3=0, d3=0x10
 *   0x0e        -> table 0x1f07a, sub-object via A1[0x3a], a3=-8, d3=0
 *   0x07/08/09  -> table 0x1f096, sub-object via A1[0x1c], flip branch
 *   0x0f        -> table 0x1f0ba, flip branch (zero or -4/-4/0)
 *   0x29        -> 0x401650, byte coords x8+2
 *   0x2a        -> 0x40098c, direct word coords
 *   0x2c        -> all zeros
 *   3..0xd      -> table 0x1f016 plus type jump table
 *   else        -> table 0x1f016, zero deltas
 *
 * **Callers**:
 *   FUN_26F3E @ 0x26F92  (lateGameLogic)
 *   FUN_28CA6 @ 0x28CC2  (sceneObjInit)
 *   FUN_18E6C @ 0x18E94  (slotInsertSorted sub-injection callback)
 *
 * **Disasm range**: 0x1B12A .. 0x1B5A4 (rts).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Address of FUN_0001B12A in the M68k address space. */
export const BUFFER_FILL_1B12A_ADDR = 0x0001b12a as const;

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_END  = 0x00402000;
const ROM_END       = 0x00080000; // main ROM range: 0x000000..0x07FFFF

// ROM pointer table offsets (byte index in program blob = M68k absolute address)
const PT_TYPE1   = 0x1eff6 as const;
const PT_TYPE2   = 0x1effe as const;
const PT_TYPE4   = 0x1f006 as const;
const PT_DFLT    = 0x1f016 as const;
const PT_TYPE_E  = 0x1f07a as const;
const PT_TYPE_79 = 0x1f096 as const;
const PT_TYPE_F  = 0x1f0ba as const;

// Work-RAM array bases for special typeCodes
const WR_TYPE29_BASE = 0x401650 as const;
const WR_TYPE2A_BASE = 0x40098c as const;

// Null pointer sentinel: moveq #$ff,d0 sign-extends to 0xffffffff
const NULL_PTR = 0xffffffff as const;

// ─── Low-level read helpers ───────────────────────────────────────────────────

/** Sign-extend 16-bit word to JS number. */
function s16(w: number): number {
  const x = w & 0xffff;
  return x & 0x8000 ? x - 0x10000 : x;
}

/** Read unsigned 32-bit BE from ROM program blob. */
function romR32(rom: RomImage, off: number): number {
  const o = off | 0;
  return (
    (((rom.program[o]     ?? 0) & 0xff) << 24) |
    (((rom.program[o + 1] ?? 0) & 0xff) << 16) |
    (((rom.program[o + 2] ?? 0) & 0xff) <<  8) |
     ((rom.program[o + 3] ?? 0) & 0xff)
  ) >>> 0;
}

/** Read unsigned byte from M68k address (ROM or work-RAM). */
function busR8(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a < ROM_END) return (rom.program[a] ?? 0) & 0xff;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) return (state.workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
  return 0;
}

/** Read signed 8-bit from M68k address with sign-extension (ext.w behaviour). */
function busS8(state: GameState, rom: RomImage, abs: number): number {
  const v = busR8(state, rom, abs);
  return v & 0x80 ? v - 0x100 : v;
}

/** Read unsigned 32-bit BE from M68k address (ROM or work-RAM). */
function busR32(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a < ROM_END) {
    return (
      (((rom.program[a]     ?? 0) & 0xff) << 24) |
      (((rom.program[a + 1] ?? 0) & 0xff) << 16) |
      (((rom.program[a + 2] ?? 0) & 0xff) <<  8) |
       ((rom.program[a + 3] ?? 0) & 0xff)
    ) >>> 0;
  }
  if (a >= WORK_RAM_BASE && a + 3 < WORK_RAM_END) {
    const o = a - WORK_RAM_BASE;
    return (
      (((state.workRam[o]     ?? 0) & 0xff) << 24) |
      (((state.workRam[o + 1] ?? 0) & 0xff) << 16) |
      (((state.workRam[o + 2] ?? 0) & 0xff) <<  8) |
       ((state.workRam[o + 3] ?? 0) & 0xff)
    ) >>> 0;
  }
  return 0;
}

// Keep narrow work-RAM-only reads for base coordinate fields
// (A1[0xc/10/14] always point into work-RAM in normal game operation)

/** Read unsigned 16-bit BE from work RAM at M68k absolute address. */
function wrR16(state: GameState, abs: number): number {
  const a = abs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return 0;
  const o = a - WORK_RAM_BASE;
  return (((state.workRam[o] ?? 0) & 0xff) << 8) | ((state.workRam[o + 1] ?? 0) & 0xff);
}

// ─── ROM table lookup ─────────────────────────────────────────────────────────

/**
 * Read a 32-bit pointer from a ROM table.
 * `tableOff` is the byte offset in the program blob; `idx` is 0-based.
 */
function romPtr(rom: RomImage, tableOff: number, idx: number): number {
  return romR32(rom, tableOff + ((idx & 0xff) * 4)) >>> 0;
}

// ─── Output writer ────────────────────────────────────────────────────────────

/**
 * Write 6 × word BE to localRect[2..0xD] — mirrors epilog 0x1b576.
 *
 *   out[2..3] = xMin
 *   out[4..5] = yMin
 *   out[6..7] = zMin
 *   out[8..9] = xMin + d1
 *   out[A..B] = yMin + d2
 *   out[C..D] = zMin + d3
 *
 * All arithmetic wraps mod 65536 (M68k `move.w` truncates).
 */
function writeOut(
  out: Uint8Array,
  xMin: number, yMin: number, zMin: number,
  d1: number, d2: number, d3: number,
): void {
  const xm = xMin & 0xffff;
  const ym = yMin & 0xffff;
  const zm = zMin & 0xffff;
  const xM = (xMin + d1) & 0xffff;
  const yM = (yMin + d2) & 0xffff;
  const zM = (zMin + d3) & 0xffff;

  out[2]  = (xm >>> 8) & 0xff;  out[3]  = xm & 0xff;
  out[4]  = (ym >>> 8) & 0xff;  out[5]  = ym & 0xff;
  out[6]  = (zm >>> 8) & 0xff;  out[7]  = zm & 0xff;
  out[8]  = (xM >>> 8) & 0xff;  out[9]  = xM & 0xff;
  out[0xa] = (yM >>> 8) & 0xff; out[0xb] = yM & 0xff;
  out[0xc] = (zM >>> 8) & 0xff; out[0xd] = zM & 0xff;
}

/**
 * Compute the three base coordinates from an object struct in work RAM
 * by applying the delta registers, then call writeOut.
 *
 * Mirrors epilog 0x1b554:
 *   xMin = A1[0x0c] + d5  (add.w d5, d7 where d7=A1[0xc])
 *   yMin = A1[0x10] + d4  (add.w d4, d5 where d5=A1[0x10])
 *   zMin = A1[0x14] + d6  (add.w d6, d4 where d4=A1[0x14])
 */
function writeOutFromA1(
  state: GameState,
  out: Uint8Array,
  a1: number,
  d5: number, d4: number, d6: number,
  d1: number, d2: number, d3: number,
): void {
  const xMin = s16(wrR16(state, a1 + 0x0c) + d5);
  const yMin = s16(wrR16(state, a1 + 0x10) + d4);
  const zMin = s16(wrR16(state, a1 + 0x14) + d6);
  writeOut(out, xMin, yMin, zMin, d1, d2, d3);
}

/**
 * Read the four signed-byte offsets from a sub-object struct at `a2`.
 *
 * The struct pointer `a2` may be in ROM (0..0x7FFFF) or work-RAM.
 *
 * Mirrors:
 *   move.b $4(a2),d4  ext.w
 *   move.b $5(a2),d6  ext.w
 *   move.b $6(a2),d1  ext.w
 *   move.b $7(a2),d2  ext.w
 */
function subOffsets(
  state: GameState, rom: RomImage, a2: number,
): { b4: number; b5: number; b6: number; b7: number } {
  return {
    b4: busS8(state, rom, a2 + 0x4),
    b5: busS8(state, rom, a2 + 0x5),
    b6: busS8(state, rom, a2 + 0x6),
    b7: busS8(state, rom, a2 + 0x7),
  };
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Replica `FUN_0001B12A`.
 *
 * @param state     GameState — work-RAM is read (never written by this function).
 * @param rom       ROM image — pointer tables are read.
 * @param localRect 14-byte buffer: input [0]=typeCode, [1]=subIdx;
 *                  output [2..0xD] = 6 × word BE bounding-box.
 */
export function bufferFill1B12A(
  state: GameState,
  rom: RomImage,
  localRect: Uint8Array,
): void {
  const typeCode = (localRect[0] ?? 0) & 0xff;
  const subIdx   = (localRect[1] ?? 0) & 0xff;

  // ── 0x1b136: tst.b (A0) / beq → if typeCode == 0 ────────────────────────
  if (typeCode === 0) {
    // 0x1b13a: D0=D4=0x7fff, local[-2]=0x7fff, D5=0x7fff
    // D3=D1=D2=0 → bra 0x1b576
    // Output: all min fields = 0x7fff, size fields = 0 (→ max = 0x7fff)
    writeOut(localRect, 0x7fff, 0x7fff, 0x7fff, 0, 0, 0);
    return;
  }

  // ── 0x1b154: cmpi.b #1/(#2) — types 1 and 2 ─────────────────────────────
  if (typeCode === 1 || typeCode === 2) {
    // 0x1b162: A1 = ROM[tableOff][subIdx]
    // local[-2] = A1[0xc] - 3; D5 = A1[0x10] - 3; D4 = A1[0x14] + 1
    // D3=D1=D2=6 → bra 0x1b576
    const tableOff = typeCode === 1 ? PT_TYPE1 : PT_TYPE2;
    const a1 = romPtr(rom, tableOff, subIdx);
    const xMin = s16(wrR16(state, a1 + 0x0c) - 3);
    const yMin = s16(wrR16(state, a1 + 0x10) - 3);
    const zMin = s16(wrR16(state, a1 + 0x14) + 1);
    writeOut(localRect, xMin, yMin, zMin, 6, 6, 6);
    return;
  }

  // ── 0x1b1ba: cmpi.b #4 / cmpi.b #0xe — types 4 and 0xe ──────────────────
  if (typeCode === 4 || typeCode === 0xe) {
    let a2: number;   // base struct for coords (A1[0xc/10/14])
    let subObjPtr: number;  // sub-object pointer (may be 0xffffffff = null)
    let a3Word: number;     // z-delta from A3 register
    let d3: number;         // z-size

    if (typeCode === 4) {
      // 0x1b1ca: A2 = ROM[0x1f006][subIdx]; A4 = A2[0x58]; A1 = (A4)
      a2 = romPtr(rom, PT_TYPE4, subIdx);
      const a4 = busR32(state, rom, a2 + 0x58);
      subObjPtr = busR32(state, rom, a4);
      // clr.w d7; movea.w d7,a3 → a3=0; moveq #0x10,d3
      a3Word = 0;
      d3 = 0x10;
    } else {
      // 0x1b1f2: A2=A1 = ROM[0x1f07a][subIdx]; A4 = A1[0x3a]; A1 = (A4)
      a2 = romPtr(rom, PT_TYPE_E, subIdx);
      const a4 = busR32(state, rom, a2 + 0x3a);
      subObjPtr = busR32(state, rom, a4);
      // moveq #$f8,d7; movea.w d7,a3 → a3.w = 0xfff8 = -8; clr.w d3 → d3=0
      a3Word = s16(0xfff8);  // -8
      d3 = 0;
    }

    // 0x1b214: moveq #$ff,d0; cmp.l a1,d0; bne $1b224
    let d4: number, d6: number, d1: number, d2: number;

    if (subObjPtr === NULL_PTR) {
      // 0x1b21a: moveq #$fc,d4 → D4.w=0xfffc=-4; move.w d4,d6 → D6.w=-4
      // moveq #$8,d1 → D1.w=8; move.w d1,d2 → D2.w=8
      d4 = -4;  // 0xfffc as signed word
      d6 = -4;
      d1 = 8;
      d2 = 8;
    } else {
      // 0x1b224: read bytes 4..7 from sub-object (A1 = subObjPtr)
      const o = subOffsets(state, rom, subObjPtr);
      d4 = o.b4;  // move.b $4(a1),d4 ext.w
      d6 = o.b5;  // move.b $5(a1),d6 ext.w
      d1 = o.b6;  // move.b $6(a1),d1 ext.w
      d2 = o.b7;  // move.b $7(a1),d2 ext.w
    }

    // 0x1b23c: inline epilog using A2 as base (NOT A1)
    // local[-2] = A2[0xc] + d4;  d5 = A2[0x10] + d6;  d4 = A2[0x14] + a3
    // → bra 0x1b576 (direct output)
    const xMin = s16(wrR16(state, a2 + 0x0c) + d4);
    const yMin = s16(wrR16(state, a2 + 0x10) + d6);
    const zMin = s16(wrR16(state, a2 + 0x14) + a3Word);
    writeOut(localRect, xMin, yMin, zMin, d1, d2, d3);
    return;
  }

  // ── 0x1b262: cmpi.b #0x29 — type 0x29 ───────────────────────────────────
  if (typeCode === 0x29) {
    // base = 0x401650 + subIdx * 16
    const base = WR_TYPE29_BASE + ((subIdx & 0xff) << 4);
    // D1=4, D2=4, D3=0x14
    const d1 = 4;
    const d2 = 4;
    const d3 = 0x14;
    // 0x1b282: move.b $4(a1), local[-1]; sign-ext local[-2] (word); asl.w 3; addq.w 2
    // Reconstruction: byte[4] → sign-extend → *8 + 2
    const b4 = busS8(state, rom, base + 0x4);
    const xMin = s16((b4 << 3) + 2);
    // byte[5] → sign-ext → *8 + 2
    const b5 = busS8(state, rom, base + 0x5);
    const yMin = s16((b5 << 3) + 2);
    // word[6] → direct
    const zMin = s16(wrR16(state, base + 0x6));
    writeOut(localRect, xMin, yMin, zMin, d1, d2, d3);
    return;
  }

  // ── 0x1b2b2: cmpi.b #0x2a — type 0x2a ───────────────────────────────────
  if (typeCode === 0x2a) {
    // offset = subIdx * 12 via: d1=subIdx*4; d0=d1*4; d1+=d1→d1=d1*8; d1+=d0→d1=d1*12
    const a1 = WR_TYPE2A_BASE + ((subIdx & 0xff) * 12);
    // D1=0, D2=0, D3=0
    const xMin = s16(wrR16(state, a1 + 0x0));
    const yMin = s16(wrR16(state, a1 + 0x2));
    const zMin = s16(wrR16(state, a1 + 0x4) - 8);  // subq.w #8, d4
    writeOut(localRect, xMin, yMin, zMin, 0, 0, 0);
    return;
  }

  // ── 0x1b2ea: cmpi.b #0x2c — type 0x2c ───────────────────────────────────
  if (typeCode === 0x2c) {
    // All zeros: D3=D1=D2=0, D4=0, local[-2]=0, D5=0 → bra 0x1b576
    writeOut(localRect, 0, 0, 0, 0, 0, 0);
    return;
  }

  // ── 0x1b308: cmpi.b #7/8/9 — types 7, 8, 9 ──────────────────────────────
  if (typeCode === 7 || typeCode === 8 || typeCode === 9) {
    // A1 = ROM[0x1f096][subIdx]
    const a1 = romPtr(rom, PT_TYPE_79, subIdx);
    // A4 = A1[0x1c]; A2 = (A4)
    const a4 = busR32(state, rom, a1 + 0x1c);
    const a2 = busR32(state, rom, a4);
    // Read offsets from A2: d4=b4, d6=b5, d1=b6, d2=b7 (note: type 7/8/9 uses d4,d1,d6,d2 ordering)
    const d4 = busS8(state, rom, a2 + 0x4);  // move.b $4(a2),d4 ext.w
    const d1 = busS8(state, rom, a2 + 0x6);  // move.b $6(a2),d1 ext.w
    const d6 = busS8(state, rom, a2 + 0x5);  // move.b $5(a2),d6 ext.w
    const d2 = busS8(state, rom, a2 + 0x7);  // move.b $7(a2),d2 ext.w
    // cmpi.b #2, $1a(A1) — flip flag
    const flip = busR8(state, rom, a1 + 0x1a);
    let a2Word: number; // used as A2 in "add.w a2, d4" at 0x1b388
    let d3: number;
    if (flip === 0x2) {
      // moveq #$f8,d7; movea.w d7,a2 → a2.w = 0xfff8 = -8; clr.w d3 → d3=0
      a2Word = s16(0xfff8);  // -8
      d3 = 0;
    } else {
      // clr.w d7; movea.w d7,a2 → a2=0; moveq #6,d3
      a2Word = 0;
      d3 = 6;
    }
    // 0x1b368: lea $c(a1),a4; ... epilog using A1
    // xMin = A1[0xc] + d4; yMin = A1[0x10] + d6; zMin = A1[0x14] + a2Word
    // D1=d1, D2=d2, D3=d3
    writeOutFromA1(state, localRect, a1, /*d5=*/d4, /*d4=*/d6, /*d6=*/a2Word, d1, d2, d3);
    return;
  }

  // ── 0x1b38e: cmpi.b #0xf — type 0xf ─────────────────────────────────────
  if (typeCode === 0xf) {
    // A1 = ROM[0x1f0ba][subIdx]
    const a1 = romPtr(rom, PT_TYPE_F, subIdx);
    // cmpi.b #2, $1a(A1) — flip flag
    const flip = busR8(state, rom, a1 + 0x1a);
    let d5x: number, d4y: number, d6z: number, d1: number, d2: number, d3: number;
    if (flip === 0x2) {
      // 0x1b3b0: clr.w d0; move.w d0,d3=d2=d1=d6=d4=0; movea.w d4,a2 → a2=0
      // All zero deltas and sizes
      d5x = 0; d4y = 0; d6z = 0; d1 = 0; d2 = 0; d3 = 0;
    } else {
      // 0x1b3c0: moveq #$fc,d4 → D4.w=0xfffc=-4; movea.w d4,a2 → a2.w=-4
      // clr.w d6 → D6=0; moveq #$8,d1 → D1=8; move.w d1,d2 → D2=8; moveq #4,d3
      // At 0x1b3cc epilog: xMin=A1[0xc]+d4, yMin=A1[0x10]+a2.w, zMin=A1[0x14]+d6
      d5x = -4;   // D4 (xDelta) = 0xfffc = -4
      d4y = -4;   // A2.w (yDelta via add.w a2,d5) = 0xfffc = -4
      d6z = 0;    // D6 (zDelta) = 0
      d1  = 8;
      d2  = 8;
      d3  = 4;
    }
    writeOutFromA1(state, localRect, a1, d5x, d4y, d6z, d1, d2, d3);
    return;
  }

  // ── 0x1b3f2: default path — table 0x1f016 + optional jump-table ──────────
  // A1 = ROM[0x1f016][subIdx]
  const a1 = romPtr(rom, PT_DFLT, subIdx);

  // 0x1b406: D0=D6=D5=D4=0 (clr.w each)
  // 0x1b40e: move.b (A0),d0 → typeCode; check if in range [3..0xd]
  // 0x1b41c: blt $1b554 → type < 3 → zero deltas
  // 0x1b428: bgt $1b554 → type > 0xd → zero deltas
  if (typeCode < 3 || typeCode > 0xd) {
    // 0x1b554 with D5=D4=D6=0, D1=D2=D3=0 (all zero from clr.w)
    writeOutFromA1(state, localRect, a1, 0, 0, 0, 0, 0, 0);
    return;
  }

  // 0x1b43c: jump table dispatch
  // d0 = (typeCode - 3) * 2; jmp $1b440(pc, d0.w)
  // Sub-object pointer (used by types 3,5,6,10,11,12,13):
  // A4 = A1[0x3e]; A2 = (A4)
  function getSubObj(): number {
    const a4 = busR32(state, rom, a1 + 0x3e);
    return busR32(state, rom, a4);
  }

  switch (typeCode) {
    case 3: {
      // 0x1b456: A2 = sub-obj via A1[0x3e]
      // d5=b4, d1=b6, d4=b5, d2=b7, d6=0xf0(-16), d3=0x10
      const a2 = getSubObj();
      const o = subOffsets(state, rom, a2);
      writeOutFromA1(state, localRect, a1,
        /*d5=xDelta*/ o.b4, /*d4=yDelta*/ o.b5, /*d6=zDelta*/ s16(0xfff0),
        /*d1=xSize */ o.b6, /*d2=ySize */ o.b7, /*d3=zSize */ 0x10);
      return;
    }

    case 4:
    case 7:
    case 8:
    case 9: {
      // 0x1b554: zero deltas (fell through from outer checks — these types
      // were intercepted earlier so this branch is unreachable in practice,
      // but the jump-table maps them to 0x1b554 as a safe fallback)
      writeOutFromA1(state, localRect, a1, 0, 0, 0, 0, 0, 0);
      return;
    }

    case 5: {
      // 0x1b47c: A2 = sub-obj; d5=b4, d1=b6, d4=b5, d2=b7, d6=0, d3=0x18
      const a2 = getSubObj();
      const o = subOffsets(state, rom, a2);
      writeOutFromA1(state, localRect, a1,
        o.b4, o.b5, 0,
        o.b6, o.b7, 0x18);
      return;
    }

    case 6: {
      // 0x1b4a2: A2 = sub-obj
      // d5=0, d1=0x20, d4=b4(a2), d2=b6(a2), d6=0, d3=0x28
      // Note: type 6 reads byte[4] as yDelta and byte[6] as ySize (different layout)
      const a2 = getSubObj();
      writeOutFromA1(state, localRect, a1,
        /*d5=xDelta*/ 0,    /*d4=yDelta*/ busS8(state, rom, a2 + 0x4), /*d6=zDelta*/ 0,
        /*d1=xSize */ 0x20, /*d2=ySize */ busS8(state, rom, a2 + 0x6),  /*d3=zSize */ 0x28);
      return;
    }

    case 10: {
      // 0x1b532: A2 = sub-obj; d5=b4, d1=b6, d4=b5, d2=b7, d6=0xf8(-8), d3=0
      const a2 = getSubObj();
      const o = subOffsets(state, rom, a2);
      writeOutFromA1(state, localRect, a1,
        o.b4, o.b5, s16(0xfff8),
        o.b6, o.b7, 0);
      return;
    }

    case 11:
    case 13: {
      // 0x1b4c0: A2 = sub-obj; null-check
      const a2 = getSubObj();
      if (a2 === NULL_PTR) {
        // 0x1b4cc: d5=0, d4=0, d1=8, d2=8, d6=0xf8(-8), d3=0
        writeOutFromA1(state, localRect, a1,
          0, 0, s16(0xfff8),
          8, 8, 0);
      } else {
        // 0x1b4dc: d5=b4, d1=b6, d4=b5, d2=b7, d6=0xf8(-8), d3=0x18
        const o = subOffsets(state, rom, a2);
        writeOutFromA1(state, localRect, a1,
          o.b4, o.b5, s16(0xfff8),
          o.b6, o.b7, 0x18);
      }
      return;
    }

    case 12: {
      // 0x1b4fa: A2 = sub-obj; null-check
      const a2 = getSubObj();
      if (a2 === NULL_PTR) {
        // 0x1b506: d5=0, d4=0, d1=8, d2=8, d6=0xf8(-8), d3=0
        writeOutFromA1(state, localRect, a1,
          0, 0, s16(0xfff8),
          8, 8, 0);
      } else {
        // 0x1b514: d5=b4, d1=b6, d4=b5, d2=b7, d6=0, d3=0x10
        const o = subOffsets(state, rom, a2);
        writeOutFromA1(state, localRect, a1,
          o.b4, o.b5, 0,
          o.b6, o.b7, 0x10);
      }
      return;
    }

    default: {
      // Safety fallback — should be unreachable (range [3..0xd] exhausted above)
      writeOutFromA1(state, localRect, a1, 0, 0, 0, 0, 0, 0);
    }
  }
}
