/**
 * Bit-perfect port of `FUN_000041C8`.
 *
 * Decodes one 5-byte high-score table entry into the 7-byte work buffer at
 * `0x401F7A`: a 24-bit big-endian score stored as a long, followed by three
 * ASCII initials unpacked from a radix-40 word.
 *
 * Source table: `*0x401FFC + 0x1E`, shared with the rank-search helper. Each
 * record is laid out as three score bytes followed by a 16-bit big-endian
 * radix-40 initials word. Digits are extracted from least significant to most
 * significant, then written back in display order at buffer bytes +4..+6.
 *
 * Radix-40 mapping from the binary:
 * - 0 -> space
 * - 1..26 -> 'A'..'Z'
 * - 27..39 -> '0'..'<'
 *
 * **Disasm 0x41C8..0x428C** (198 byte / 0xC6):
 *
 *   0x41C8  movem.l {D5 D4 D3 D2},-(SP)         ; preserve D2,D3,D4,D5 (16 byte)
 *   0x41CC  move.l  (0x14,SP),D2                ; D2 = arg1 (record index)
 *   0x41D0  movea.l #0x401F7A,A1                ; A1 = output buffer (workRam)
 *   0x41D6  movea.l (0x00401FFC).l,A0           ; A0 = *0x401FFC (long ptr)
 *   0x41DC  moveq   #0x1E,D0
 *   0x41DE  adda.l  D0,A0                       ; A0 = ptr + 0x1E (table base)
 *   0x41E0  move.l  A0,D5                       ; D5 = table base (preserved)
 *   0x41E2  moveq   #0x9,D0
 *   0x41E4  cmp.l   D2,D0                       ; flags = 9 - arg1 (long)
 *   0x41E6  bcc.b   0x41EE                      ; bcc: 9 >= arg1 unsigned -> work
 *   0x41E8  moveq   #0x0,D0                     ; out-of-range: D0 = 0
 *   0x41EA  bra.w   0x4288                      ; -> epilogue (no buffer write)
 *
 *   0x41EE: movea.l D2,A0                        ; A0 = arg1 (long)
 *   0x41F0  asl.l   #0x2,D2                     ; D2 = arg1 * 4
 *   0x41F2  add.l   A0,D2                       ; D2 = arg1 * 5 (record byte off)
 *
 *   ; --- Read 24-bit BE score, store as long @ A1 (high byte = 0) ---
 *   0x41F4  move.l  D2,D0
 *   0x41F6  addq.l  #0x2,D0                     ; D0 = arg1*5 + 2
 *   0x41F8  movea.l D0,A0
 *   0x41FA  adda.l  D5,A0                       ; A0 = base + +2
 *   0x41FC  moveq   #0,D0
 *   0x41FE  move.b  (A0),D0b                    ; D0 = byte[+2] (zero-ext)
 *   0x4200  move.l  D2,D1
 *   0x4202  addq.l  #0x1,D1                     ; D1 = arg1*5 + 1
 *   0x4204  movea.l D1,A0
 *   0x4206  adda.l  D5,A0                       ; A0 = base + +1
 *   0x4208  moveq   #0,D3
 *   0x420A  move.b  (A0),D3b                    ; D3 = byte[+1]
 *   0x420C  lsl.l   #0x8,D3                     ; D3 = byte[+1] << 8
 *   0x420E  movea.l D2,A0
 *   0x4210  adda.l  D5,A0                       ; A0 = base + +0
 *   0x4212  moveq   #0,D4
 *   0x4214  move.b  (A0),D4b                    ; D4 = byte[+0]
 *   0x4216  moveq   #0x10,D1
 *   0x4218  lsl.l   D1,D4                       ; D4 = byte[+0] << 16
 *   0x421A  move.l  D4,D1                       ; D1 = byte[+0] << 16
 *   0x421C  add.l   D1,D3                       ; D3 = (b0<<16) | (b1<<8)
 *   0x421E  add.l   D3,D0                       ; D0 = b2 | (b1<<8) | (b0<<16)
 *   0x4220  move.l  D0,(A1)                     ; *A1 = score (4 byte BE, high=0)
 *
 *   ; --- Read 16-bit BE word @ +3 (radix-40 packed initials) ---
 *   0x4222  movea.l D2,A0
 *   0x4224  addq.l  #0x4,A0                     ; A0 = arg1*5 + 4
 *   0x4226  adda.l  D5,A0                       ; A0 = base + +4
 *   0x4228  moveq   #0,D3
 *   0x422A  move.b  (A0),D3b                    ; D3 = byte[+4] (low)
 *   0x422C  move.l  D2,D0
 *   0x422E  addq.l  #0x3,D0                     ; D0 = arg1*5 + 3
 *   0x4230  movea.l D0,A0
 *   0x4232  adda.l  D5,A0                       ; A0 = base + +3
 *   0x4234  moveq   #0,D0
 *   0x4236  move.b  (A0),D0b                    ; D0 = byte[+3]
 *   0x4238  lsl.w   #0x8,D0w                    ; D0.w = byte[+3] << 8
 *   0x423A  add.w   D0w,D3w                     ; D3.w = (b3<<8) | b4 (BE word)
 *
 *   ; --- Loop 3 iterations: extract base-40 digits, write ASCII to A1+4..A1+6 ---
 *   0x423C  moveq   #0x2,D2                     ; D2 = 2 (loop counter, also write idx)
 *   0x423E: moveq   #0,D0
 *   0x4240  move.w  D3w,D0w                     ; D0 = D3.w (zero-ext)
 *   0x4242  divu.w  #0x28,D0                    ; D0.w = quot, swap.w = rem
 *   0x4246  swap    D0
 *   0x4248  andi.l  #0xFFFF,D0                  ; D0 = remainder (0..39)
 *   0x424E  move.w  D0w,D1w                     ; D1.w = remainder
 *   0x4250  bne.b   0x4256                      ; rem != 0 -> letter/digit branch
 *   0x4252  moveq   #0x20,D1                    ; rem == 0 -> D1 = 0x20 (' ')
 *   0x4254  bra.b   0x4266
 *   0x4256: moveq   #0x1A,D0
 *   0x4258  cmp.w   D1w,D0w                     ; flags = 0x1A - rem
 *   0x425A  bcc.b   0x4262                      ; bcc: 0x1A >= rem -> letter
 *   0x425C  addi.w  #0x15,D1w                   ; rem > 0x1A: D1 = rem + 0x15 (digit)
 *   0x4260  bra.b   0x4266
 *   0x4262: addi.w  #0x40,D1w                   ; rem <= 0x1A: D1 = rem + 0x40 (letter)
 *   0x4266: move.w  D2w,D0w                     ; D0 = loop counter (= write index)
 *   0x4268  lea     (0x4,A1),A0                 ; A0 = A1 + 4 (= 0x401F7E)
 *   0x426C  move.b  D1b,(0x0,A0,D0w*0x1)        ; *(A0 + D2) = D1.b (ASCII char)
 *   0x4270  moveq   #0,D0
 *   0x4272  move.w  D3w,D0w                     ; D0 = D3.w
 *   0x4274  divu.w  #0x28,D0                    ; D0.w = quot, hi.w = rem
 *   0x4278  andi.l  #0xFFFF,D0                  ; D0 = quotient only
 *   0x427E  move.w  D0w,D3w                     ; D3.w = quotient (next digit)
 *   0x4280  subq.w  #0x1,D2w
 *   0x4282  tst.w   D2w
 *   0x4284  bge.b   0x423E                      ; loop while D2.w >= 0 (signed)
 *
 *   0x4286  move.l  A1,D0                       ; D0 = A1 (return pointer)
 *   0x4288  movem.l (SP)+,{D2 D3 D4 D5}
 *   0x428C  rts
 *
 * Bit-perfect notes:
 * - the range check is unsigned, so sign-extended negative indices are out of
 *   range and return 0 without writing the output buffer;
 * - the record offset is `arg1 * 5`;
 * - `divu.w #40` yields quotient in the low word and remainder in the high
 *   word, matching the `swap`/`andi` extraction pattern;
 * - valid inputs write exactly seven bytes at `0x401F7A..0x401F80`, invalid
 *   inputs write nothing.
 *
 * **Stack layout** at body entry, after the 16-byte `movem.l`:
 *   SP+0x00..0x0F  saved D2,D3,D4,D5
 *   SP+0x10..0x13  return PC
 *   SP+0x14..0x17  arg1 long (record index)
 *
 * Caller: `thunk_FUN_000041C8` @ 0x1AE (jmp.l), reached from `FUN_00011FF8`.
 * Parity is covered by `test-hi-score-decode-41c8-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Work RAM offset of the long pointer at `0x401FFC`. */
