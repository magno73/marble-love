/**
 * sort-adjacent-objects-1a7a8.ts — replica `FUN_0001A7A8` (98 byte).
 *
 * Works on the byte array in work RAM (`0x4003BC..0x4003DC`, 32 bytes). For
 * each walk index, it compares `(a[i], a[i+stride])`, resolves both through the
 * ROM lookup table @ `0x1F0E2` (16 entries x 4-byte pointers to the rectangle
 * structs at `0x4001DC`, stride 14 bytes), and swaps the **byte indices** in
 * work RAM when the comparator returns nonzero.
 *
 * The walk stops as soon as either byte is `0xFF` (terminator) or when the
 * bounded window reaches `0x20 - stride` (stride=1: 31, stride=2: 30, stride=3: 29).
 *
 * The result is partially sorted according to `FUN_1A80A`.
 *
 * **Disasm 0x1A7A8..0x1A809** (98 byte / 0x62):
 *
 *   0x1A7A8:  movem.l {A5 A4 A3 A2},-(SP)        ; preserve A2..A5 (16 byte)
 *   0x1A7AC:  moveq   #0,D0
 *   0x1A7AE:  move.b  (0x17,SP),D0b              ; D0.b = arg byte (LSB of the
 *                                                ;   caller-pushed long at SP+0x14;
 *                                                ;   +3 = LSB BE => SP+0x17)
 *   0x1A7B8:  movea.l A2,A3                      ; A3 = A2
 *   0x1A7BA:  adda.l  D0,A3                      ; A3 += D0 (stride)
 *   0x1A7BC:  lea     (0x20,A2),A5               ; A5 = A2 + 0x20 (sentinel-end exclusive)
 *   0x1A7C0:  lea     (0x1F0E2).l,A4             ; A4 = ROM lookup table base
 *
 *   loop @ 0x1A7C6:
 *   0x1A7C6:  cmpi.b  #-1,(A2)                   ; if byte[A2] == 0xFF
 *   0x1A7CA:  beq.b   0x1A804                    ;   exit
 *   0x1A7CC:  cmpi.b  #-1,(A3)                   ; if byte[A3] == 0xFF
 *   0x1A7D0:  beq.b   0x1A804                    ;   exit
 *   0x1A7D2:  moveq   #0,D0
 *   0x1A7D4:  move.b  (A3),D0b                   ; D0 = byte[A3] (zero-ext)
 *   0x1A7D6:  asl.l   #2,D0                      ; D0 = idx * 4
 *   0x1A7D8:  move.l  (0,A4,D0*1),-(SP)          ; push lookup[idx_A3] (long)
 *   0x1A7DC:  moveq   #0,D0
 *   0x1A7DE:  move.b  (A2),D0b                   ; D0 = byte[A2] (zero-ext)
 *   0x1A7E0:  asl.l   #2,D0
 *   0x1A7E2:  move.l  (0,A4,D0*1),-(SP)          ; push lookup[idx_A2] (long)
 *   0x1A7E6:  jsr     0x1A80A.l                  ; D0 = compare(lookup_A2, lookup_A3)
 *   0x1A7EC:  tst.l   D0
 *   0x1A7EE:  addq.l  #8,SP                      ; pop 2 long args
 *   0x1A7F0:  beq.b   0x1A7F8                    ; if D0 == 0, no swap
 *   0x1A7F2:  move.b  (A2),D0b                   ; saved = byte[A2]
 *   0x1A7F4:  move.b  (A3),(A2)                  ; byte[A2] = byte[A3]
 *   0x1A7F6:  move.b  D0b,(A3)                   ; byte[A3] = saved
 *
 *   0x1A7F8:  addq.l  #1,A2                      ; A2++
 *   0x1A7FA:  cmpa.l  A5,A2
 *   0x1A7FC:  beq.b   0x1A804                    ; if A2 == A5, exit
 *   0x1A7FE:  addq.l  #1,A3
 *   0x1A800:  cmpa.l  A5,A3
 *   0x1A802:  bne.b   0x1A7C6                    ; if A3 != A5, loop
 *
 *   0x1A804:  movem.l (SP)+,{A2 A3 A4 A5}        ; restore
 *   0x1A808:  rts                                ; (no return value semantically)
 *
 * **FUN_0001A80A** (rect compare, ~200 bytes). Receives two pointers (A1, A0)
 * to 14-byte structs with this shape:
 *
 *   off +0x2  word    "x_lo"   (left edge)
 *   off +0x4  word    "x_mid"  (?)
 *   off +0x6  word    "x_hi"   (right edge - top of D4/D2 sum)
 *   off +0x8  word    "y_lo"   (top edge)
 *   off +0xA  word    "y_mid"  (?)
 *   off +0xC  word    "y_hi"   (bottom edge - top of D3/D5 sum)
 *
 * A1 = arg1 = lookup_A2; A0 = arg2 = lookup_A3. The caller pushed the A3
 * pointer first, making it the argument visible at SP+0x18.
 *
 *   D4 = ext.l(+6,A1) + ext.l(+4,A1) + ext.l(+2,A1)        ; A1 sum-x
 *   D3 = ext.l(+C,A1) + ext.l(+A,A1) + ext.l(+8,A1)        ; A1 sum-y
 *   D2 = ext.l(+6,A0) + ext.l(+4,A0) + ext.l(+2,A0)        ; A0 sum-x
 *   D5 = ext.l(+C,A0) + ext.l(+A,A0) + ext.l(+8,A0)        ; A0 sum-y
 *
 *   if (D3 <= D2)            return 0   ; A1.sumY <= A0.sumX (cmp.l D2,D3 ≤)
 *   if (D5 <= D4)            return 1   ; A0.sumY <= A1.sumX
 *   if ((+4,A0).w >= (+A,A1).w)  return 0
 *   if ((+4,A1).w >= (+A,A0).w)  return 1
 *   if ((+2,A0).w >= (+8,A1).w)  return 0
 *   if ((+2,A1).w >= (+8,A0).w)  return 1
 *   if ((+6,A0).w >= (+C,A1).w)  return 0
 *   else                     return 1
 *
 * Called by FUN_1A7A8.
 *
 *
 *   1. **Arg byte LSB**: callers use `pea (0x1).w` (pushes 0x00000001 long);
 *      the model accepts the `stride` byte directly.
 *
 *
 *      iterations for stride > 0. For stride=0, both pointers advance in
 *      lockstep with identical exit conditions; max 32 iterations.
 *
 *   4. **Word reads in FUN_1A80A**: BE 16-bit signed words; sign-extended to
 *      long for `add.l` and `cmp.l`. The last four conditions use `cmp.w`, so
 *      they are signed-word compares, not long compares.
 *
 *      also for byte > 15; the table has 16 valid contiguous entries 0..15.
 *
 *
 *   - workRam[0x3BC..0x3DC] subisce 0..31 swap (a coppie distanti `stride`).
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Absolute M68k work RAM base. */
const WORK_RAM_BASE = 0x400000;
/** Exclusive upper work RAM bound. */
const WORK_RAM_END = 0x402000;

