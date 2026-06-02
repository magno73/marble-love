/**
 * Bit-perfect port of `FUN_00003784`.
 *
 * Computes an alpha-tilemap address from `(y, x, rotation)` and writes
 * `attr | orMask` to that word. Several callers reach it indirectly through
 * `FUN_22A4`.
 *
 * **Disasm 0x3784..0x37E3** (0x5E byte = 94 bytes, 38 instructions):
 *
 *   0x3784  movem.l {D3 D2},-(SP)         ; save D2/D3 (8 bytes) → SP-=8
 *   0x3788  move.b  (0xf,SP),D1b          ; D1b = low byte of arg1 (y)
 *   0x378c  move.b  (0x13,SP),D0b         ; D0b = low byte of arg2 (x)
 *   0x3790  move.w  (0x16,SP),D2w         ; D2w = low word of arg3 (attr)
 *   0x3794  movea.l #0xa03000,A1          ; A1 = ALPHA_BASE
 *   0x379a  tst.w   (0x00401f42).l        ; rotation word == 0?
 *   0x37a0  beq.b   0x37ac                ; → rot0 path
 *
 *   ; rotation != 0:  D3 = 0x29 - sext_l(D0b)
 *   0x37a2  moveq   0x29,D3
 *   0x37a4  ext.w   D0w                   ; sext D0b → D0w
 *   0x37a6  ext.l   D0                    ; sext D0w → D0l
 *   0x37a8  sub.l   D0,D3                 ; D3 = 0x29 - D0
 *   0x37aa  bra.b   0x37b4
 *
 *   ; rotation == 0:  D3 = sext_l(D0b) << 6
 *   0x37ac  move.b  D0b,D3b               ; D3b = D0b
 *   0x37ae  ext.w   D3w                   ; sext byte → word
 *   0x37b0  ext.l   D3                    ; sext → long
 *   0x37b2  asl.l   #0x6,D3              ; D3 <<= 6
 *
 *   ; join: compute D0 = sext_l(D1b) (y param)
 *   0x37b4  move.b  D1b,D0b              ; D0b = D1b (y)
 *   0x37b6  ext.w   D0w
 *   0x37b8  ext.l   D0                   ; D0 = sext_l(y)
 *   0x37ba  move.w  (0x00401f42).l,D1w   ; D1w = rotation
 *   0x37c0  ext.l   D1                   ; D1 = sext(rotation)
 *   0x37c2  add.l   D1,D1               ; D1 = rotation * 2
 *   0x37c4  movea.l #0x72a4,A0           ; A0 = ROM shift table
 *   0x37ca  move.b  (0x1,A0,D1*0x1),D1b  ; D1b = ROM[0x72a5 + rotation*2]
 *   0x37ce  asl.l   D1,D0               ; D0 <<= D1b (count mod 64)
 *   0x37d0  add.l   D3,D0               ; D0 += D3
 *   0x37d2  add.l   D0,D0               ; D0 *= 2
 *   0x37d4  adda.l  D0,A1               ; A1 = 0xa03000 + D0
 *   0x37d6  move.w  (0x1a,SP),D0w        ; D0w = low word of arg4 (orMask)
 *   0x37da  or.w    D2w,D0w             ; D0w |= attr
 *   0x37dc  move.w  D0w,(A1)            ; write word to alpha RAM
 *   0x37de  movem.l (SP)+,{D2 D3}       ; restore
 *   0x37e2  rts
 *
 * **Calling convention** (cdecl-like, 4 long args pushed RTL):
 *
 *   Stack post-prolog (movem saved 2*4=8 bytes):
 *     SP+0x00..0x03 : D2 saved
 *     SP+0x04..0x07 : D3 saved
 *     SP+0x08..0x0B : return address
 *     SP+0x0C..0x0F : arg1 long   → SP+0xF = low byte = **y**
 *     SP+0x10..0x13 : arg2 long   → SP+0x13 = low byte = **x**
 *     SP+0x14..0x17 : arg3 long   → SP+0x16 = low word = **attr**
 *     SP+0x18..0x1B : arg4 long   → SP+0x1A = low word = **orMask**
 *
 *   callers, including FUN_22A4, push four longs with RTL convention (arg4
 *   first, arg1 last).
 *
 *
 * Side effects:
 *   - Writes the computed alpha RAM word when the address falls inside the
 *     modeled alpha tilemap; out-of-range writes are ignored like
 *     `setAlphaWord` in `alpha-tilemap.ts`.
 *
 *
 *   1. `ext.w` + `ext.l` on a byte is equivalent to `sextByte`.
 *
 *
 *   3. `asl.l D1,D0` uses register count `D1b & 63`.
 *
 *   4. `add.l D0,D0` doubles the long. The implementation preserves 32-bit
 *      unsigned wrapping.
 *
 *
 *   6. `or.w D2w,D0w`: D2w is the low 16 bits of attr; D0w is the word stored
 *      in alpha RAM.
 *
 *      The final D0 keeps the high word from the address calculation because
 *      `or.w` operates only on the low word.
 *
 * **Xrefs** (12 call site + 1 entry):
 *   - `FUN_00005688` @ 0x5884, 0x58AE (UNCONDITIONAL_CALL × 2)
 *   - `FUN_000022A4` @ 0x233E, 0x2356, 0x236A, 0x2372, 0x237A... (8 COMPUTED_CALL via jsr A2)
 *   - `FUN_00005D2A` @ 0x5DAE, 0x5DCE (UNCONDITIONAL_CALL × 2)
 *
 * `packages/cli/src/test-helper-3784-parity.ts` (500/500).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants (M68k absolute) ───────────────────────────────────────

export const HELPER_3784_ADDR = 0x00003784 as const;

/** Alpha tilemap MMIO base. */
const ALPHA_BASE = 0xa03000 as const;

