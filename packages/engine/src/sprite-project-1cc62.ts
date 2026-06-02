/**
 * sprite-project-1cc62.ts — `FUN_0001CC62` replica (158 bytes).
 *
 * (`workRam[0x1C28..0x1C43]`, 28 bytes) + the 5 "tile-fields" globals set by
 *
 * **Disasm 0x1CC62..0x1CD00** (158 byte):
 *
 *   0001cc62  movem.l {A5,A4,A3,A2,D4,D3,D2}, -(SP)   ; save 7 regs (28 bytes)
 *   0001cc66  move.b  (0x23,SP), D0b                 ; D0.b = arg-byte (LSB
 *                                                     ; of the long pushed by
 *                                                     ; caller; 28+4=32=0x20
 *                                                     ; → +0x23 = byte 3 BE)
 *   0001cc70  movea.l #0x4006a6, A4                  ; A4 = ptr OUT-Y
 *   0001cc76  movea.l #0x4006a4, A3                  ; A3 = ptr OUT-X
 *   0001cc7c  move.l  A1, D2                         ; D2 = base   (+0)
 *   0001cc7e  lea     (0x8,A1), A0
 *   0001cc82  move.l  A0, D3                         ; D3 = base+8
 *   0001cc84  lea     (0x10,A1), A0
 *   0001cc88  move.l  A0, D4                         ; D4 = base+0x10
 *   0001cc8a  lea     (0x18,A1), A2                  ; A2 = base+0x18
 *
 *   ; --- if(arg.lsb != 0) call heavy redraw FUN_0001CABA ---
 *   0001cc8e  tst.b   D0b
 *   0001cc90  beq.b   0x1cc98
 *   0001cc92  jsr     0x0001caba.l                   ; heavy renderer (same
 *                                                     ; sub of sprite-pos-update
 *                                                     ; -1bab2): ridraw of the tile
 *   0001cc98  tst.w   (0x4006a2).l                   ; bge-flag from the derive
 *   0001cc9e  beq.b   0x1ccbc                        ; if 0 → else-branch
 *
 *   ; --- if-branch (bge-flag != 0, i.e. (y&7) >= (x&7)) ---
 *   0001cca0  movea.l D3, A5                         ; A5 = base+8
 *   0001cca2  move.w  (0x6,A5), D0w                  ; D0.w = *(base+0x0E)
 *   0001cca6  movea.l D2, A5                         ; A5 = base+0
 *   0001cca8  sub.w   (0x4,A5), D0w                  ; D0.w -= *(base+0x04)
 *   0001ccac  move.w  D0w, (A3)                      ; *0x4006A4 = D0.w
 *   0001ccae  movea.l D2, A5                         ; A5 = base+0
 *   0001ccb0  move.w  (0x4,A5), D0w                  ; D0.w = *(base+0x04)
 *   0001ccb4  sub.w   (0x2,A2), D0w                  ; D0.w -= *(base+0x1A)
 *   0001ccb8  move.w  D0w, (A4)                      ; *0x4006A6 = D0.w
 *   0001ccba  bra.b   0x1ccd2
 *
 *   ; --- else-branch (bge-flag == 0, i.e. (y&7) <  (x&7)) ---
 *   0001ccbc  movea.l D4, A5                         ; A5 = base+0x10
 *   0001ccbe  move.w  (A5), D0w                      ; D0.w = *(base+0x10)
 *   0001ccc0  sub.w   (0x2,A2), D0w                  ; D0.w -= *(base+0x1A)
 *   0001ccc4  move.w  D0w, (A3)                      ; *0x4006A4 = D0.w
 *   0001ccc6  movea.l D3, A5                         ; A5 = base+8
 *   0001ccc8  move.w  (0x6,A5), D0w                  ; D0.w = *(base+0x0E)
 *   0001cccc  movea.l D4, A5                         ; A5 = base+0x10
 *   0001ccce  sub.w   (A5), D0w                      ; D0.w -= *(base+0x10)
 *   0001ccd0  move.w  D0w, (A4)                      ; *0x4006A6 = D0.w
 *
 *   ; --- common tail: pack return value (Q16.16-like) ---
 *   0001ccd2  move.w  (0x2,A2), D0w                  ; D0.w = *(base+0x1A)
 *   0001ccd6  ext.l   D0                             ; sign-ext word→long
 *   0001ccd8  move.l  D0, D2                         ; D2 = sext(*+0x1A)
 *   0001ccda  moveq   #0x10, D0
 *   0001ccdc  asl.l   D0, D2                         ; D2 <<= 16
 *   0001ccde  move.w  (A4), D0w                      ; D0.w = *0x4006A6 (OUT-Y)
 *   0001cce0  muls.w  (0x4006a0).l, D0               ; D0.l = sext16(D0w) *
 *                                                     ;   sext16(*0x4006A0) = (y&7)
 *   0001cce6  move.l  D0, D1                         ; D1 = product1
 *   0001cce8  move.w  (A3), D0w                      ; D0.w = *0x4006A4 (OUT-X)
 *   0001ccea  muls.w  (0x40069e).l, D0               ; D0.l = sext16(D0w) *
 *                                                     ;   sext16(*0x40069E) = (x&7)
 *   0001ccf0  add.l   D0, D1                         ; D1 = product1 + product2
 *   0001ccf2  moveq   #0xD, D0
 *   0001ccf4  asl.l   D0, D1                         ; D1 <<= 13
 *   0001ccf6  add.l   D1, D2                         ; D2 = D2 + D1
 *   0001ccf8  move.l  D2, D0                         ; return D2 in D0
 *   0001ccfa  movem.l (SP)+, {D2,D3,D4,A2,A3,A4,A5}
 *   0001ccfe  rts
 *
 * **Semantica** (deduzione from the 21 caller):
 *     +0x04: cx0   (componente X, "old"?)
 *     +0x0E: cx1   (componente X, "new"?)
 *     +0x10: cy0   (componente Y, "old"?)
 *     +0x1A: cz    (componente Z, sign-extesa in the return high word)
 *   - bge-flag (`*0x4006A2`) distinguishes whether (y&7) >= (x&7), an iso-projection
 *     half-plane. If SI: `*0x4006A4 = cx1-cx0`, `*0x4006A6 = cx0-cz`.
 *     If NO: `*0x4006A4 = cy0-cz`,  `*0x4006A6 = cx1-cy0`.
 *   - Return long: `(sext16(cz) << 16) + ((dy*(y&7) + dx*(x&7)) << 13)`,
 *     where dx = `*0x4006A4` post-write, dy = `*0x4006A6` post-write. Looks like
 *     (caller @ 0x12250 does `cmpi.l #0x100000` = 1<<20 against D0-(0x14,A2)).
 *
 * **JSR esterne**:
 *     ONLY if `argByte != 0`. Exposed as sub injection
 *     (`spriteProject1CC62Subs.fun_1CABA`); default no-op.
 *
 * **Side effects** in `state.workRam`:
 *   - `0x6A4..0x6A5` (OUT-X delta word, big-endian)
 *   - `0x6A6..0x6A7` (OUT-Y delta word, big-endian)
 *   - optional side effects of `subs.fun_1CABA` if `argByte != 0`.
 *
 */

