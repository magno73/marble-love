/**
 * wait-vblank-state-gated.ts — replica `FUN_00028DB8` (50 byte).
 *
 * Variante "state-gated" of `vblank-wait.ts` (FUN_52B8). Differenze chiave:
 *
 *     FUN_52B8), but the primitive `FUN_00028DEA`, which:
 *       - clr.b *0x400016         (mailbox vblank ack)
 *       - spin: tst.b *0x400016; beq spin    (busy-wait IRQ vblank)
 *       - addq.b #1, *0x4003F0    (counter byte, wrap mod 256)
 *
 *     sign-extension of the LOW BYTE `*0x400391.b`. If i due differiscono,
 *
 * **Disasm 0x28DB8..0x28DE9** (50 byte, 1 arg long-on-stack, ret void):
 *
 *   00028DB8  movem.l {D3 D2}, -(SP)            ; save D2/D3 (8 byte)
 *   00028DBC  move.w  (0xE,SP), D0w              ; D0w = arg.lo word
 *                                                  ;   (0xE = 8 D2D3 + 4 retPC + 2 hiword)
 *   00028DC0  move.b  (0x00400391).l, D2b        ; D2b = low byte of state word
 *   00028DC6  move.w  D0w, D3w                   ; D3w = D0w (count)
 *   00028DC8  bra.b   check                      ; → tst.w D3w
 *   loop:
 *   00028DCA  jsr     0x00028DEA.l               ; vblankAck (1 tick)
 *   00028DD0  move.b  D2b, D0b                   ; D0b = saved low byte
 *   00028DD2  ext.w   D0w                         ; sign-extend byte→word
 *   00028DD4  cmp.w   (0x00400390).l, D0w         ; cmp w/ current word
 *   00028DDA  beq.b   skip
 *   00028DDC  clr.w   D3w                         ; state changed → exit next tst
 *   skip:
 *   00028DDE  subq.w  #1, D3w
 *   check:
 *   00028DE0  tst.w   D3w
 *   00028DE2  bgt.b   loop                        ; while D3w > 0 (signed)
 *   00028DE4  movem.l (SP)+, {D2 D3}
 *   00028DE8  rts
 *
 * **Convenzione caller** (cfr. xrefs FUN_10504 et al.):
 *   pea     (count).w        ; sext word→long, push 4 byte (BE: hi word, lo word)
 *   jsr     0x00028DB8.l
 *   addq.l  #4, SP           ; cleanup arg
 *
 * signed word (the same scheme as `waitVblank`).
 *
 *     - if bit 7 of D2b == 1 -> D0w = 0xFFxx
 *     - if bit 7 of D2b == 0 -> D0w = 0x00xx
 *     - "match" iff: high byte == 0x00 (D2b<0x80) o 0xFF (D2b>=0x80),
 *
 *   - workRam[0x16]   ← 0      (clr.b in FUN_28DEA)
 *   - workRam[0x3F0]  ← prev+1 (addq.b in FUN_28DEA, wrap mod 256)
 *
 *   The `tst.b *0x400016; beq spin` spin requires an external agent
 *   in the parity test) to set `*0x400016 != 0` before exit. Our TS
 *
 *   - countWord signed <= 0: N = 0 (loop does not start)
 *
 *
 * `cli/src/test-wait-vblank-state-gated-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";

/** Absolute WORK RAM base (the following workRam offsets are relative). */
export const WORK_RAM_BASE = 0x400000;

/** byte mailbox vblank ack: clr+spin in FUN_28DEA. */
export const VBLANK_MAILBOX_OFF = 0x16;
export const VBLANK_TICK_COUNTER_OFF = 0x3f0;
/** word game state (BE): hi=0x390, lo=0x391. Sign-extend lo via ext.w. */
export const GAME_STATE_WORD_OFF = 0x390;
export const GAME_STATE_LO_BYTE_OFF = 0x391;

/**
 *     workRam[0x3F0] applicati).
 *   - `d0w`: low word of D0 on return (sext_w(initialLoByte) if at least
 */
export interface WaitVblankStateGatedResult {
  iterations: number;
  d0w: number;
  aborted: boolean;
}

/**
 *
 *   - workRam[VBLANK_MAILBOX_OFF] ← 0
 *   - workRam[VBLANK_TICK_COUNTER_OFF] ← (prev + 1) & 0xFF
 *
 *
 * @param state         GameState; mutated in place.
 */
export function waitVblankStateGated(
  state: GameState,
  countWord: number,
  abortAtIter: number = 0,
  d0HiPrev: number = 0,
): WaitVblankStateGatedResult {
  // Tronca arg a 16 bit and reinterpreta signed (tst.w + bgt usano flags signed).
  const argW = countWord & 0xffff;
  const argSigned = argW & 0x8000 ? argW - 0x10000 : argW;

  const initialLoByte = (state.workRam[GAME_STATE_LO_BYTE_OFF] ?? 0) & 0xff;
  // sext_b -> word: if bit7, hthe bytes = 0xFF.
  const initialSextW =
    initialLoByte & 0x80 ? 0xff00 | initialLoByte : initialLoByte;

  if (argSigned <= 0) {
    return {
      iterations: 0,
      d0w: argW,
      aborted: false,
    };
  }

  const initialStateWord =
    (((state.workRam[GAME_STATE_WORD_OFF] ?? 0) << 8) |
      (state.workRam[GAME_STATE_LO_BYTE_OFF] ?? 0)) &
    0xffff;
  // hiByte != 0x00/0xFF consistent with bit 7 of loByte).
  const initialMismatch = initialSextW !== initialStateWord;

  // loop while but avoids useless O(count) work.
  // - abortAtIter in [1..argSigned]: abort to the iter k.
  let iterations: number;
  let aborts: boolean;
  if (initialMismatch) {
    iterations = 1;
    aborts = true;
  } else if (abortAtIter >= 1 && abortAtIter <= argSigned) {
    iterations = abortAtIter;
    aborts = true;
  } else {
    iterations = argSigned;
    aborts = false;
  }

  // Side effect: workRam[0x3F0] += iterations (byte add, wrap mod 256).
  const prev = state.workRam[VBLANK_TICK_COUNTER_OFF] ?? 0;
  state.workRam[VBLANK_TICK_COUNTER_OFF] = (prev + iterations) & 0xff;
  state.workRam[VBLANK_MAILBOX_OFF] = 0;

  //   move.b D2b, D0b   → D0 low byte = initialLoByte
  //   ext.w D0w         → D0w = sext_w(D2b)
  void d0HiPrev;
  const d0w = initialSextW & 0xffff;

  return {
    iterations,
    d0w,
    aborted: aborts,
  };
}

/**
 * Re-export of the simbolo as "FUN_00028DB8" per mappatura esplicita
 */
export { waitVblankStateGated as FUN_00028DB8 };
