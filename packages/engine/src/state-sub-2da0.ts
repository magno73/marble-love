/**
 * state-sub-2da0.ts - port of `FUN_00002DA0` (120 bytes).
 *
 * State-machine helper "alpha-tile clear-or-noop".
 *
 *   - `arg1Long` (A0): pointer to a struct (col_byte @ +0, tickOff_byte @ +1,
 *     stringPtr_long @ +2). Same layout as entries processed by
 *     `FUN_2ABC` (clearStringChain) and `FUN_2572` (renderStringChain).
 *
 * **Disasm 0x2DA0..0x2E16** (120 byte):
 *
 *   movem.l {A2 D3 D2}, -(SP)         ; save A2,D3,D2 (12 bytes)
 *   movea.l (0x10, SP), A0            ; A0 = arg1 long
 *   move.b  (0x17, SP), D2b           ; D2.b = LSB of arg2 long
 *   movea.l #0xa03000, A1             ; A1 = ALPHA_RAM_BASE
 *   moveq   #0, D1
 *   move.b  D2b, D1b                  ; D1 = arg2_byte (zero-ext)
 *   move.l  D1, D0                    ; D0 = arg2_byte
 *   add.l   (0x2, A0), D0             ; D0 += long @ A0+2 (stringPtr)
 *   movea.l D0, A2                    ; A2 = stringPtr + arg2_byte
 *   tst.w   (0x00401f42).l            ; rotation
 *   beq.b   no_rot                    ; if rotation == 0: branch
 *     ; rotation != 0:
 *     moveq   #0x29, D3
 *     move.b  (0x1, A0), D0b
 *     ext.w   D0w
 *     ext.l   D0
 *     sub.l   D0, D3                  ; D3 = 0x29 - sext(byte @ A0+1)
 *     bra.b   join
 *   no_rot:
 *     move.b  (0x1, A0), D3b
 *     ext.w   D3w
 *     ext.l   D3
 *     asl.l   #6, D3                  ; D3 = sext(byte @ A0+1) << 6
 *   join:
 *     move.b  (A0), D0b
 *     ext.w   D0w
 *     ext.l   D0                      ; D0 = sext(byte @ A0)  (col_byte signed)
 *     moveq   #0, D1
 *     move.b  D2b, D1b
 *     add.l   D1, D0                  ; D0 = colSigned + arg2_byte
 *     move.w  (0x00401f42).l, D1w
 *     ext.l   D1
 *     add.l   D1, D1                  ; D1 = rotation * 2
 *     movea.l #0x72a4, A0             ; A0 = ROM shift table
 *     move.b  (0x1, A0, D1*0x1), D1b  ; D1 = byte @ 0x72a5 + rotation*2
 *     lsl.l   D1, D0                  ; D0 = D0 << (D1 & 0x3f), 0 if shift>=32
 *     add.l   D3, D0                  ; D0 += D3
 *     add.l   D0, D0                  ; D0 *= 2 (word index → byte addr)
 *     adda.l  D0, A1                  ; A1 = 0xa03000 + D0
 *     tst.b   (A2)                    ; test byte @ stringPtr+arg2_byte
 *     bne.b   nonzero
 *       moveq   #0, D0                ; D0 = 0 (return: state stays 0?)
 *       bra.b   exit
 *     nonzero:
 *       clr.w   (A1)                  ; alphaRam_word[A1-0xa03000] = 0
 *       moveq   #4, D0                ; D0 = 4
 *     exit:
 *     movem.l (SP)+, {D2 D3 A2}
 *     rts
 *
 *   - If the selected string byte is 0 (string terminator), return 0 and the
 *     caller resets state to 0.
 *   - Otherwise clear the alpha word computed by the rotation/stride/shift
 *     formula, shared with FUN_2ABC.
 *
 * counter k=arg2_byte):
 *   if r == 0: D3 = sext_l(t) << 6
 *   else:      D3 = 0x29 - sext_l(t)
 *   shift = byte @ 0x72a5 + r*2  (ROM shift table, masked to 6 bits via lsl)
 *   pos = (((sext_l(c) + k) << shift) + D3) * 2
 *   alpha_addr = 0xa03000 + pos
 *
 * Verified against a deterministic MAME stub through
 * `cli/src/test-state-sub-2da0-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const ROTATION_OFF = 0x1f42 as const;
const ALPHA_BASE = 0xa03000 as const;
const ROM_SHIFT_TABLE = 0x72a4 as const;

/**
 * Kept for symmetry with neighboring state-machine helper patterns.
 */
export interface StateSub2DA0Subs {}

// ─── Memory helpers ──────────────────────────────────────────────────────

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}

