/**
 * helper-3a08.ts — `FUN_00003A08` replica (32 instructions, 0x4C bytes).
 *
 * leading zeroes become ' ' (space).
 *
 * `FUN_00003D62` (3 call sites), and `FUN_00003A54` (tail-call trampoline).
 *
 * **Disasm 0x3A08..0x3A53** (32 instructions, 0x4C bytes):
 *
 *   00003a08    move.l D2,-(SP)          ; save D2 (SP-=4)
 *   00003a0a    move.l (0x10,SP),D0      ; D0 = numDigits (arg3 @ SP+0x10)
 *   00003a0e    movea.l (0xc,SP),A0      ; A0 = bufEnd (arg2 @ SP+0xC)
 *   00003a12    adda.l D0,A0             ; A0 = bufEnd + numDigits
 *   00003a14    clr.b  (A0)              ; *A0 = 0  (null-terminator)
 *   00003a16    move.l (0x8,SP),D1       ; D1 = value (arg1 @ SP+0x8) — sets Z
 *   00003a1c    move.b #0x30,-(A0)       ; *--A0 = '0'
 *   00003a20    subq.w 0x1,D0w           ; D0w -= 1
 *   00003a22    subq.w 0x1,D0w           ; D0w -= 1
 *   00003a24    bmi.b  0x00003a50        ; if D0w < 0 (N flag): goto end
 *   00003a30    blt.b  0x00003a34        ; if nibble < 10: skip add 7
 *   00003a32    addq.w 0x7,D2w           ; D2w += 7 (gap '9'..'A': 0x41-0x3A=7)
 *   00003a34    tst.l  D1               ; test D1 (remaining? Z if exhausted)
 *   00003a40    move.w #-0x10,D2w        ; D2w = -16 (= ' ' - '0' = 0x20-0x30)
 *   00003a44    addi.w #0x30,D2w         ; D2w += '0'  →  final char
 *   00003a48    move.b D2b,-(A0)         ; *--A0 = D2b
 *   00003a4a    lsr.l  #0x4,D1           ; D1 >>= 4 (logical shift right 4 bits)
 *   00003a4c    dbf    D0w,0x00003a26    ; D0w -= 1; if D0w != -1: continue loop
 *   00003a50    move.l (SP)+,D2          ; restore D2
 *   00003a52    rts
 *
 * **Calling convention** (cdecl, 4 long args pushed RTL, D2 saved in prologue):
 *
 *     SP+0x00 : D2 saved (4 byte)
 *     SP+0x04 : return address (4 byte)
 *     SP+0x08 : arg1 = value (long)
 *     SP+0x0C : arg2 = bufEnd (long)
 *     SP+0x10 : arg3 = numDigits (long)
 *     SP+0x14 : arg4 = showSpaces (long, word read via `(0x16,SP).w` = low word)
 *
 *
 *   3. Decrement D0w by 1. If D0w < 0 (bmi.b): finish.
 *      b. If nibble >= 10: add 7 (for 'A'..'F').
 *      e. D1 >>= 4 (lsr.l #4).
 *      f. `dbf D0w`: D0w -= 1; repeat if D0w != -1.
 *
 * **Callers** (9 xref UNCONDITIONAL_CALL + 1 EXTERNAL entry):
 *   - `FUN_00000FA0` @ 0x1854, 0x1ADE, 0x1B0A, 0x1B36, 0x1C24
 *   - `FUN_00003D62` @ 0x3D82, 0x3DA6, 0x3DCA
 *   - `FUN_00003A54` @ 0x3A64 (jmp tail-call: formatDecimal trampoline)
 *
 * `packages/cli/src/test-helper-3a08-parity.ts` (500/500).
 */

import type { GameState } from "./state.js";

// ─── Address constant (M68k absolute) ────────────────────────────────────────

export const HELPER_3A08_ADDR = 0x00003a08 as const;

// ─── Internal memory helper ───────────────────────────────────────────────────

/**
 * memory map 68k.
 */
function writeU8(state: GameState, addr: number, value: number): void {
  const v = value & 0xff;
  const a = addr >>> 0;
  if (a >= 0x400000 && a < 0x402000) {
    state.workRam[a - 0x400000] = v;
  } else if (a >= 0xa02000 && a < 0xa03000) {
    state.spriteRam[a - 0xa02000] = v;
  } else if (a >= 0xa03000 && a < 0xa04000) {
    state.alphaRam[a - 0xa03000] = v;
  } else if (a >= 0xb00000 && a < 0xb00800) {
    state.colorRam[a - 0xb00000] = v;
  }
}

// ─── Main function: FUN_3A08 replica ─────────────────────────────────────────

/**
 *
 *                   MMIO regions according to the memory map).
 *                   Treated as unsigned.
 *                   (null terminator) toward `bufEnd` (first char).
 *                   in the `dbf` loop. Must be >= 1 to produce output.
 *
 */
export function helper3A08(
  state: GameState,
  value: number,
  bufEnd: number,
  numDigits: number,
  showSpaces: number,
): void {
  // D1 = value (long unsigned)
  let d1 = value >>> 0;

  let d0w = numDigits & 0xffff;

  // A0 = bufEnd + numDigits
  let a0 = (bufEnd + d0w) >>> 0;

  // clr.b (A0) — null-terminator
  writeU8(state, a0, 0);

  if (d1 === 0) {
    // move.b #0x30,-(A0)
    a0 = (a0 - 1) >>> 0;
    writeU8(state, a0, 0x30); // '0'
    // subq.w #1,D0w
    d0w = (d0w - 1) & 0xffff;
  }

  d0w = (d0w - 1) & 0xffff;

  // bmi.b: branch if N flag set (d0w >= 0x8000, i.e., d0w as signed < 0)
  if (d0w >= 0x8000) return;

  // showSpaces: low word of arg4
  const showSp = (showSpaces & 0xffff) === 1;

  while (true) {
    let d2w = d1 & 0xf;

    // cmpi.w #0xa,D2w; blt -> addq.w #7 if D2w >= 10
    if (d2w >= 10) {
      d2w = (d2w + 7) & 0xffff;
    }

    // tst.l D1; bne → skip space; cmpi.w #1,(0x16,SP); bne → skip
    if (d1 === 0 && showSp) {
      // move.w #-0x10,D2w  →  addi.w #0x30 → 0x20 = ' '
      d2w = (-0x10) & 0xffff;
    }

    // addi.w #0x30,D2w
    d2w = (d2w + 0x30) & 0xffff;

    // move.b D2b,-(A0)  (pre-decrement)
    a0 = (a0 - 1) >>> 0;
    writeU8(state, a0, d2w & 0xff);

    // lsr.l #4,D1  (logical shift right, unsigned)
    d1 = d1 >>> 4;

    // dbf D0w,loop: D0w -= 1; if D0w != 0xFFFF (== -1 word), continue
    if (d0w === 0) break;
    d0w = (d0w - 1) & 0xffff;
  }
}
