/**
 * Bit-perfect port of `FUN_00004686`.
 *
 * Table-driven rank lookup for a 24-bit key inside the sorted 10-row table
 * pointed to by `*0x401FFC + 0x1E`. It is self-contained: no JSRs, no MMIO,
 * and no work RAM writes. D0 returns a signed long.
 *
 * The exact xref is indirect in the ROM; the observed behavior is a
 * pre-processing rank lookup around the gate-check path in `FUN_0000472A`.
 *
 * **Disasm 0x4686..0x4729** (164 byte):
 *
 *   0x4686  link.w  A6,-0x4              ; locals[4] @ A6-4
 *   0x468a  movem.l {D4 D3 D2},-(SP)     ; preserve D2/D3/D4
 *   0x468e  move.l  (0x8,A6),D2          ; D2 = arg long (caller pushed)
 *   0x4692  move.l  (0x00401FFC).l,D1    ; D1 = *0x401FFC (struct base ptr)
 *   0x4698  moveq   #0x1E,D0
 *   0x469a  add.l   D0,D1                ; D1 = ptr + 0x1E (table base)
 *   0x469c  move.l  D1,D4                ; D4 = table base (long)
 *   0x469e  moveq   #2,D3                ; D3 = 2 (loop counter)
 *   ; pack D2 into three big-endian key bytes in locals[0..2]
 *   0x46a0  loop_pack:
 *   0x46a0  move.w  D3w,D1w              ; D1.w = D3.w (= idx in locals)
 *   0x46a2  lea     (-0x4,A6),A0         ; A0 = &locals[0]
 *   0x46a6  move.b  D2b,D0b              ; D0.b = D2.b (low byte)
 *   0x46a8  andi.b  #-0x1,D0b            ; D0 &= 0xFF (effettivo no-op)
 *   0x46ac  move.b  D0b,(0x0,A0,D1w*1)   ; locals[D3] = D2.b
 *   0x46b0  move.l  D2,D1
 *   0x46b2  lsr.l   #8,D1                ; D1 = D2 >> 8
 *   0x46b4  move.l  D1,D2                ; D2 >>= 8
 *   0x46b6  subq.w  #1,D3w               ; D3--
 *   0x46b8  tst.w   D3w
 *   0x46ba  bge.b   0x46a0               ; while D3 >= 0 (3 iter: 2,1,0)
 *   ; after the loop: locals[0..2] hold the low 24-bit key; D2 is arg >> 24.
 *   0x46bc  tst.l   D2
 *   0x46be  beq.b   0x46c6               ; continue if arg fits in 24 bits
 *   0x46c0  moveq   #-1,D0               ; otherwise D0 = -1
 *   0x46c2  bra.w   0x4722               ; → exit (return -1)
 *   ; outer loop: row offsets {0,5,10,...,45}
 *   0x46c6  clr.w   D3w                  ; D3 = 0 (outer = row*5 byte offset)
 *   0x46c8  outer_top:
 *   0x46c8  clr.w   D2w                  ; D2 = 0 (inner = colonna 0..2)
 *   0x46ca  inner_top:
 *   0x46ca  move.w  D2w,D0w              ; D0 = inner zext
 *   0x46cc  ext.l   D0
 *   0x46ce  move.w  D3w,D1w              ; D1 = outer zext
 *   0x46d0  ext.l   D1
 *   0x46d2  add.l   D1,D0                ; D0 = outer + inner (byte offset)
 *   0x46d4  movea.l D0,A0
 *   0x46d6  adda.l  D4,A0                ; A0 = table[outer+inner] address
 *   0x46d8  move.b  (A0),D0b             ; D0.b = table[outer+inner]
 *   0x46da  move.w  D2w,D1w              ; D1.w = inner
 *   0x46dc  lea     (-0x4,A6),A0         ; A0 = &locals[0]
 *   0x46e0  cmp.b   (0x0,A0,D1w*1),D0b   ; flags = locals[inner] - tableByte
 *   0x46e4  bhi.w   0x4718               ; bhi: locals > tableByte (unsigned)
 *                                          ; → row failed, advance row
 *   ; locals[inner] <= tableByte
 *   0x46e8  move.w  D2w,D0w              ; identical recompute
 *   0x46ea  ext.l   D0
 *   0x46ec  move.w  D3w,D1w
 *   0x46ee  ext.l   D1
 *   0x46f0  add.l   D1,D0
 *   0x46f2  movea.l D0,A0
 *   0x46f4  adda.l  D4,A0
 *   0x46f6  move.b  (A0),D0b             ; D0.b = table[outer+inner] (of nuovo)
 *   0x46f8  move.w  D2w,D1w
 *   0x46fa  lea     (-0x4,A6),A0
 *   0x46fe  cmp.b   (0x0,A0,D1w*1),D0b
 *   0x4702  bcc.b   0x4710               ; bcc: locals >= tableByte (unsigned)
 *                                          ; equality after `bhi` was excluded
 *                                          ; → next with the
 *   ; locals[inner] < tableByte → MATCH FOUND
 *   0x4704  move.w  D3w,D0w              ; D0 = outer
 *   0x4706  ext.l   D0
 *   0x4708  divs.w  #5,D0                ; D0 = outer / 5 (signed div)
 *                                          ; risultato in D0w (.w in low,
 *                                          ; resto in D0 high word)
 *   0x470c  ext.l   D0                   ; sign-ext D0w → D0l
 *   0x470e  bra.b   0x4722               ; → exit
 *   ; equality case: advance inner
 *   0x4710  addq.w  #1,D2w               ; inner++
 *   0x4712  moveq   #3,D0
 *   0x4714  cmp.w   D2w,D0w              ; flags = D0(=3) - D2(=inner)
 *   0x4716  bgt.b   0x46ca               ; bgt: 3 > inner (signed) → next with the
 *                                          ; loop while inner < 3 (cols 0,1,2)
 *   ; exact row equality advances to the next row instead of matching here
 *   0x4718  addq.w  #5,D3w               ; outer += 5 (row stride)
 *   0x471a  moveq   #0x32,D0
 *   0x471c  cmp.w   D3w,D0w              ; flags = D0(=0x32) - D3
 *   0x471e  bgt.b   0x46c8               ; bgt: 0x32 > outer → next row
 *                                          ; 10 rows max: outer 0,5,...,45
 *   ; all 10 rows consumed without a match
 *   0x4720  moveq   #10,D0               ; D0 = 10 (default rank "out-of-range")
 *   0x4722  exit:
 *   0x4722  movem.l (SP)+,{D4 D3 D2}
 *   0x4726  unlk    A6
 *   0x4728  rts
 *
 * Behavior:
 * - the argument must fit in 24 bits or the return value is -1;
 * - only the first three bytes of each 5-byte row participate in the compare;
 * - `cmp.b src,dst` compares `tableByte - keyByte`;
 * - a table prefix greater than the key advances to the next row;
 * - a table prefix less than the key returns the row index;
 * - an exact three-byte equality advances to the next row because the ROM
 *   rechecks the same byte with `bcc` after filtering strict greater.
 *
 * Layout of 4-byte locals at A6-4:
 *
 *   locals[0] = (arg >> 16) & 0xFF   ; high byte of the 24-bit key
 *   locals[1] = (arg >> 8)  & 0xFF
 *   locals[2] =  arg        & 0xFF   ; low byte
 *   locals[3] = uninitialized and never read
 *
 * Table at `ptr+0x1E`: 10 rows x 5 bytes. Only the first three bytes of each
 * row are compared; the last two bytes are payload or padding.
 *
 * Side effects: none. Reads only:
 *   - workRam @ 0x401FFC (4 byte ptr long)
 *   - workRam @ ptr+0x1E .. ptr+0x1E+47 (50 table bytes)
 *
 * MMIO: none. JSR: none.
 *
 * Stack/register conventions:
 *   - link.w A6,-0x4: A6 = SP (post-link), SP -= 4 per locals.
 *     Argomento a (0x8, A6) = caller's pushed long (stack post-jsr =
 *     ret_addr@0, A6_saved@4, arg@8 before SP -= 4).
 *   - movem.l {D4,D3,D2},-(SP): preserve D2/D3/D4 (12 byte).
 *   - Restauro inverso: movem.l (SP)+,{D2,D3,D4} (m68k movem reverse order).
 *
 * **Verifica bit-perfect**: `cli/src/test-key-rank-lookup-4686-parity.ts`
 *   (500 cases).
 */