const PTR_FFC_OFF = 0x1ffc;

/** Byte offset from the long pointer to the high-score table head. */
export const TABLE_OFF_FROM_PTR = 0x1e as const;

/** Maximum valid record index. */
export const MAX_INDEX = 9 as const;

/** Record stride in bytes. */
export const RECORD_STRIDE = 5 as const;

/** Absolute 68k address of the work RAM output buffer. */
export const OUTPUT_BUFFER_ADDR = 0x00401f7a as const;

/** Work RAM offset of the output buffer. */
export const OUTPUT_BUFFER_OFF = OUTPUT_BUFFER_ADDR - 0x00400000;

/** Output byte count: 4 score bytes plus 3 initials bytes. */
export const OUTPUT_BUFFER_LEN = 7 as const;

/** Radix-40 alphabet size. */
const RADIX = 0x28; // 40

/** Number of unpack loop iterations, one per initial. */
const NUM_DIGITS = 3;

/** Absolute 68k work RAM base. */
const WORK_RAM_BASE = 0x400000;

/** Exclusive upper bound of work RAM. */
const WORK_RAM_END = 0x402000;

/** Return code "index out of range" (`arg1 > 9` unsigned). M68k = 0x00000000. */
export const RET_INDEX_OOR = 0x00000000 as const;

