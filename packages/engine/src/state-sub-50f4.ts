/**
 * state-sub-50f4.ts - `FUN_000050F4` replica (204 bytes = 0xCC).
 *
 * syndromes through weighted XOR, then:
 *
 *   - if all zero -> return D0 = 0 (no error)
 *     to correct; if bit 4 is unset, mark uncorrectable (set bit 31
 *     of D1). Also increment a long-BE counter @ A2+0x11 (with rollback
 *     on overflow). Return D0 = D1 (positive if corrected, 0x80000001 if
 *     uncorrectable).
 *
 * as the base for toggle `eor.b D1b, A1[bVar14 - 9]` during correction.
 *
 * **Caller convention (registers inherited from `bsr.w`)**:
 *   - `A2` (long): output buffer base. Must be in workRam (0x400000+).
 *   - `A3` (long): input buffer base (codeword rows, 30 bytes each).
 *   - `D2w` (signed word): input row index -> A0 = A3 + D2w*30.
 *   - `D3w` (signed word): output row index -> A1 = A2 + D3w*10.
 *
 * **Side effects at epilogue**:
 *   - `D0 = D1` at rts (D1 contains the return value).
 *       D2 = D2_in + 1, D3 = D3_in + 1.
 *
 * **Disasm 0x50F4..0x51BE** (204 bytes):
 *
 *   0x50F4  moveq   #0xa, D0                ; D0 = 10
 *   0x50F6  mulu.w  D3w, D0                 ; D0 = (D3w as unsigned) * 10
 *   0x50F8  lea     (0x0,A2,D0w*1), A1      ; A1 = A2 + signext_w(D0w*10)
 *   0x50FC  move.l  D2, D0                  ; D0 = D2 (long copy)
 *   0x50FE  asl.w   #0x4, D0w               ; D0w = D2w << 4 (= *16)
 *   0x5100  sub.w   D2w, D0w                ; D0w = D2w * 16 - D2w = D2w * 15
 *   0x5102  add.w   D0w, D0w                ; D0w = D2w * 30
 *   0x5104  lea     (0x0,A3,D0w*1), A0      ; A0 = A3 + signext_w(D2w*30)
 *   0x5108  movem.l {A4 A1 D6 D5 D4 D3 D2}, -(SP)   ; preserve registers
 *   0x510C  move.b  (A0), D6b               ; D6b = A0[0]
 *   0x510E  not.b   D6b                     ; D6b = ~A0[0]
 *   0x5110  move.b  (0x10, A0), D5b         ; D5b = A0[16]
 *   0x5114  eor.b   D5b, D6b                ; D6b ^= D5b
 *   0x5116  move.b  (0x8, A0), D4b          ; D4b = A0[8]
 *   0x511A  eor.b   D4b, D6b                ; D6b ^= D4b
 *   0x511C  move.b  (0x4, A0), D3b          ; D3b = A0[4]
 *   0x5120  eor.b   D3b, D6b                ; D6b ^= D3b
 *   0x5122  move.b  (0x2, A0), D2b          ; D2b = A0[2]
 *   0x5126  eor.b   D2b, D6b                ; D6b ^= D2b
 *
 *   ; init D6b = ~A0[0] ^ A0[16] ^ A0[8] ^ A0[4] ^ A0[2]
 *   ; init D5b = A0[16], D4b = A0[8], D3b = A0[4], D2b = A0[2]
 *
 *   0x5128  lea     (-0x1fe, PC), A4        ; A4 = 0x4F2C (iter table)
 *   0x512C  move.w  (A4)+, D1w              ; D1w = *(A4)++ (first short = 0x0003)
 *
 *   ; INNER LOOP @ 0x512E:
 *   0x512E  add.w   D1w, D1w                ; D1w *= 2 (offset for byte read)
 *   0x5130  move.b  (0x0,A0,D1w*1), D0b     ; D0b = A0[D1w]
 *   0x5134  move.b  D0b, (A1)+              ; *A1++ = D0b (output copy)
 *   0x5136  lsr.b   #0x2, D1b               ; D1b >>= 2
 *   0x5138  bcc.b   0x513C                  ; if (D1b old bit1) == 0 skip
 *   0x513A  eor.b   D0b, D2b                ; D2b ^= D0b
 *   0x513C  lsr.b   #0x1, D1b               ; D1b >>= 1
 *   0x513E  bcc.b   0x5142
 *   0x5140  eor.b   D0b, D3b                ; D3b ^= D0b
 *   0x5142  lsr.b   #0x1, D1b
 *   0x5144  bcc.b   0x5148
 *   0x5146  eor.b   D0b, D4b                ; D4b ^= D0b
 *   0x5148  lsr.b   #0x1, D1b
 *   0x514A  bcc.b   0x514E
 *   0x514C  eor.b   D0b, D5b                ; D5b ^= D0b
 *   0x514E  eor.b   D0b, D6b                ; D6b ^= D0b (always)
 *   0x5150  move.b  (A4)+, D1b              ; D1b = *A4++ (next byte)
 *   0x5152  bpl.b   0x512E                  ; if positive (top bit 0) loop
 *
 *   ; Table @ 0x4F2C: word(0x0003), bytes(0x05,0x06,0x07,0x09,0x0A,0x0B,
 *   ;                 0x0C,0x0D,0x0E), 0xFF (terminator)
 *
 *   0x5154  moveq   #0x0, D1                ; D1 = 0 (default return)
 *   0x5156  move.b  D6b, D0b                ; D0b = D6b
 *   0x5158  or.b    D2b, D0b                ; D0b |= D2b
 *   0x515A  or.b    D3b, D0b                ; D0b |= D3b
 *   0x515C  or.b    D4b, D0b                ; D0b |= D4b
 *   0x515E  or.b    D5b, D0b                ; D0b |= D5b
 *   0x5160  beq.b   0x51B4                  ; if all syndromes zero → epilogue
 *   0x5162  moveq   #0x1, D1                ; D1 = 1 (correction attempted)
 *   0x5164  lea     (0x5a, PC), A4          ; A4 = 0x51C0 (correction table)
 *
 *   ; CORRECTION LOOP @ 0x5168:
 *   0x5168  moveq   #0x0, D0                ; D0 = 0
 *   0x516A  lsr.b   #0x1, D6b               ; LSB of D6b → X flag
 *   0x516C  roxl.w  #0x1, D0w               ; D0w = (D0w << 1) | X
 *   0x516E  lsr.b   #0x1, D5b
 *   0x5170  roxl.w  #0x1, D0w
 *   0x5172  lsr.b   #0x1, D4b
 *   0x5174  roxl.w  #0x1, D0w
 *   0x5176  lsr.b   #0x1, D3b
 *   0x5178  roxl.w  #0x1, D0w
 *   0x517A  lsr.b   #0x1, D2b
 *   0x517C  roxl.w  #0x1, D0w
 *
 *   ; D0w = bit5 = (D6b_LSB << 4) | (D5b_LSB << 3) | (D4b_LSB << 2)
 *   ;            | (D3b_LSB << 1) | (D2b_LSB)
 *   ; (LSB of each syndrome shifted out and assembled MSB-first)
 *
 *   0x517E  beq.b   0x51AC                  ; if D0w == 0 → skip increment+correct
 *   0x5180  addq.b  #0x1, (0x12, A2)        ; A2[0x12]++ (low byte counter)
 *   0x5184  bcc.b   0x5194                  ; if no carry skip
 *   0x5186  addq.b  #0x1, (0x11, A2)        ; A2[0x11]++ (high byte)
 *   0x518A  bcc.b   0x5194                  ; if no carry skip
 *
 *   ; Both bytes overflow → rollback (saturating)
 *   0x518C  subq.b  #0x1, (0x12, A2)
 *   0x5190  subq.b  #0x1, (0x11, A2)
 *
 *   0x5194  btst.l  #0x4, D0                ; bit 4 of D0
 *   0x5198  bne.b   0x51A2                  ; if bit 4 set → look up table
 *   0x519A  ori.l   #-0x80000000, D1        ; D1 |= 0x80000000 (uncorrectable)
 *   0x51A0  bra.b   0x51AC
 *
 *   0x51A2  move.b  (-0x10,A4,D0w*1), D0b   ; D0b = table[D0w-0x10]
 *                                            ; → table base 0x51C0 - 0x10 = 0x51B0
 *                                            ; entries 0x10..0x1F → 0x51C0..0x51CF
 *   0x51A6  bmi.b   0x51AC                  ; if D0b negative (0xFF) → skip
 *   0x51A8  eor.b   D1b, (-0xa,A1,D0w*1)    ; A1[-10 + D0] ^= D1b (correction)
 *
 *   ; A1 here = original_A1 + 10 (advanced by 10 stores).
 *   ; A1[D0 - 10] = original_A1 + D0 → output[D0] (with D0 ∈ {0..9})
 *
 *   0x51AC  add.b   D1b, D1b                ; D1b *= 2 (and X flag = old MSB)
 *   0x51AE  bcc.b   0x5168                  ; if no carry (msb was 0) loop
 *   0x51B0  move.b  #0x1, D1b               ; D1b = 1 (final flag)
 *
 *   0x51B4  movem.l (SP)+, {D2 D3 D4 D5 D6 A1 A4}    ; restore
 *   0x51B8  addq.l  #1, D2                  ; D2++ (caller iterator bump)
 *   0x51BA  addq.l  #1, D3                  ; D3++ (caller iterator bump)
 *   0x51BC  move.l  D1, D0                  ; D0 = D1 (return value)
 *   0x51BE  rts
 *
 *   - `0x4F2C..0x4F37`: iter table (12 byte, terminated by 0xFF):
 *       `[0x00, 0x03, 0x05, 0x06, 0x07, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0xFF]`
 *   - `0x51C0..0x51CF`: correction lookup (16 byte, entries 0x10..0x1F):
 *       `[0xFF, 0xFF, 0xFF, 0x00, 0xFF, 0x01, 0x02, 0x03, 0xFF, 0x04, 0x05,
 *         0x06, 0x07, 0x08, 0x09, 0xFF]`
 *     Entry 0xFF (negative byte) means "no correction at this syndrome"
 *     (skip-correct via `bmi`).
 *
 * **Side effects (workRam through A2)**:
 *      offset table = `[0x06, 0x0A, 0x0C, 0x0E, 0x12, 0x14, 0x16, 0x18, 0x1A, 0x1C]`
 *      (= `[3*2, 5*2, 6*2, 7*2, 9*2, 10*2, 11*2, 12*2, 13*2, 14*2]`).
 *   2. `A2[0x11..0x12]` = counter long-BE: incremented by 1 per non-zero
 *      syndrome (with saturating rollback if both bytes overflow).
 *
 * **Low-level fidelity notes**:
 *
 *  1. **`mulu.w D3w, D0`**: M68k unsigned 16x16→32. The decomp reduces it to a `(short)
 *     index. For `D3w` in a small range (e.g. 0..16) D0 = D3w*10 < 256, no
 *     wrap. For `D3w` large (e.g. 0xFFFF) D0w = (-1 * 10) & 0xFFFF = 0xFFF6 =
 *     -10 signed. The sign-ext makes A1 = A2 - 10. Depends on the caller: in
 *
 *     mod 65536 (= 16*D2w - D2w = 15*D2w, then *2 = 30*D2w). Only the low word
 *
 *     `original_A1 + 10`. In the correction phase the expression `(-0xa, A1, D0w)`
 *     becomes `original_A1 + 10 - 10 + D0w` = `original_A1 + D0w` with D0w in
 *
 *  4. **`btst.l #4, D0` and `move.b (-0x10,A4,D0w),D0b`**: the lookup table
 *     directly).
 *
 *     Start: D1 = 1 (`moveq #1, D1`). Iter 1: D1b = 2. Iter 2: D1b = 4. ...
 *     Iter 7: D1b = 0x80. Iter 8: 0x80 + 0x80 = 0x100 → D1b = 0, X=1, carry
 *     but high bits intact → D1 = 0x80000001.
 *
 *  6. **Counter A2[0x11..0x12]**: 16-bit big-endian saturating-on-overflow.
 *     Increment low byte; if carry, increment high byte; if that also
 *
 *  7. **`D2/D3 += 1` epilogue**: The callers (FUN_4F38) use these subs as
 *
 *
 *     2 byte as word BE = 0x0003). The following iterations use `move.b
 *
 * 10. **`bpl` after `move.b (A4)+, D1b`**: byte signed test. D1b in 0..0x7F
 *     (positive) → loop. D1b 0x80..0xFF → exit. The terminator 0xFF (= -1)
 *
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── ROM addresses ────────────────────────────────────────────────────────

/** Iter table (PC-relative @ 0x4F2C). Word + 9 byte + terminator 0xFF. */
export const ITER_TABLE_ADDR = 0x00004f2c as const;

