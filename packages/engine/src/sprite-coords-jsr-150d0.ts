/**
 * sprite-coords-jsr-150d0.ts — replica `FUN_000150D0` (120 byte).
 *
 * "Compute coords + dispatch" variant of the `compute()` pattern; calls the
 * inner routine with `(structPtr, 2)`.
 *
 *
 * **Disasm 0x150D0..0x15147** (120 byte):
 *
 *   000150d0   movem.l {A3,A2,D3,D2},-(SP)     ; save 4 longs (16 byte)
 *   000150d4   movea.l (0x14,SP),A1             ; A1 = arg long (struct ptr)
 *   000150d8   movea.l #0x400692,A3             ; A3 → POS_Y global
 *   000150de   movea.l #0x400690,A2             ; A2 → POS_X global
 *   000150e4   lea     (0xc,A1),A0
 *   000150e8   move.w  (A0),(A2)                ; *0x400690 = word @ A1+0xC  (w0)
 *   000150ea   lea     (0x10,A1),A0
 *   000150ee   move.w  (A0),(A3)                ; *0x400692 = word @ A1+0x10 (w2)
 *   000150f0   move.w  (A3),D3w
 *   000150f2   sub.w   (A2),D3w                 ; D3w = w2 - w0
 *   000150f4   addi.w  #0x88,D3w                ; D3w += 0x88
 *   000150f8   lea     (0x14,A1),A0
 *   000150fc   move.w  (A0),D0w                 ; D0w = word @ A1+0x14 (w4)
 *   000150fe   move.w  (0x40097e).l,D2w         ; D2w = HUD_OFFSET
 *   00015104   add.w   D0w,D2w                  ; D2w += w4
 *   00015106   addi.w  #0x54,D2w                ; D2w += 0x54
 *   0001510a   move.w  (A3),D0w
 *   0001510c   ext.l   D0                        ; D0 = sext_l(w2)
 *   0001510e   move.w  (A2),D1w
 *   00015110   ext.l   D1                        ; D1 = sext_l(w0)
 *   00015112   add.l   D1,D0                     ; D0 = sext_l(w2)+sext_l(w0)
 *   00015114   asr.l   #0x1,D0                   ; D0 >>= 1 (signed)
 *   00015116   sub.w   D0w,D2w                   ; D2w -= avg (low word)
 *   00015118   move.w  D2w,D0w
 *   0001511a   ext.l   D0                        ; D0 = sext_l(D2w)
 *   0001511c   move.l  D0,D2
 *   0001511e   andi.l  #0xffff,D2                ; D2 = D2w (zero high word)
 *   00015124   move.w  D3w,D0w
 *   00015126   ext.l   D0                        ; D0 = sext_l(D3w)
 *   00015128   move.l  D0,D1
 *   0001512a   moveq   #0x10,D0
 *   0001512c   asl.l   D0,D1                     ; D1 = sext_l(D3w) << 16
 *   0001512e   add.l   D1,D2                     ; D2 = (D3w_signed<<16) | D2w
 *   00015130   move.l  D2,(0x28,A1)              ; *(A1+0x28) = D2 (long)
 *   00015134   pea     (0x2).w                   ; push 2 (long)
 *   00015138   move.l  A1,-(SP)                  ; push struct ptr
 *   0001513a   jsr     0x000264aa.l              ; FUN_264AA(structPtr, 2)
 *   00015140   addq.l  #0x8,SP                   ; pop 2 long
 *   00015142   movem.l (SP)+,{D2,D3,A2,A3}
 *   00015146   rts                               ; D0 = inner return value
 *
 * **Side effects pre-jsr** (in `state.workRam`):
 *   - `0x690..0x691` (POS_X global)  = word @ A1+0xC
 *   - `0x692..0x693` (POS_Y global)  = word @ A1+0x10
 *   - `(A1+0x28)..(A1+0x2B)` (long)  = pack(yMinusX_signed << 16 | adjustedX_word)
 *
 *
 * The inner routine is modeled through callback `inner` (see `Inner264AA` in
 * `object-enter-1281c.ts`). The parity test patches the `jsr` with a stub
 * `move.l (8,SP),D0; rts` per esporre il `mode=2` as `D0`.
 *
 */

import type { GameState } from "./state.js";

/** Work RAM base. */
const WORK_RAM_BASE = 0x400000;

