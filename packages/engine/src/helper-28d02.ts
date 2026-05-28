/**
 * Bit-perfect port of `FUN_00028D02`.
 *
 * Saves or restores four playfield words per row between two circular banks
 * separated by 0x1000 bytes.
 *
 * **Disasm 0x28D02..0x28DB7** (46 istr, body range [0x28D02, 0x28DB7]):
 *
 *   00028d02  movem.l {D3 D2},-(SP)          ; save D2, D3
 *   00028d06  move.b  (0xf,SP),D1b           ; D1b = flag (low byte of stack arg long)
 *   00028d0a  move.w  (0x00400000).l,D0w     ; D0w = workRam[0] (xscroll word)
 *   00028d10  ext.l   D0                     ; D0 = sext(D0w)
 *   00028d12  andi.l  #0xfff8,D0             ; D0 &= 0xfff8
 *   00028d18  asl.l   #0x3,D0               ; D0 <<= 3 (×8)
 *   00028d1a  add.l   D0,D0                  ; D0 <<= 1 (×2) → total ×16
 *   00028d1c  addi.l  #0xa00440,D0           ; D0 += 0xa00440
 *   00028d22  movea.l D0,A0                  ; A0 = base
 *   00028d24  move.l  A0,D0                  ; D0 = A0
 *   00028d26  addi.l  #0x1000,D0             ; D0 += 0x1000
 *   00028d2c  movea.l D0,A1                  ; A1 = A0 + 0x1000 (second bank)
 *   00028d2e  exg     D3,A1                  ; D3 = A1 (to compare)
 *   00028d30  cmpi.l  #0xa01fff,D3           ; if D3 > 0xa01fff:
 *   00028d36  exg     D3,A1                  ; restore A1
 *   00028d38  bls.b   0x28d44                ;   else: no wrap
 *   00028d3a  move.l  A1,D3                  ; D3 = A1
 *   00028d3c  subi.l  #0x2000,D3             ; D3 -= 0x2000 (wrap)
 *   00028d42  movea.l D3,A1                  ; A1 = wrapped
 *   00028d44  clr.w   D2w                    ; D2 = 0 (loop counter)
 *   --- loop (D2 = 0..15, 16 iterations) ---
 *   00028d46  tst.b   D1b                    ; test flag
 *   00028d48  beq.b   0x28d6e                ; if 0 → restore branch
 *   --- SAVE branch (D1b != 0): copy from A0 to A1, write D2w + offset to A0 ---
 *   ; D2w = loop counter (0..15); copied first, then overwritten with D2w+offset.
 *   00028d4a  move.w  (A0),(A1)+             ; *A1++ = *A0 (word 0 saved)
 *   00028d4c  move.w  D2w,(A0)+              ; *A0++ = D2w (iter index)
 *   00028d4e  move.w  (A0),(A1)+             ; *A1++ = *A0 (word 1 saved)
 *   00028d50  move.w  D2w,D0w               ; D0w = D2w
 *   00028d52  addi.w  #0x10,D0w             ; D0w = D2w + 0x10
 *   00028d56  move.w  D0w,(A0)+             ; *A0++ = D2w + 0x10
 *   00028d58  move.w  (A0),(A1)+             ; *A1++ = *A0 (word 2 saved)
 *   00028d5a  move.w  D2w,D0w               ; D0w = D2w
 *   00028d5c  addi.w  #0x20,D0w             ; D0w = D2w + 0x20
 *   00028d60  move.w  D0w,(A0)+             ; *A0++ = D2w + 0x20
 *   00028d62  move.w  (A0),(A1)+             ; *A1++ = *A0 (word 3 saved)
 *   00028d64  move.w  D2w,D0w               ; D0w = D2w
 *   00028d66  addi.w  #0x30,D0w             ; D0w = D2w + 0x30
 *   00028d6a  move.w  D0w,(A0)+             ; *A0++ = D2w + 0x30
 *   00028d6c  bra.b   0x28d76
 *   --- RESTORE branch (D1b == 0): copy 4 words from A1 to A0 ---
 *   00028d6e  move.w  (A1)+,(A0)+           ; *A0++ = *A1++
 *   00028d70  move.w  (A1)+,(A0)+
 *   00028d72  move.w  (A1)+,(A0)+
 *   00028d74  move.w  (A1)+,(A0)+
 *   --- post 4-word transfer: advance by 0x78 bytes, wrap both A0 and A1 ---
 *   00028d76  moveq   0x78,D0               ; D0 = 0x78
 *   00028d78  adda.l  D0,A1                 ; A1 += 0x78
 *   00028d7a  exg     D3,A1                 ; wrap check A1
 *   00028d7c  cmpi.l  #0xa01fff,D3
 *   00028d82  exg     D3,A1
 *   00028d84  bls.b   0x28d90
 *   00028d86  move.l  A1,D3
 *   00028d88  subi.l  #0x2000,D3
 *   00028d8e  movea.l D3,A1
 *   00028d90  moveq   0x78,D0               ; D0 = 0x78
 *   00028d92  adda.l  D0,A0                 ; A0 += 0x78
 *   00028d94  exg     D3,A0                 ; wrap check A0
 *   00028d96  cmpi.l  #0xa01fff,D3
 *   00028d9c  exg     D3,A0
 *   00028d9e  bls.b   0x28daa
 *   00028da0  move.l  A0,D3
 *   00028da2  subi.l  #0x2000,D3
 *   00028da8  movea.l D3,A0
 *   00028daa  addq.w  #0x1,D2w             ; D2++
 *   00028dac  moveq   0x10,D0              ; D0 = 16
 *   00028dae  cmp.w   D2w,D0w             ; cmp D2, 16 → branch if ne
 *   00028db0  bne.b   0x28d46              ; loop if D2 != 16
 *   00028db2  movem.l (SP)+,{D2 D3}       ; restore
 *   00028db6  rts
 *
 * Semantics:
 *   - A1 = A0 + 0x1000, wrapping through the opposite circular bank.
 *
 * Callers (`FUN_00028972` = `gameMainGate`):
 *   - `jsr FUN_28D02` with long arg `(0x1).w` when bit 0 of `*0x4003AA` is clear.
 *   - `jsr FUN_28D02` with long arg `clr.l` (= 0) at the end of block C.
 *
 * Side effects:
 *   - Mutates `state.playfieldRam` in the covered row region with 0x2000-byte
 *     circular wrapping.
 *
 */