import type { GameState } from "./state.js";

/** WorkRam offset of the long pointer @ 0x401FFC. */
const PTR_FFC_OFF = 0x1ffc;

/** RAM base. */
const WORK_RAM_BASE = 0x400000;

/** Byte offset from the base pointer to the table head. */
const TABLE_OFF_FROM_PTR = 0x1e;

/** Number of rows in the table. */
const NUM_ROWS = 10;

/** Row stride in bytes. */
const ROW_STRIDE = 5;

/** Number of compared columns per row. */
const KEY_LEN = 3;

/**
 * Rank lookup for a 24-bit key in the table pointed to by `*0x401FFC + 0x1E`.
 *
 * @returns -1 when the key does not fit in 24 bits, 0..9 for the first row
 *          whose prefix is strictly less than the key, or 10 when none match.
 */
export function keyRankLookup4686(state: GameState, argLong: number): number {
  const r = state.workRam;

  // ─── Estrai key bytes (BE) and high byte ───────────────────────────────
  // Equivalente al loop @ 0x46a0..0x46ba.
  const arg = argLong >>> 0;
  const argB0 = (arg >>> 24) & 0xff; // testato a 0x46bc
  const argB1 = (arg >>> 16) & 0xff; // locals[0]
  const argB2 = (arg >>> 8) & 0xff;  // locals[1]
  const argB3 = arg & 0xff;          // locals[2]

  // High byte must be zero; otherwise return -1.
  if (argB0 !== 0) {
    // moveq #-1,D0 → D0 = 0xFFFFFFFF (signed -1).
    // TypeScript represents the 0xFFFFFFFF long return as signed -1.
    return -1;
  }

  // locals[3] exists in the stack frame but is never initialized or read.
  const locals = [argB1, argB2, argB3];

  // Read pointer from *0x401FFC (long BE).
  const ptr =
    (((r[PTR_FFC_OFF] ?? 0) << 24) |
      ((r[PTR_FFC_OFF + 1] ?? 0) << 16) |
      ((r[PTR_FFC_OFF + 2] ?? 0) << 8) |
      (r[PTR_FFC_OFF + 3] ?? 0)) >>>
    0;
  const tableBase = ((ptr - WORK_RAM_BASE) >>> 0) + TABLE_OFF_FROM_PTR;

  // Motorola `cmp.b src,dst` computes `dst - src`. Here dst is tableByte and
  // src is keyByte, so greater table prefixes skip rows, smaller prefixes
  // return, and exact three-byte equality falls through to the next row.
  for (let outer = 0; outer < NUM_ROWS * ROW_STRIDE; outer += ROW_STRIDE) {
    let advanceRow = false;
    for (let inner = 0; inner < KEY_LEN; inner++) {
      const tableByte = (r[tableBase + outer + inner] ?? 0) & 0xff;
      const keyByte = locals[inner]! & 0xff;

      // `bhi`: tableByte > keyByte unsigned, advance row.
      if (tableByte > keyByte) {
        advanceRow = true;
        break;
      }
      // `bcc` after the `bhi` filter means equality, so advance inner column.
      if (tableByte === keyByte) {
        continue;
      }
      // `bcs`: tableByte < keyByte, return outer/5.
      return (outer / ROW_STRIDE) | 0;
    }
    if (!advanceRow) {
      // Exact three-byte equality does not match this row; it advances to the
      // next row exactly as the ROM does.
      continue;
    }
    // advanceRow=true -> outer += 5 on next iter (already done by `for`)
  }

  // No row with prefix < key: return 10.
  return NUM_ROWS;
}