export const BYTE_ARRAY_OFF = 0x3bc as const;
export const BYTE_ARRAY_LEN = 0x20 as const;
export const SENTINEL_BYTE = 0xff as const;

/** ROM offset of the 16x4 lookup table (absolute M68k pointers). */
export const ROM_LOOKUP_OFF = 0x1f0e2 as const;
/** Number of lookup-table entries (entry = 4-byte long pointer). */
export const ROM_LOOKUP_COUNT = 16 as const;

/**
 *
 */
function readU32BE(buf: Uint8Array, off: number): number {
  const o = off | 0;
  const b0 = (buf[o] ?? 0) & 0xff;
  const b1 = (buf[o + 1] ?? 0) & 0xff;
  const b2 = (buf[o + 2] ?? 0) & 0xff;
  const b3 = (buf[o + 3] ?? 0) & 0xff;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

/**
 *
 */
function readU16WorkRamAbs(state: GameState, abs: number): number {
  const a = abs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return 0;
  const off = a - WORK_RAM_BASE;
  const b0 = (state.workRam[off] ?? 0) & 0xff;
  const b1 = (state.workRam[off + 1] ?? 0) & 0xff;
  return ((b0 << 8) | b1) & 0xffff;
}

/** Sign-extend word (16-bit) to a 32-bit signed JS number. */
function s16(w: number): number {
  const x = w & 0xffff;
  return x & 0x8000 ? x - 0x10000 : x;
}

/**
 * Replica `FUN_0001A80A` - rect overlap / z-order compare.
 *
 * Inputs: two absolute M68k pointers to 14-byte structs in work RAM.
 *
 * isolata.
 *
 * @param ptrA1  Pointer to rect A1 (absolute M68k, typically 0x4001DC..).
 * @param ptrA0  Pointer to rect A0.
 * @returns      `0` or `1` (long, observed only as zero vs nonzero).
 */
export function fun1A80A(
  state: GameState,
  ptrA1: number,
  ptrA0: number,
): number {
  // Word reads
  const a1_2 = readU16WorkRamAbs(state, ptrA1 + 2);
  const a1_4 = readU16WorkRamAbs(state, ptrA1 + 4);
  const a1_6 = readU16WorkRamAbs(state, ptrA1 + 6);
  const a1_8 = readU16WorkRamAbs(state, ptrA1 + 8);
  const a1_a = readU16WorkRamAbs(state, ptrA1 + 0xa);
  const a1_c = readU16WorkRamAbs(state, ptrA1 + 0xc);

  const a0_2 = readU16WorkRamAbs(state, ptrA0 + 2);
  const a0_4 = readU16WorkRamAbs(state, ptrA0 + 4);
  const a0_6 = readU16WorkRamAbs(state, ptrA0 + 6);
  const a0_8 = readU16WorkRamAbs(state, ptrA0 + 8);
  const a0_a = readU16WorkRamAbs(state, ptrA0 + 0xa);
  const a0_c = readU16WorkRamAbs(state, ptrA0 + 0xc);

  // Long sums (ext.l + add.l): no overflow risk with 16-bit signed * 3.
  const D4 = s16(a1_6) + s16(a1_4) + s16(a1_2);
  const D3 = s16(a1_c) + s16(a1_a) + s16(a1_8);
  const D2 = s16(a0_6) + s16(a0_4) + s16(a0_2);
  const D5 = s16(a0_c) + s16(a0_a) + s16(a0_8);

  // 0x1A86E: cmp.l D2,D3; bgt → 1A878. bgt = D3 > D2. Else (D3 <= D2) → return 0.
  if (D3 <= D2) return 0;
  // 0x1A878: cmp.l D4,D5; bgt → 1A880. bgt = D5 > D4. Else (D5 <= D4) → return 1.
  if (D5 <= D4) return 1;

  // 0x1A880: word compares, signed.
  // cmp.w (0xa,A1),D0w  (D0w = (+4,A0).w).  blt → 1A88E. blt = D0w < (+a,A1).w
  //    Else (D0w >= a1_a) → return 0.
  if (s16(a0_4) >= s16(a1_a)) return 0;
  // cmp.w (0xa,A0),D0w  (D0w = (+4,A1).w). blt → 1A89C. Else → return 1.
  if (s16(a1_4) >= s16(a0_a)) return 1;
  // cmp.w (0x8,A1),D0w  (D0w = (+2,A0).w). blt → 1A8AA. Else → return 0.
  if (s16(a0_2) >= s16(a1_8)) return 0;
  // cmp.w (0x8,A0),D0w  (D0w = (+2,A1).w). blt → 1A8B8. Else → return 1.
  if (s16(a1_2) >= s16(a0_8)) return 1;
  // cmp.w (0xc,A1),D0w  (D0w = (+6,A0).w). blt → 1A8C6. Else → return 0.
  if (s16(a0_6) >= s16(a1_c)) return 0;
  // moveq #1
  return 1;
}

/**
 * Resolve the pointer indexed by the ROM lookup table.
 *
 * @param rom        ROM image (program).
 * @param byteIdx    Byte index 0..255 (zero-extended from FUN_1A7A8 move.b).
 */
export function lookupRectPtr(rom: RomImage, byteIdx: number): number {
  const idx = byteIdx & 0xff;
  // Read long BE @ ROM[0x1F0E2 + idx*4]
  return readU32BE(rom.program, ROM_LOOKUP_OFF + idx * 4) >>> 0;
}

/**
 * Lets parity tests isolate a bad 1A7A8 replica from a bad 1A80A replica.
 */
export interface SortAdjacentObjects1A7A8Subs {
  /**
   *
   * @param state  GameState.
   * @param ptrA1  Pointer to rect A1 (lookup of byte[A2_walk]).
   * @param ptrA0  Pointer to rect A0 (lookup of byte[A3_walk]).
   * @returns      0 or 1 (observed only as zero vs nonzero).
   */
  compare?: (state: GameState, ptrA1: number, ptrA0: number) => number;
}

/**
 * Replica `FUN_0001A7A8` - single-pass adjacent-pair sweep with stride.
 *
 * See the file header for disassembly and semantics.
 *
 * @param state    GameState (workRam[0x3BC..0x3DC) MUTATO via swap).
 * @param stride   Byte stride between A2 and A3 (caller arg LSB). Known callers
 *                 pass 1, 2, 3 in sequence. Valid range 0..31.
 *                 - `0`: A2 == A3, so swap is no-op, but the loop advances until
 *                   first 0xFF o up to A2 == A5 (32 iter max).
 * @param subs     Callback bag (default = inline).
 *
 * **Mutation**: only `workRam[0x3BC..0x3DC)`. Rect structs at `0x1DC..`
 */
export function sortAdjacentObjects1A7A8(
  state: GameState,
  rom: RomImage,
  stride: number,
  subs: SortAdjacentObjects1A7A8Subs = {},
): void {
  const compare = subs.compare ?? fun1A80A;

  // D0 = byte arg (LSB of the caller-pushed long), modeled directly.
  const strideByte = stride & 0xff;

  // A2, A3, and A5 as internal work RAM offsets.
  let a2Off: number = BYTE_ARRAY_OFF; // 0x3BC
  let a3Off: number = (BYTE_ARRAY_OFF + strideByte) | 0; // 0x3BC + stride
  const a5Off: number = (BYTE_ARRAY_OFF + BYTE_ARRAY_LEN) | 0; // 0x3DC

  const r = state.workRam;

  // Read helper used until either cursor reaches a5Off.
  const read8 = (off: number): number => (r[off] ?? 0) & 0xff;

  let safety = BYTE_ARRAY_LEN + 1; // 33 defensive cap.
  while (safety-- > 0) {
    // 0x1A7C6: cmpi.b #-1,(A2); beq exit
    if (read8(a2Off) === SENTINEL_BYTE) break;
    // 0x1A7CC: cmpi.b #-1,(A3); beq exit
    // proceeds. Model exactly the same behavior (raw read).
    if (read8(a3Off) === SENTINEL_BYTE) break;

    // 0x1A7D2..0x1A7E2: lookup ROM and push args (modeled as local vars).
    const idxA2 = read8(a2Off);
    const idxA3 = read8(a3Off);
    const ptrA1 = lookupRectPtr(rom, idxA2); // arg second-pushato → A1 in 1A80A
    const ptrA0 = lookupRectPtr(rom, idxA3); // arg first-pushato → A0 in 1A80A

    // 0x1A7E6: jsr 1A80A
    const cmp = compare(state, ptrA1, ptrA0) | 0;

    // 0x1A7EC..0x1A7F6: if cmp != 0 → swap
    if (cmp !== 0) {
      const saved = read8(a2Off);
      r[a2Off] = read8(a3Off);
      r[a3Off] = saved;
    }

    // 0x1A7F8: addq.l #1,A2
    a2Off = (a2Off + 1) | 0;
    // 0x1A7FA: cmpa.l A5,A2; beq exit
    if (a2Off === a5Off) break;
    // 0x1A7FE: addq.l #1,A3
    a3Off = (a3Off + 1) | 0;
    // 0x1A800: cmpa.l A5,A3; bne loop (else exit)
    if (a3Off === a5Off) break;
  }
}