/** Read byte at absolute address (subset memory map). */
function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a < 0x80000) return rom.program[a] ?? 0;
  if (a >= 0x400000 && a < 0x402000) return state.workRam[a - 0x400000] ?? 0;
  if (a >= 0xa02000 && a < 0xa03000) return state.spriteRam[a - 0xa02000] ?? 0;
  if (a >= 0xa03000 && a < 0xa04000) return state.alphaRam[a - 0xa03000] ?? 0;
  if (a >= 0xb00000 && a < 0xb00800) return state.colorRam[a - 0xb00000] ?? 0;
  return 0;
}

function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  return (
    ((readByteAbs(state, rom, addr) << 24) |
      (readByteAbs(state, rom, (addr + 1) >>> 0) << 16) |
      (readByteAbs(state, rom, (addr + 2) >>> 0) << 8) |
      readByteAbs(state, rom, (addr + 3) >>> 0)) >>>
    0
  );
}

/** Clear word in alpha RAM (only effect of FUN_2DA0 on memory). */
function clearAlphaWord(state: GameState, addr: number): void {
  const a = addr >>> 0;
  if (a >= 0xa03000 && a < 0xa04000) {
    const off = a - 0xa03000;
    state.alphaRam[off] = 0;
    state.alphaRam[off + 1] = 0;
  }
}

/**
 *
 * @param arg1Long pointer to a struct (long): col@+0, tickOff@+1, stringPtr_long@+2.
 * @param _subs    placeholder (FUN_2DA0 has no jsr).
 *
 * **Side effects** in `state.alphaRam`:
 */
export function stateSub2DA0(
  state: GameState,
  rom: RomImage,
  arg1Long: number,
  arg2Long: number,
  _subs?: StateSub2DA0Subs,
): number {
  const a0 = arg1Long >>> 0;
  const argByte = arg2Long & 0xff; // LSB of arg2 (D2.b)

  // A2 = (long @ A0+2) + argByte
  const stringPtr = readLongAbs(state, rom, (a0 + 2) >>> 0);
  const a2 = (stringPtr + argByte) >>> 0;

  // rotation @ 0x401F42 (word, treated as unsigned for tst.w but bit 15 sign-ext later)
  const rotationWord = readU16(state, ROTATION_OFF);

  // D3 branch
  let d3: number;
  // byte @ A0+1, sign-ext to long
  const tickOffByte = readByteAbs(state, rom, (a0 + 1) >>> 0);
  const tickOffSigned = tickOffByte & 0x80 ? tickOffByte - 0x100 : tickOffByte;
  if (rotationWord !== 0) {
    // D3 = 0x29 - sext_l(byte @ A0+1)
    d3 = (0x29 - tickOffSigned) | 0;
  } else {
    // D3 = sext_l(byte @ A0+1) << 6 (asl.l #6 — arithmetic shift,
    d3 = (tickOffSigned << 6) | 0;
  }

  // D0 = sext_l(byte @ A0)  (column, signed)
  const colByte = readByteAbs(state, rom, a0);
  const colSigned = colByte & 0x80 ? colByte - 0x100 : colByte;

  // D0 = colSigned + argByte
  let d0 = (colSigned + argByte) | 0;

  // D1 = rotation, ext to long, *2
  // Note: move.w + ext.l → sign-extend of the word.
  const rotationSigned =
    rotationWord & 0x8000 ? rotationWord - 0x10000 : rotationWord;
  const d1Word = (rotationSigned * 2) | 0;

  // D1 = byte @ 0x72a4 + 1 + d1Word  (zero-ext via move.b)
  const shiftByte = rom.program[(ROM_SHIFT_TABLE + 1 + d1Word) >>> 0] ?? 0;

  // lsl.l D1, D0 — m68k masks shift count to bottom 6 bits (mod 64).
  const shiftCount = shiftByte & 0x3f;
  if (shiftCount >= 32) {
    d0 = 0;
  } else {
    d0 = (d0 << shiftCount) | 0;
  }

  // D0 += D3
  d0 = (d0 + d3) | 0;
  // D0 *= 2 (add.l D0, D0)
  d0 = (d0 * 2) | 0;

  // A1 = 0xa03000 + D0
  const a1 = (ALPHA_BASE + d0) >>> 0;

  // tst.b (A2)
  const stringByte = readByteAbs(state, rom, a2);

  if (stringByte === 0) {
    // moveq #0, D0 → return 0 (terminator: caller resets state)
    return 0;
  }

  // clr.w (A1) — alpha tilemap word to 0
  clearAlphaWord(state, a1);
  // moveq #4, D0 → return 4 (state machine continues in state 4)
  return 4;
}