/** Correction lookup table (PC-relative @ 0x51C0). 16 byte. */
export const CORRECTION_TABLE_ADDR = 0x000051c0 as const;

// ─── Constants derived from the disasm ─────────────────────────────────────────

export const INPUT_ROW_STRIDE = 30 as const;

export const OUTPUT_ROW_STRIDE = 10 as const;

export const OUTPUT_BYTE_COUNT = 10 as const;

export const ITER_COUNT = 10 as const;

export const CORRECTION_BIT_COUNT = 8 as const;

/** Offset of the counter long-BE in A2 (byte high). */
export const COUNTER_HI_OFFSET = 0x11 as const;

/** Offset of the counter long-BE in A2 (byte low). */
export const COUNTER_LO_OFFSET = 0x12 as const;

/** Mask of "uncorrectable" set in D1 (bit 31). */
export const UNCORRECTABLE_FLAG = 0x80000000 as const;

/** Offset (relative to the base table) for index 0x10..0x1F. */
export const CORRECTION_TABLE_OFFSET = 0x10 as const;

/** Number of entries in the correction table. */
export const CORRECTION_TABLE_SIZE = 16 as const;

export const SYNDROME_INIT_OFFSETS = [0x00, 0x10, 0x08, 0x04, 0x02] as const;

export const ITER_BYTE_OFFSETS = [
  0x06, // 0x03 * 2 — first word read
  0x0a, // 0x05 * 2
  0x0c, // 0x06 * 2
  0x0e, // 0x07 * 2
  0x12, // 0x09 * 2
  0x14, // 0x0A * 2
  0x16, // 0x0B * 2
  0x18, // 0x0C * 2
  0x1a, // 0x0D * 2
  0x1c, // 0x0E * 2
] as const;

