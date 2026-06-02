/**
 * Bit-perfect port of `FUN_00015FE6`.
 *
 * Compares two active object structs and returns 1 when obj1 should sort after
 * obj2. Equal z-order falls back to a signed comparison of coarse `(x+y)`
 * cell sums; different z-order uses signed byte order.
 *
 * M68k prologue/epilogue:
 *   `movem.l {D4 D3 D2}, -(SP)` saves D4,D3,D2 (12 bytes)
 *   `movea.l (0x10,SP), A1` gives arg1 (first pushed long)
 *   `movea.l (0x14,SP), A0` — A0 = arg2
 *   …
 *   `movem.l (SP)+, {D2 D3 D4}` + `rts`
 *
 * **Full disassembly** (0x15FE6..0x1605B, 118 bytes, 44 instr):
 *
 *   00015fe6  movem.l {D4 D3 D2},-(SP)
 *   00015fea  movea.l (0x10,SP),A1       ; A1 = arg1 (obj1 ptr)
 *   00015fee  movea.l (0x14,SP),A0       ; A0 = arg2 (obj2 ptr)
 *   00015ff2  clr.b   D2b               ; D2 = 0 (result)
 *   00015ff4  cmpi.b  #0x1,(0x18,A1)    ; obj1.state == 1?
 *   00015ffa  bne.b   0x1604e           ; no → epilog (return 0)
 *   00015ffc  cmpi.b  #0x1,(0x18,A0)    ; obj2.state == 1?
 *   00016002  bne.b   0x1604e           ; no → epilog (return 0)
 *   00016004  move.b  (0x1b,A0),D0b     ; D0b = obj2.zorder
 *   00016008  cmp.b   (0x1b,A1),D0b     ; D0b - obj1.zorder (set flags)
 *   0001600c  bne.b   0x16042           ; not equal → zorder branch
 *   0001600e  move.l  (0x10,A1),D1      ; D1 = obj1.y (long)
 *   00016012  moveq   0x13,D0
 *   00016014  asr.l   D0,D1             ; D1 = asr_l(obj1.y, 19)
 *   00016016  move.w  D1w,D3w           ; D3.w = (obj1.y>>19).w
 *   00016018  move.l  (0xc,A1),D1       ; D1 = obj1.x (long)
 *   0001601c  moveq   0x13,D0
 *   0001601e  asr.l   D0,D1             ; D1 = asr_l(obj1.x, 19)
 *   00016020  move.w  D1w,D0w           ; D0.w = (obj1.x>>19).w
 *   00016022  add.w   D0w,D3w           ; D3.w += D0.w (16-bit add, wraps)
 *   00016024  move.l  (0x10,A0),D1      ; D1 = obj2.y (long)
 *   00016028  moveq   0x13,D0
 *   0001602a  asr.l   D0,D1             ; D1 = asr_l(obj2.y, 19)
 *   0001602c  move.w  D1w,D4w           ; D4.w = (obj2.y>>19).w
 *   0001602e  move.l  (0xc,A0),D1       ; D1 = obj2.x (long)
 *   00016032  moveq   0x13,D0
 *   00016034  asr.l   D0,D1             ; D1 = asr_l(obj2.x, 19)
 *   00016036  move.w  D1w,D0w           ; D0.w = (obj2.x>>19).w
 *   00016038  add.w   D0w,D4w           ; D4.w += D0.w (16-bit add, wraps)
 *   0001603a  cmp.w   D4w,D3w           ; flags = D3w - D4w (signed 16-bit)
 *   0001603c  ble.b   0x1604e           ; D3 <= D4 (signed) → epilog (return 0)
 *   0001603e  moveq   0x1,D2            ; D2 = 1
 *   00016040  bra.b   0x1604e           ; → epilog
 *   00016042  move.b  (0x1b,A0),D0b     ; D0b = obj2.zorder
 *   00016046  cmp.b   (0x1b,A1),D0b     ; flags = obj2.zorder - obj1.zorder
 *   0001604a  bge.b   0x1604e           ; obj2 >= obj1 (signed byte) → return 0
 *   0001604c  moveq   0x1,D2            ; D2 = 1
 *   0001604e  move.b  D2b,D1b           ; D1.b = D2.b
 *   00016050  ext.w   D1w               ; sign-extend → word
 *   00016052  ext.l   D1                ; sign-extend → long
 *   00016054  move.l  D1,D0             ; D0 = result (0 or 1)
 *   00016056  movem.l (SP)+,{D2 D3 D4}
 *   0001605a  rts
 *
 *
 * Known callers:
 *   - `0x1577C` in `FUN_00015670` (replica in `state-sub-15670.ts`):
 *     `jsr 0x15FE6.l` with args A3=obj0Abs and A3+0xE2=obj1Abs.
 *   - `0x15EB6` in `FUN_00015E24`: `jsr 0x15FE6.l` with two obj ptrs.
 *
 *
 */