import type { GameState } from "./state.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** ROM symbol address. */
export const HELPER_28D02_ADDR = 0x00028d02 as const;

/** PF RAM base absolute address. */
const PF_BASE = 0xa00000 as const;
/** PF RAM size (8 KB, circular). */
const PF_SIZE = 0x2000 as const;

/**
 * Wrap threshold: the 68k instruction `cmpi.l #0xa01fff, D` followed by
 * `bls` (branch if ≤ unsigned) wraps when D > 0xa01fff.
 */
const PF_WRAP_THRESHOLD = 0xa01fff as const;

/** Base offset into PF RAM where the function anchors: 0xa00440. */
const PF_ANCHOR_ADDR = 0xa00440 as const;

/** Workram offset of the xscroll word (absolute 0x400000). */
const XSCROLL_OFF = 0x0000 as const;

/** Skip amount after the 4-word transfer (0x78 = 128 - 8 bytes) to reach the next row entry. */
const ROW_SKIP = 0x78 as const;

/** Number of rows (loop iterations). */
const ROW_COUNT = 16 as const;

/** Inter-bank offset: A1 = A0 + 0x1000. */
const BANK_OFFSET = 0x1000 as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Read a 16-bit big-endian word from playfieldRam at absolute PF address. */
function pfReadWord(state: GameState, abs: number): number {
  const off = (abs - PF_BASE) & (PF_SIZE - 1);
  return (((state.playfieldRam[off] ?? 0) << 8) | (state.playfieldRam[off + 1] ?? 0)) & 0xffff;
}

/** Write a 16-bit big-endian word to playfieldRam at absolute PF address. */
function pfWriteWord(state: GameState, abs: number, value: number): void {
  const off = (abs - PF_BASE) & (PF_SIZE - 1);
  state.playfieldRam[off] = (value >>> 8) & 0xff;
  state.playfieldRam[off + 1] = value & 0xff;
}

/**
 * Wrap a PF RAM absolute address using the exact 68k logic:
 *   if addr > 0xa01fff: addr -= 0x2000
 * (bls = branch if ≤ unsigned; i.e. only wraps when addr > 0xa01fff)
 */