/**
 * Read a big-endian long from work RAM at an offset.
 */
function readLongBE(workRam: Uint8Array, off: number): number {
  return (
    (((workRam[off] ?? 0) << 24) |
      ((workRam[off + 1] ?? 0) << 16) |
      ((workRam[off + 2] ?? 0) << 8) |
      (workRam[off + 3] ?? 0)) >>>
    0
  );
}

/**
 * Read an absolute 68k work RAM byte. Out-of-range addresses read as 0 because
 * the modeled bus only covers work RAM here.
 */
function read8(workRam: Uint8Array, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

/**
 * Map a radix-40 digit to ASCII using the exact binary branch structure.
 *
 *   digit == 0           -> 0x20 (' ')
 *   1 <= digit <= 0x1A   -> digit + 0x40 ('A'..'Z')
 *   0x1B <= digit <= 0x27 -> digit + 0x15 ('0'..'<')
 *
 * Digits >= 40 are unreachable after `divu.w #40`; this helper intentionally
 * does not clamp them.
 */
function radix40ToAscii(digit: number): number {
  // Bit-perfect branch structure:
  //   bne.b 0x4256       (rem != 0 -> non-space)
  //   moveq #0x20,D1     (rem == 0 -> space)
  //   ...
  //   moveq #0x1A,D0; cmp.w D1w,D0w; bcc -> letter; addi.w #0x15 -> digit/symbol
  if (digit === 0) {
    return 0x20;
  }
  // bcc on `cmp.w D1w,D0w` with D0 = 0x1A: branch if 0x1A >= rem unsigned.
  // bcc -> letter path (+0x40). bcs (rem > 0x1A) -> digit/symbol path (+0x15).
  if (digit <= 0x1a) {
    return (digit + 0x40) & 0xff;
  }
  return (digit + 0x15) & 0xff;
}

/**
 * Decode one high-score entry into the `0x401F7A` output buffer.
 *
 * @param state Game state; valid indices mutate work RAM output bytes.
 * @param arg1 Record index compared as an unsigned 32-bit value.
 * @returns D0: 0 for out-of-range, otherwise `0x00401F7A`.
 */
export function hiScoreDecode41c8(state: GameState, arg1: number): number {
  const arg1l = arg1 >>> 0;

  // Range check: `9 >= arg1` unsigned (`bcc` after `cmp.l`).
  if (arg1l > MAX_INDEX) {
    return RET_INDEX_OOR;
  }

  // A0 = *0x401FFC; D5 = A0 + 0x1E (table base).
  const ptr = readLongBE(state.workRam, PTR_FFC_OFF);
  const tableBase = (ptr + TABLE_OFF_FROM_PTR) >>> 0;

  // D2 = arg1 * 5 (record byte offset).
  // M68k: asl.l #2 (= *4), add A0 (= *5). arg1 in [0..9] -> D2 in [0..45].
  const recordOff = ((arg1l * RECORD_STRIDE) >>> 0);

  // Read 24-bit BE score @ base + recordOff..+2.
  const b0 = read8(state.workRam, (tableBase + recordOff) >>> 0);
  const b1 = read8(state.workRam, (tableBase + recordOff + 1) >>> 0);
  const b2 = read8(state.workRam, (tableBase + recordOff + 2) >>> 0);
  // M68k: D0 = b2 + (b1<<8) + (b0<<16). High byte = 0 (b0 max 0xFF).
  const scoreLong = (((b0 << 16) | (b1 << 8) | b2) >>> 0) & 0xffffff;

  // Read 16-bit BE word @ base + recordOff + 3.
  // M68k: D3.w = (byte[+3] << 8) | byte[+4]. High word D3 = 0.
  const b3 = read8(state.workRam, (tableBase + recordOff + 3) >>> 0);
  const b4 = read8(state.workRam, (tableBase + recordOff + 4) >>> 0);
  let packed = ((b3 << 8) | b4) & 0xffff;

  // Write score long BE @ A1 (= 0x401F7A..0x401F7D).
  state.workRam[OUTPUT_BUFFER_OFF + 0] = (scoreLong >>> 24) & 0xff;
  state.workRam[OUTPUT_BUFFER_OFF + 1] = (scoreLong >>> 16) & 0xff;
  state.workRam[OUTPUT_BUFFER_OFF + 2] = (scoreLong >>> 8) & 0xff;
  state.workRam[OUTPUT_BUFFER_OFF + 3] = scoreLong & 0xff;

  // Unpack 3 radix-40 digits in display order (digit0 -> +6, digit2 -> +4).
  // M68k: D2 = 2 (loop counter / write index), decremented as a word to -1.
  // Iter k (k = 2, 1, 0):
  //   rem = packed % 40       -> digit corrente (LSB)
  //   chr = ascii(rem)
  //   *(A1 + 4 + k) = chr     -> A1+4 = 0x401F7E. k=2 -> +6, k=1 -> +5, k=0 -> +4.
  //   packed = packed / 40    -> sposta al digit successivo
  for (let k = NUM_DIGITS - 1; k >= 0; k--) {
    const digit = packed % RADIX;
    const chr = radix40ToAscii(digit);
    state.workRam[OUTPUT_BUFFER_OFF + 4 + k] = chr & 0xff;
    packed = (packed / RADIX) | 0;
  }

  // ── D0 = A1 (= 0x00401F7A) ──
  return OUTPUT_BUFFER_ADDR;
}