import type { GameState } from "./state.js";


export const STRUCT_ADDR = 0x00401c28 as const;
/** Offset struct in `state.workRam` (= STRUCT_ADDR - 0x400000). */
const STRUCT_OFF = STRUCT_ADDR - 0x400000;

/** `*0x40069E` = `x & 7` (set by sprite-derive). */
const FRAC_X_OFF = 0x69e;
/** `*0x4006A0` = `y & 7` (set by sprite-derive). */
const FRAC_Y_OFF = 0x6a0;
/** `*0x4006A2` = bge-flag (1 if (y&7) >= (x&7), set by sprite-derive). */
const BGE_FLAG_OFF = 0x6a2;
const OUT_DX_OFF = 0x6a4;
const OUT_DY_OFF = 0x6a6;

// ─── Internal helpers ─────────────────────────────────────────────────────

function readU16(s: GameState, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}

function writeU16(s: GameState, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

/** sext16: cast u16 -> int16 (signed). */
function sext16(v: number): number {
  return v & 0x8000 ? v - 0x10000 : v;
}

function asI32(v: number): number {
  return v | 0;
}

// ─── Sub-injection (heavy renderer FUN_0001CABA) ──────────────────────────

/**
 * Stub injection for `FUN_0001CABA` (heavy tile-redraw). Default: no-op.
 *
 * sub-injection lets the caller inject the separate implementation,
 * update globals 0x6A4/0x6A6 and calculate the packed return.
 *
 * Same injection as `sprite-pos-update-1bab2.ts`: the two modules share
 * the same external sub.
 */
export interface SpriteProject1CC62Subs {
  /** Callback for `FUN_0001CABA` (heavy tile-redraw). Default: no-op. */
  fun_1CABA?: (state: GameState) => void;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 *
 *
 * @param state    GameState (modifies `workRam[0x6A4..0x6A7]`).
 *                 `subs.fun_1CABA(state)` (heavy redraw).
 *                 `(argLong & 0xFF) != 0`. Default: no-op.
 *
 * @returns Long signed (32 bit) — packed result. Layout:
 *          `result = (sext16(cz) << 16) + ((dy*(y&7) + dx*(x&7)) << 13)`,
 *          where `cz = *(STRUCT+0x1A)`, `dx = *0x6A4` post-write,
 *          `dy = *0x6A6` post-write. Truncato a 32 bit signed (i32 wrap).
 *
 * **Side effects** in `state.workRam`:
 *   - `0x6A4..0x6A5` (OUT-X delta word, big-endian)
 *   - `0x6A6..0x6A7` (OUT-Y delta word, big-endian)
 *   - optional side effects of `subs.fun_1CABA(state)` if invoked.
 */
export function spriteProject1CC62(
  state: GameState,
  argLong: number,
  subs?: SpriteProject1CC62Subs,
): number {
  // arg byte = LSB of the long arg (mov.b (+0x23,SP) = byte 3 BE = low byte).
  const argByte = argLong & 0xff;
  if (argByte !== 0) {
    // jsr FUN_0001CABA (heavy redraw); via injection.
    subs?.fun_1CABA?.(state);
  }

  // base+0x04, base+0x0E, base+0x10, base+0x1A.
  const cx0 = readU16(state, STRUCT_OFF + 0x04); // D2+4
  const cx1 = readU16(state, STRUCT_OFF + 0x0e); // D3+6 = base+8+6
  const cy0 = readU16(state, STRUCT_OFF + 0x10); // D4+0 = base+0x10
  const cz = readU16(state, STRUCT_OFF + 0x1a); // A2+2 = base+0x18+2

  // Branch on bge-flag (`*0x4006A2`): tst.w; beq -> else-branch.
  const bgeFlag = readU16(state, BGE_FLAG_OFF);

  let outDx: number;
  let outDy: number;
  if (bgeFlag !== 0) {
    // if-branch: bge-flag != 0 (i.e. (y&7) >= (x&7))
    //   *0x6A4 = cx1 - cx0 (word, modulo 2^16)
    //   *0x6A6 = cx0 - cz  (word, modulo 2^16)
    outDx = (cx1 - cx0) & 0xffff;
    outDy = (cx0 - cz) & 0xffff;
  } else {
    // else-branch:
    //   *0x6A4 = cy0 - cz  (word, modulo 2^16)
    //   *0x6A6 = cx1 - cy0 (word, modulo 2^16)
    outDx = (cy0 - cz) & 0xffff;
    outDy = (cx1 - cy0) & 0xffff;
  }

  writeU16(state, OUT_DX_OFF, outDx);
  writeU16(state, OUT_DY_OFF, outDy);

  // Common tail (return packing).
  // D0.w = cz; ext.l D0 -> sext-long.
  // D2 = sext32(cz); D2 <<= 16 (asl.l #0x10).
  // shift-by-16 of sext-long: high word = cz, low word = 0.
  // In TS i32 semantics: use left shift 16 with 32-bit wrap.
  let d2 = asI32(sext16(cz) << 16);

  // D0.w = *0x6A6 (outDy); muls.w *0x4006A0, D0 -> D0.l = sext16(outDy) * sext16(*0x6A0)
  const fracY = readU16(state, FRAC_Y_OFF);
  const product1 = asI32(sext16(outDy) * sext16(fracY));

  // D0.w = *0x6A4 (outDx); muls.w *0x40069E, D0 -> D0.l = sext16(outDx) * sext16(*0x69E)
  const fracX = readU16(state, FRAC_X_OFF);
  const product2 = asI32(sext16(outDx) * sext16(fracX));

  // D1 = product1 + product2 (i32 wrap).
  let d1 = asI32(product1 + product2);
  // D1 <<= 13 (asl.l #0xD).
  d1 = asI32(d1 << 13);

  // D2 += D1 (i32 wrap). Return D2 in D0 → returned as i32.
  d2 = asI32(d2 + d1);

  return d2;
}