function pfWrap(addr: number): number {
  const a = addr >>> 0;
  return a > PF_WRAP_THRESHOLD ? (a - PF_SIZE) >>> 0 : a;
}

// ─── Main function ───────────────────────────────────────────────────────────

/**
 *
 * @param flag Low byte of the caller's long stack argument. Nonzero saves the
 *             current A0 words into A1 and writes generated row markers into
 *             A0; zero restores the four words from A1 to A0.
 */
export function helper28D02(state: GameState, flag: number): void {
  const xscrollRaw =
    (((state.workRam[XSCROLL_OFF] ?? 0) << 8) | (state.workRam[XSCROLL_OFF + 1] ?? 0)) & 0xffff;
  // ext.l: sign-extend 16-bit → 32-bit (then mask with 0xfff8).
  const xscroll = (xscrollRaw & 0x8000 ? xscrollRaw - 0x10000 : xscrollRaw) | 0;

  // D0 = (xscroll & 0xfff8) << 3 << 1 = (xscroll & 0xfff8) * 16
  const d0 = (((xscroll & 0xfff8) * 16) + PF_ANCHOR_ADDR) >>> 0;

  // A0 = base address in PF RAM
  let a0 = d0;

  // A1 = A0 + 0x1000, with wrap
  let a1 = pfWrap((a0 + BANK_OFFSET) >>> 0);

  // D1b = flag (byte, tested with tst.b)
  const d1b = flag & 0xff;

  // Loop D2 = 0..15
  for (let d2 = 0; d2 < ROW_COUNT; d2++) {
    if (d1b !== 0) {
      // SAVE mode: copy 4 words from A0 to A1, replace A0 words with D2w + offset.
      // D2w is the current loop counter (0..15); written values are:
      //   word 0: D2w (= d2)
      //   word 1: D2w + 0x10
      //   word 2: D2w + 0x20
      //   word 3: D2w + 0x30
      const d2w = d2 & 0xffff;

      const w0 = pfReadWord(state, a0);
      pfWriteWord(state, a1, w0);
      a1 = pfWrap((a1 + 2) >>> 0);
      pfWriteWord(state, a0, d2w);
      a0 = pfWrap((a0 + 2) >>> 0);

      const w1 = pfReadWord(state, a0);
      pfWriteWord(state, a1, w1);
      a1 = pfWrap((a1 + 2) >>> 0);
      pfWriteWord(state, a0, (d2w + 0x10) & 0xffff);
      a0 = pfWrap((a0 + 2) >>> 0);

      const w2 = pfReadWord(state, a0);
      pfWriteWord(state, a1, w2);
      a1 = pfWrap((a1 + 2) >>> 0);
      pfWriteWord(state, a0, (d2w + 0x20) & 0xffff);
      a0 = pfWrap((a0 + 2) >>> 0);

      const w3 = pfReadWord(state, a0);
      pfWriteWord(state, a1, w3);
      a1 = pfWrap((a1 + 2) >>> 0);
      pfWriteWord(state, a0, (d2w + 0x30) & 0xffff);
      a0 = pfWrap((a0 + 2) >>> 0);
    } else {
      // RESTORE mode: copy 4 words from A1 to A0
      pfWriteWord(state, a0, pfReadWord(state, a1));
      a0 = pfWrap((a0 + 2) >>> 0);
      a1 = pfWrap((a1 + 2) >>> 0);

      pfWriteWord(state, a0, pfReadWord(state, a1));
      a0 = pfWrap((a0 + 2) >>> 0);
      a1 = pfWrap((a1 + 2) >>> 0);

      pfWriteWord(state, a0, pfReadWord(state, a1));
      a0 = pfWrap((a0 + 2) >>> 0);
      a1 = pfWrap((a1 + 2) >>> 0);

      pfWriteWord(state, a0, pfReadWord(state, a1));
      a0 = pfWrap((a0 + 2) >>> 0);
      a1 = pfWrap((a1 + 2) >>> 0);
    }

    // Advance A1 by 0x78 (skip to next row entry), with wrap
    a1 = pfWrap((a1 + ROW_SKIP) >>> 0);

    // Advance A0 by 0x78 (skip to next row entry), with wrap
    a0 = pfWrap((a0 + ROW_SKIP) >>> 0);

    // D2++ already handled by for loop
  }
}

/** Re-export as canonical ROM symbol name. */
export { helper28D02 as FUN_00028D02 };