const POS_X_OFF = 0x690; // *0x400690 word
const POS_Y_OFF = 0x692; // *0x400692 word
const HUD_OFFSET_OFF = 0x97e; // *0x40097E word

/** Offsets in the struct passed as arg1 (A1). */
const STRUCT_W0_OFF = 0xc; // word @ A1+0xC -> POS_X
const STRUCT_W2_OFF = 0x10; // word @ A1+0x10 -> POS_Y
const STRUCT_W4_OFF = 0x14; // word @ A1+0x14 -> HUD-compute input
const STRUCT_DST_OFF = 0x28; // long @ A1+0x28 <- packed coords output

/** Hard-coded mode passed as the second long arg to `FUN_264AA`. */
export const INNER_MODE = 2 as const;

/**
 * Callback modeling `FUN_000264AA`. Receives `(structPtr, mode)` as longs.
 *
 * @param structPtr  = `A1` verbatim, not normalized.
 * @param mode       hard-coded to `INNER_MODE = 2`.
 */
export type Inner264AA = (structPtr: number, mode: number) => number;

/** Stub-injection interface for the JSR. */
export interface SpriteCoordsJsr150D0Subs {
  inner264AA: Inner264AA;
}

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}
function writeU16(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}
function writeU32(state: GameState, off: number, v: number): void {
  const u = v >>> 0;
  state.workRam[off] = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8) & 0xff;
  state.workRam[off + 3] = u & 0xff;
}

/**
 *
 * @param state     GameState; mutates `workRam[0x690..0x693]` and
 *                  `(arg+0x28..arg+0x2B)`.
 * @param subs      Stub injection for `FUN_264AA`.
 *                  `subs.inner264AA(structPtr, 2)`.
 *
 *   - `0x690..0x691` = word @ structPtr+0xC (big-endian)
 *   - `0x692..0x693` = word @ structPtr+0x10 (big-endian)
 *   - `(structPtr+0x28)..(structPtr+0x2B)` = packed long (big-endian)
 */
export function spriteCoordsJsr150D0(
  state: GameState,
  structPtr: number,
  subs: SpriteCoordsJsr150D0Subs,
): number {
  const a1 = structPtr >>> 0;
  const argOff = (a1 - WORK_RAM_BASE) >>> 0;

  // Read w0, w2, w4 from the struct (M68k word, big-endian).
  const w0 = readU16(state, argOff + STRUCT_W0_OFF);
  const w2 = readU16(state, argOff + STRUCT_W2_OFF);
  const w4 = readU16(state, argOff + STRUCT_W4_OFF);

  writeU16(state, POS_X_OFF, w0 & 0xffff);
  writeU16(state, POS_Y_OFF, w2 & 0xffff);

  // D3.w = (w2 - w0 + 0x88) (word arithmetic, sub.w / addi.w sequence).
  const yMinusX = (((w2 - w0) | 0) + 0x88) & 0xffff;

  // D2.w = HUD_OFFSET + w4 + 0x54 (word arithmetic).
  const hudOff = readU16(state, HUD_OFFSET_OFF);
  let d2w = ((hudOff + (w4 & 0xffff)) | 0) + 0x54;
  d2w = d2w & 0xffff;

  // D0 = sext_l(w2)+sext_l(w0); D0 >>= 1 (asr.l #1, signed shift).
  const yS = w2 & 0x8000 ? w2 - 0x10000 : w2;
  const xS = w0 & 0x8000 ? w0 - 0x10000 : w0;
  const avgLong = (yS + xS) >> 1;
  // D2.w -= avg.w (sub.w D0w,D2w)
  d2w = (d2w - (avgLong & 0xffff)) & 0xffff;

  // ext.l D0 of D2w; andi.l #0xffff,D2 -> D2 (long) = D2w with high word zero.
  const d2Long = d2w & 0xffff;

  const d3Signed = yMinusX & 0x8000 ? yMinusX - 0x10000 : yMinusX;
  const d1Long = ((d3Signed << 16) | 0) >>> 0;

  // D2 (long) = D1 + D2  (add.l D1,D2)
  const packed = (d1Long + d2Long) >>> 0;

  // *(A1+0x28) = D2 (long, big-endian)
  writeU32(state, argOff + STRUCT_DST_OFF, packed);

  // The shim's return survives `addq.l #8,SP; rts`, so return it verbatim.
  return subs.inner264AA(a1, INNER_MODE) >>> 0;
}