export const ITER_TABLE_VALUES = [
  0x03, 0x05, 0x06, 0x07, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
] as const;

export const CORRECTION_TABLE = [
  0xff, 0xff, 0xff, 0x00, 0xff, 0x01, 0x02, 0x03,
  0xff, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0xff,
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Sign-extend low word of `v` to a long unsigned32. */
function signExtWord(v: number): number {
  return ((v & 0x8000) !== 0 ? (v | 0xffff0000) : (v & 0xffff)) >>> 0;
}

/** Add long unsigned32 (mod 2^32, equivalent to M68k `add.l`). */
function addLong(a: number, b: number): number {
  return ((a + b) | 0) >>> 0;
}

/**
 */
function readByteFromWorkRam(state: GameState, addr: number): number {
  const off = (addr - 0x400000) >>> 0;
  if (off < state.workRam.length) {
    return state.workRam[off]! & 0xff;
  }
  return 0;
}

function writeByteToWorkRam(state: GameState, addr: number, value: number): void {
  const off = (addr - 0x400000) >>> 0;
  if (off < state.workRam.length) {
    state.workRam[off] = value & 0xff;
  }
}

/**
 *
 */
function readByteAt(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  // workRam: 0x400000..0x401FFF
  if (a >= 0x400000 && a < 0x402000) {
    return state.workRam[a - 0x400000]! & 0xff;
  }
  // ROM: 0x000000..0x80000+ (program area)
  if (a < rom.program.length) {
    return rom.program[a]! & 0xff;
  }
  return 0;
}

// ─── Replica ───────────────────────────────────────────────────────────────

export interface Sub50F4Result {
  /** Return value in D0 (long): 0 / 1 / 0x80000001 (uncorrectable). */
  d0: number;
  /** D2 at rts (= D2_in + 1). */
  d2Out: number;
  /** D3 at rts (= D3_in + 1). */
  d3Out: number;
  outputBytes: Uint8Array;
  /** Counter A2[0x11..0x12] post-call (long-BE 16-bit, range 0..0xFFFF). */
  counterAfter: number;
  corrected: boolean;
  /** True if uncorrectable (D0 == 0x80000001 with bit 31 set). */
  uncorrectable: boolean;
  noError: boolean;
}

/**
 *
 * **Convention**:
 *   - Inputs are caller registers: `a2`, `a3` (long pointers), `d2Word`,
 *     `d3Word` (signed words used as row indices).
 *
 *                 a3 points into ROM (for example 0x000000..0x80000). In production A3
 * @param a2       Long unsigned32. Output buffer base (workRam ptr).
 * @param a3       Long unsigned32. Input codeword base (ROM or workRam ptr).
 * @param d2Word   Word (0..0xFFFF). Row index input → A0 = a3 + signExtW(d2Word*30).
 * @param d3Word   Word (0..0xFFFF). Row index output → A1 = a2 + signExtW(d3Word*10).
 *
 *
 *
 *    a2 + signExtW((d3Word*10) & 0xFFFF). Production callers pass
 *
 *    - D6b = ~A0[0]
 *    - D5b = A0[16], D6b ^= D5b
 *    - D4b = A0[8],  D6b ^= D4b
 *    - D3b = A0[4],  D6b ^= D3b
 *    - D2b = A0[2],  D6b ^= D2b
 *
 *    - byte = A0[v * 2]
 *    - *(A1++) = byte
 *    - if (v_doubled >> 1) & 1 -> D2b ^= byte    (bit 1 of v*2 = bit 0 of v)
 *    - if (v_doubled >> 2) & 1 -> D3b ^= byte    (bit 2 = bit 1 of v)
 *    - if (v_doubled >> 3) & 1 -> D4b ^= byte    (bit 3 = bit 2 of v)
 *    - if (v_doubled >> 4) & 1 -> D5b ^= byte    (bit 4 = bit 3 of v)
 *
 *    0x05, 0x06, 0x07, 0x09, ... and doubled → 0x0A, 0x0C, 0x0E, 0x12, ...
 *
 *
 *      and build D0w: `D0w = (LSB(D6b) << 4) | (LSB(D5b) << 3) | (LSB(D4b) << 2)
 *                       | (LSB(D3b) << 1) | LSB(D2b)`
 *    - if D0w != 0:
 *        - increment counter A2[0x12] byte; if carry, A2[0x11] byte; if both
 *          carry, decrement both (rollback saturating)
 *        - if D0 bit 4 set: lookup table[D0w & 0xF] (offset 0x10..0x1F → entry
 *          of the correction table). If != 0xFF: A1[entry - 10] ^= D1b
 *          loop.
 *        - if D0 bit 4 clear: D1 |= 0x80000000 (uncorrectable).
 *      controls loop exit. 8 total iterations.
 *
 * 6. Epilogue: D2 += 1, D3 += 1 (long), D0 = D1.
 *
 */
export function stateSub50F4(
  state: GameState,
  rom: RomImage,
  a2: number,
  a3: number,
  d2Word: number,
  d3Word: number,
): Sub50F4Result {
  const a2u = a2 >>> 0;
  const a3u = a3 >>> 0;
  const d2u = d2Word & 0xffff;
  const d3u = d3Word & 0xffff;

  // D0 = mulu.w D3w, 10 → low word = (D3w * 10) & 0xFFFF, sign-extended for lea.
  const d3times10w = (d3u * 10) & 0xffff;
  const a1Initial = addLong(a2u, signExtWord(d3times10w));

  // D2w * 30 = (D2w << 4) - D2w, doubled. M68k uses word arithmetic; mod 65536.
  const d2times15w = ((d2u << 4) - d2u) & 0xffff;
  const d2times30w = (d2times15w << 1) & 0xffff;
  const a0 = addLong(a3u, signExtWord(d2times30w));

  // ─── Init syndromes (5 bytes from A0[0, 16, 8, 4, 2]) ──────────────────────
  const a0Byte0 = readByteAt(state, rom, a0);
  const a0Byte16 = readByteAt(state, rom, addLong(a0, 0x10));
  const a0Byte8 = readByteAt(state, rom, addLong(a0, 0x08));
  const a0Byte4 = readByteAt(state, rom, addLong(a0, 0x04));
  const a0Byte2 = readByteAt(state, rom, addLong(a0, 0x02));

  let d6b = (~a0Byte0) & 0xff;
  let d5b = a0Byte16 & 0xff;
  d6b = (d6b ^ d5b) & 0xff;
  let d4b = a0Byte8 & 0xff;
  d6b = (d6b ^ d4b) & 0xff;
  let d3b = a0Byte4 & 0xff;
  d6b = (d6b ^ d3b) & 0xff;
  let d2b = a0Byte2 & 0xff;
  d6b = (d6b ^ d2b) & 0xff;

  // Output buffer (10 bytes). A1 advances during the loop.
  const outputBytes = new Uint8Array(OUTPUT_BYTE_COUNT);
  let a1 = a1Initial;

  for (let iter = 0; iter < ITER_COUNT; iter++) {
    const tableValue = ITER_TABLE_VALUES[iter]!; // 0x03, 0x05, ..., 0x0E
    const offset = (tableValue * 2) & 0xff;

    // byte = A0[offset]
    const byte = readByteAt(state, rom, addLong(a0, offset));

    // *(A1++) = byte
    writeByteToWorkRam(state, a1, byte);
    outputBytes[iter] = byte;
    a1 = addLong(a1, 1);

    // Specifically: `lsr.b #2, D1b` shifts 2 bits in one op. The C flag is
    // set to the LAST bit shifted out (= bit 1 of original).
    //   D1 (offset) = tableValue * 2.
    //   `lsr.b #2`: C = bit 1 of offset = bit 0 of (offset>>1). For
    //   offset = 0x06 (= 0b00000110), bit 1 = 1, C = 1 (bcc fails → eor).
    //
    // Then 3 more `lsr.b #1` ops. Each lsr.b#1 sets C = bit 0 of D1b BEFORE
    // shift. So the test sequences are:
    //   - after `lsr.b #2`: C = bit 1 of original
    //   - after `lsr.b #1` (×3): C = bit 2, bit 3, bit 4 of original
    //
    // Since offset = tableValue * 2, bit n of offset = bit (n-1) of tableValue.
    // → tests are: bit 0, 1, 2, 3 of tableValue (used for D2,D3,D4,D5 XOR).
    //
    // Equivalent: for bit b in {0,1,2,3} of tableValue: if set, XOR byte into
    // (D2,D3,D4,D5)[b]. Always XOR into D6.
    if ((tableValue >> 0) & 1) {
      d2b = (d2b ^ byte) & 0xff;
    }
    if ((tableValue >> 1) & 1) {
      d3b = (d3b ^ byte) & 0xff;
    }
    if ((tableValue >> 2) & 1) {
      d4b = (d4b ^ byte) & 0xff;
    }
    if ((tableValue >> 3) & 1) {
      d5b = (d5b ^ byte) & 0xff;
    }
    d6b = (d6b ^ byte) & 0xff;
  }

  // ─── Test: all zero? Return 0 ────────────────────────────────────────
  let d1: number = 0;
  const orAll = (d6b | d2b | d3b | d4b | d5b) & 0xff;
  if (orAll !== 0) {
    // ─── Correction loop ──────────────────────────────────────────────
    d1 = 1; // moveq #1, D1

    for (let bitIter = 0; bitIter < CORRECTION_BIT_COUNT; bitIter++) {
      // Build D0w from LSBs of (D6b, D5b, D4b, D3b, D2b) MSB-first.
      // `lsr.b #1, X; roxl.w #1, D0w` for each in order.
      const lsbD6 = d6b & 1;
      d6b = (d6b >>> 1) & 0xff;
      const lsbD5 = d5b & 1;
      d5b = (d5b >>> 1) & 0xff;
      const lsbD4 = d4b & 1;
      d4b = (d4b >>> 1) & 0xff;
      const lsbD3 = d3b & 1;
      d3b = (d3b >>> 1) & 0xff;
      const lsbD2 = d2b & 1;
      d2b = (d2b >>> 1) & 0xff;

      // D0w = (lsbD6 << 4) | (lsbD5 << 3) | (lsbD4 << 2) | (lsbD3 << 1) | lsbD2
      const d0w = (lsbD6 << 4) | (lsbD5 << 3) | (lsbD4 << 2) | (lsbD3 << 1) | lsbD2;

      // beq.b 0x51AC: if D0w == 0 skip increment + correction
      if (d0w !== 0) {
        // Increment counter long-BE @ A2[0x11..0x12]
        const counterLoAddr = addLong(a2u, COUNTER_LO_OFFSET);
        const counterHiAddr = addLong(a2u, COUNTER_HI_OFFSET);
        const oldLo = readByteFromWorkRam(state, counterLoAddr);
        const newLo = (oldLo + 1) & 0xff;
        writeByteToWorkRam(state, counterLoAddr, newLo);
        // bcc.b: if no carry from low add, skip
        if (oldLo === 0xff) {
          // Carry from low → increment hi
          const oldHi = readByteFromWorkRam(state, counterHiAddr);
          const newHi = (oldHi + 1) & 0xff;
          writeByteToWorkRam(state, counterHiAddr, newHi);
          // bcc.b: if no carry from hi, skip rollback
          if (oldHi === 0xff) {
            // Both bytes overflow → rollback (saturating)
            const lo = readByteFromWorkRam(state, counterLoAddr);
            writeByteToWorkRam(state, counterLoAddr, (lo - 1) & 0xff);
            const hi = readByteFromWorkRam(state, counterHiAddr);
            writeByteToWorkRam(state, counterHiAddr, (hi - 1) & 0xff);
          }
        }

        // btst.l #4, D0: bit 4 set?
        if ((d0w & 0x10) !== 0) {
          // Lookup table entry. D0w ∈ 0x10..0x1F → table index = D0w - 0x10.
          const tableIdx = (d0w - CORRECTION_TABLE_OFFSET) & 0xf;
          const tableVal = CORRECTION_TABLE[tableIdx]!;
          // bmi.b: if (signed byte) negative (= 0xFF) skip
          if ((tableVal & 0x80) === 0) {
            // eor.b D1b, (-0xa, A1, D0w*1): A1 = a1Initial + 10 (post inner loop).
            // Address = A1 - 10 + D0_after_lookup.
            // D0w after `move.b (-0x10,A4,D0w*1), D0b` is the table value (lookup
            // result), with high byte of D0w preserved (= 0). So D0w = tableVal
            // (which is in 0..9 if not 0xFF).
            const corrAddr = addLong(a1, signExtWord((tableVal - 10) & 0xffff));
            const old = readByteFromWorkRam(state, corrAddr);
            const newVal = (old ^ (d1 & 0xff)) & 0xff;
            writeByteToWorkRam(state, corrAddr, newVal);
            // Update outputBytes mirror if within output range (a1Initial..a1Initial+9).
            const off = (corrAddr - a1Initial) >>> 0;
            if (off < OUTPUT_BYTE_COUNT) {
              outputBytes[off] = newVal;
            }
          }
        } else {
          // bit 4 clear → uncorrectable
          d1 = (d1 | UNCORRECTABLE_FLAG) >>> 0;
        }
      }

      // add.b D1b, D1b: D1b *= 2, carry = old MSB.
      const oldD1b = d1 & 0xff;
      const newD1b = (oldD1b << 1) & 0xff;
      // Replace D1's low byte with newD1b.
      d1 = ((d1 & 0xffffff00) | newD1b) >>> 0;
      // bcc.b 0x5168: if no carry (= old MSB == 0) loop, else exit.
      if ((oldD1b & 0x80) !== 0) {
        // Carry → exit loop, then `move.b #0x1, D1b` → D1b = 1.
        d1 = ((d1 & 0xffffff00) | 0x01) >>> 0;
        break;
      }
    }
  }

  // ─── Read counter after correction (for result struct) ─────────────────
  const counterHi = readByteFromWorkRam(state, addLong(a2u, COUNTER_HI_OFFSET));
  const counterLo = readByteFromWorkRam(state, addLong(a2u, COUNTER_LO_OFFSET));
  const counterAfter = ((counterHi << 8) | counterLo) & 0xffff;

  // ─── Re-sync outputBytes from workRam to capture output/input aliasing ──
  for (let i = 0; i < OUTPUT_BYTE_COUNT; i++) {
    outputBytes[i] = readByteFromWorkRam(state, addLong(a1Initial, i));
  }

  // ─── Epilogue: D2 += 1, D3 += 1 (long), D0 = D1 ───────────────────────
  // addq.l operates on the full long. Callers usually pass only a word, but the
  // increment is long-sized: D2 = (D2 + 1). To simulate "long input", keep D2/D3
  // as longs with high word zero; the 0x4F38 prologue uses moveq, which zero-extends.
  const d2Long = signExtWord(d2u);
  const d3Long = signExtWord(d3u);
  const d2Out = addLong(d2Long, 1);
  const d3Out = addLong(d3Long, 1);

  return {
    d0: d1 >>> 0,
    d2Out,
    d3Out,
    outputBytes,
    counterAfter,
    corrected: (d1 & 0xff) === 1 && (d1 & UNCORRECTABLE_FLAG) === 0,
    uncorrectable: (d1 & UNCORRECTABLE_FLAG) !== 0,
    noError: d1 === 0,
  };
}