import type { GameState } from "./state.js";

export const HELPER_15FE6_ADDR = 0x00015fe6 as const;


const OBJ_STATE_OFF = 0x18 as const;
const OBJ_X_OFF = 0x0c as const;
const OBJ_Y_OFF = 0x10 as const;
const OBJ_ZORDER_OFF = 0x1b as const;

const POS_SHIFT = 0x13 as const; // 19


const WORK_RAM_BASE = 0x00400000 as const;
const WORK_RAM_SIZE = 0x2000 as const;

function readByteAbs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + WORK_RAM_SIZE) return 0;
  return state.workRam[a - WORK_RAM_BASE] ?? 0;
}

function readLongSignedAbs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a + 4 > WORK_RAM_BASE + WORK_RAM_SIZE || a < WORK_RAM_BASE) return 0;
  const off = a - WORK_RAM_BASE;
  const r = state.workRam;
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) |
    0
  );
}

function asrL(value: number, count: number): number {
  return (value | 0) >> (count & 0x1f);
}


/** Execute the object comparison port. */
export function helper15FE6(
  state: GameState,
  obj1Abs: number,
  obj2Abs: number,
): number {
  const a1 = obj1Abs >>> 0;
  const a0 = obj2Abs >>> 0;

  // clr.b D2b — result = 0
  // cmpi.b #0x1,(0x18,A1); bne → epilog
  if (readByteAbs(state, a1 + OBJ_STATE_OFF) !== 1) return 0;
  // cmpi.b #0x1,(0x18,A0); bne → epilog
  if (readByteAbs(state, a0 + OBJ_STATE_OFF) !== 1) return 0;

  // move.b (0x1B,A0),D0b; cmp.b (0x1B,A1),D0b; bne → zorder branch
  const z1 = readByteAbs(state, a1 + OBJ_ZORDER_OFF); // obj1.zorder
  const z2 = readByteAbs(state, a0 + OBJ_ZORDER_OFF); // obj2.zorder

  if (z1 === z2) {
    //
    // D3.w = (asr_l(obj1.y, 19)).w + (asr_l(obj1.x, 19)).w  (16-bit add)
    // D4.w = (asr_l(obj2.y, 19)).w + (asr_l(obj2.x, 19)).w
    // cmp.w D4w,D3w; ble → return 0; else return 1
    //
    // `move.w D1w,D3w` copies only the low 16 bits of the long.

    const obj1Y = readLongSignedAbs(state, a1 + OBJ_Y_OFF);
    const obj1X = readLongSignedAbs(state, a1 + OBJ_X_OFF);
    const obj2Y = readLongSignedAbs(state, a0 + OBJ_Y_OFF);
    const obj2X = readLongSignedAbs(state, a0 + OBJ_X_OFF);

    // asr.l #19, Dx → low word
    const y1w = asrL(obj1Y, POS_SHIFT) & 0xffff;
    const x1w = asrL(obj1X, POS_SHIFT) & 0xffff;
    // add.w (16-bit wrap)
    const d3w = (y1w + x1w) & 0xffff;

    const y2w = asrL(obj2Y, POS_SHIFT) & 0xffff;
    const x2w = asrL(obj2X, POS_SHIFT) & 0xffff;
    const d4w = (y2w + x2w) & 0xffff;

    // cmp.w D4w,D3w sets flags on (D3w - D4w) as signed 16-bit.
    // ble (signed <=) → return 0; else return 1.
    const d3s = d3w & 0x8000 ? d3w - 0x10000 : d3w;
    const d4s = d4w & 0x8000 ? d4w - 0x10000 : d4w;
    return d3s > d4s ? 1 : 0;
  } else {
    //
    // move.b (0x1B,A0),D0b; cmp.b (0x1B,A1),D0b
    // → flags on (obj2.zorder - obj1.zorder) as signed byte
    // bge → return 0 (obj2 >= obj1 signed)
    // else D2 = 1 → return 1 (obj2 < obj1 signed, i.e. obj1 "above")
    const z1s = z1 & 0x80 ? z1 - 0x100 : z1;
    const z2s = z2 & 0x80 ? z2 - 0x100 : z2;
    // cmp.b sets flags on D0b - (A1+0x1B) = z2 - z1
    // bge: if (z2 - z1) >= 0 → z2 >= z1 → return 0
    return z2s < z1s ? 1 : 0;
  }
}