/** Work RAM offset of `rotation`, relative to `0x400000`. */
const ROTATION_OFF = 0x1f42 as const;

const ROM_SHIFT_TABLE = 0x72a4 as const;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Sign-extend byte (8-bit) → 32-bit signed JS number.
 */
function sextByte(b: number): number {
  const v = b & 0xff;
  return v & 0x80 ? v - 0x100 : v;
}

// Main function: FUN_3784.

/**
 *
 *
 * @param y Low byte of arg1, sign-extended by the callee.
 * @param x Low byte of arg2, sign-extended by the callee.
 * @param attr Low word of arg3, the tile attribute or char code.
 * @param orMask Low word of arg4 ORed into `attr`.
 *
 * @returns D0 at RTS, with the low word equal to `orMask | attr`.
 *
 */
export function helper3784(
  state: GameState,
  rom: RomImage,
  y: number,
  x: number,
  attr: number,
  orMask: number,
): number {
  // 0x3788: move.b (0xf,SP),D1b  →  D1b = low byte of y param
  const d1b = y & 0xff;

  // 0x378c: move.b (0x13,SP),D0b  →  D0b = low byte of x param
  const d0b = x & 0xff;

  // 0x3790: move.w (0x16,SP),D2w  →  D2w = low word of attr param
  const d2w = attr & 0xffff;

  // 0x3794: movea.l #0xa03000,A1
  // A1 starts at ALPHA_BASE; we accumulate D0 and add at end

  // 0x379a: tst.w (0x00401f42).l  →  test rotation word
  const rotationWord =
    ((state.workRam[ROTATION_OFF] ?? 0) << 8) |
    (state.workRam[ROTATION_OFF + 1] ?? 0);

  // 0x37a0: beq.b 0x37ac
  let d3: number;
  if (rotationWord !== 0) {
    // rotation != 0:  D3 = 0x29 - sext_l(D0b)
    // 0x37a2: moveq 0x29,D3
    // 0x37a4: ext.w D0w; 0x37a6: ext.l D0  →  D0 = sextByte(d0b)
    // 0x37a8: sub.l D0,D3                  →  D3 = 0x29 - D0
    d3 = (0x29 - sextByte(d0b)) | 0;
  } else {
    // rotation == 0:  D3 = sext_l(D0b) << 6
    // 0x37ac: move.b D0b,D3b; 0x37ae: ext.w D3w; 0x37b0: ext.l D3
    // 0x37b2: asl.l #6,D3
    d3 = (sextByte(d0b) << 6) | 0;
  }

  // join @ 0x37b4:
  // 0x37b4: move.b D1b,D0b
  // 0x37b6: ext.w D0w; 0x37b8: ext.l D0  →  D0 = sextByte(D1b)
  let d0 = sextByte(d1b);

  // 0x37ba: move.w (0x00401f42).l,D1w  →  D1w = rotation
  // 0x37c0: ext.l D1                   →  D1 = sext(rotationWord)
  const rotationSigned =
    rotationWord & 0x8000 ? rotationWord - 0x10000 : rotationWord;

  // 0x37c2: add.l D1,D1  →  D1 = rotation * 2
  const d1idx = (rotationSigned * 2) | 0;

  // 0x37c4: movea.l #0x72a4,A0
  // 0x37ca: move.b (0x1,A0,D1*0x1),D1b  →  D1b = ROM[0x72a5 + rotation*2]
  const shiftByte = rom.program[(ROM_SHIFT_TABLE + 1 + d1idx) >>> 0] ?? 0;
  const shiftCount = shiftByte & 0x3f; // m68k asl.l uses count mod 64

  // 0x37ce: asl.l D1,D0  →  D0 <<= shiftCount
  // For count >= 32: result is 0 (JS << only uses 5 bits, so need guard)
  if (shiftCount >= 32) {
    d0 = 0;
  } else {
    d0 = (d0 << shiftCount) | 0;
  }

  // 0x37d0: add.l D3,D0  →  D0 += D3
  d0 = (d0 + d3) | 0;

  // 0x37d2: add.l D0,D0  →  D0 *= 2
  d0 = (d0 * 2) | 0;

  // 0x37d4: adda.l D0,A1  →  A1 = 0xa03000 + D0
  const a1 = (ALPHA_BASE + d0) >>> 0;

  // 0x37d6: move.w (0x1a,SP),D0w  →  D0w = low word of orMask param
  // IMPORTANT: in M68k, `move.w <ea>,Dn` updates ONLY the low 16 bits of Dn,
  // leaving the high 16 bits unchanged. D0 still holds its value from
  // `add.l D0,D0` (= d0 * 2, full 32-bit) in the high word.
  const d0Before = (d0 * 2) | 0; // value in D0 before move.w (from add.l above)
  const d0High16 = d0Before & 0xffff0000; // high 16 bits preserved by move.w

  // move.w (0x1a,SP),D0w: low 16 bits = low word of orMask param
  const d0wAfterMove = (orMask & 0xffff) | 0;

  // 0x37da: or.w D2w,D0w  →  D0w |= attr (D2w)
  // or.w also operates only on the low 16 bits; high 16 bits unchanged.
  const writeVal = (d0wAfterMove | d2w) & 0xffff;

  // 0x37dc: move.w D0w,(A1)  →  write word to alpha RAM
  if (a1 >= 0xa03000 && a1 < 0xa04000) {
    const off = a1 - 0xa03000;
    state.alphaRam[off] = (writeVal >>> 8) & 0xff;
    state.alphaRam[off + 1] = writeVal & 0xff;
  }

  // 0x37de: movem.l (SP)+,{D2 D3}  →  restore (no-op in TS)
  // 0x37e2: rts

  // Return D0 at rts:
  //   High 16 bits: from `add.l D0,D0` (unchanged by move.w/or.w)
  //   Low 16 bits: (orMask & 0xffff) | (attr & 0xffff)
  return (d0High16 | writeVal) >>> 0;
}
