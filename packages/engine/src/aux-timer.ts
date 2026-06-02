/**
 * aux-timer.ts - mirror of `FUN_00010146` (secondary timer/counter, 72 bytes).
 *
 * Called by mainTick (`FUN_00028788`) in place of the former
 * "FUN_10146 secondary timer" placeholder in `main-tick.ts`. It consumes one
 * byte from circular queue `0x401F44` (see `byte-queue.ts`) and updates two
 * small service-state fields in work RAM based on the dequeued byte and the
 * countdown word `*0x4003B8`.
 *
 * **Disasm 0x10146..0x1018e** (72 byte, 0 args, 0 ret):
 *
 *   jsr     (0x178).l                  ; D0 = dequeueByte()  (FUN_4D68)
 *   cmpi.l  #-0x1, D0
 *   beq.b   end                        ; empty queue -> return (no-op)
 *
 *   tst.w   (0x004003B8).l             ; word countdown / "armed"
 *   beq.b   skip_b8_branch
 *     cmpi.w #0xFF, D0w                ; sentinel byte 0xFF in the low byte
 *     bne.b  skip_b8_branch
 *     clr.w  (0x004003B8).l            ; -> "ack/clear"
 *     bra.b  end                       ; and does not touch *0x4003B4
 *   skip_b8_branch:
 *
 *   tst.b   (0x004003B2).l             ; "active mode" flag (e.g. game-main-gate set 0x40)
 *   beq.b   inc_b4
 *     andi.w #0x7, D0w                 ; only if the byte's low 3 bits are 0
 *     bne.b  inc_b4
 *     clr.b  (0x004003B2).l            ; reset paired flags
 *     clr.b  (0x004003B4).l
 *     bra.b  end
 *   inc_b4:
 *     addq.b #1, (0x004003B4).l        ; counter wraps modulo 256 (M68k addq.b)
 *
 *   end: rts
 *
 * **Touched global state** (work RAM, see also `boot-init.ts`):
 *   - `0x4003B2` byte: active flag (set to 0x40 by `game-main-gate.ts` Block C)
 *   - `0x4003B4` byte: secondary counter (incremented for non-ack ticks)
 *   - `0x4003B8` word: 16-bit countdown (initialized to 0x012C by `FUN_100E0`)
 *
 * **Intuitive semantics** (interpretation, not yet verified in-game):
 *   The routine drains one byte at a time from sound queue 0x401F44 and uses it
 *   as a tick clock for two timers:
 *     - if `*0x4003B8 != 0` and sentinel byte `0xFF` arrives, the countdown is
 *       cleared as an "ack" handshake.
 *     - otherwise, if `*0x4003B2 != 0` (active mode) and a multiple-of-8 byte
 *       arrives, the active flag and counter `0x4003B4` are reset, likely
 *       marking the end of a sequence.
 *     - in every other non-empty path, counter `0x4003B4` increments by 1.
 *
 * Bit-perfect verification against the binary:
 * `cli/src/test-aux-timer-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";
import { dequeueByte } from "./byte-queue.js";

/** workRam offsets (absolute address = +0x400000). */
export const ACTIVE_FLAG_OFF = 0x3b2 as const; // byte
export const COUNTER_OFF = 0x3b4 as const; // byte
export const COUNTDOWN_HI_OFF = 0x3b8 as const; // word big-endian (hthe bytes)
export const COUNTDOWN_LO_OFF = 0x3b9 as const; // word big-endian (lo byte)

/**
 * Mirrors `FUN_00010146` - "aux timer" service subroutine.
 *
 * No arguments and no return value. Side effects are limited to `state.workRam`
 * and, via `dequeueByte`, the head pointer of queue 0x401F44.
 *
 * @param state Current GameState, mutated in place.
 */
export function auxTimer(state: GameState): void {
  // jsr 0x178 -> FUN_4D68 (dequeueByte). Returns 0xFFFFFFFF when empty.
  const d0 = dequeueByte(state) >>> 0;

  // cmpi.l #-1, D0 ; beq end -> no-op when the queue is empty.
  if (d0 === 0xffffffff) return;

  // tst.w *0x4003B8 — word big-endian: hi=workRam[0x3B8], lo=workRam[0x3B9].
  const hi = state.workRam[COUNTDOWN_HI_OFF] ?? 0;
  const lo = state.workRam[COUNTDOWN_LO_OFF] ?? 0;
  const countdownWord = ((hi << 8) | lo) & 0xffff;

  if (countdownWord !== 0) {
    // cmpi.w #0xFF, D0w: low-word compare, but D0 is 0..255 (byte).
    // beq only matches when d0_low_word == 0xFF.
    if ((d0 & 0xffff) === 0xff) {
      // clr.w *0x4003B8 ; bra end (does not touch *0x4003B4).
      state.workRam[COUNTDOWN_HI_OFF] = 0;
      state.workRam[COUNTDOWN_LO_OFF] = 0;
      return;
    }
    // `bne` falls through to the next test.
  }

  // tst.b *0x4003B2 ; beq inc_b4
  const activeFlag = state.workRam[ACTIVE_FLAG_OFF] ?? 0;
  if (activeFlag !== 0) {
    // andi.w #7, D0w -> only byte bits 0..2. bne inc_b4.
    if ((d0 & 0x7) === 0) {
      // clr.b *0x4003B2 ; clr.b *0x4003B4 ; bra end.
      state.workRam[ACTIVE_FLAG_OFF] = 0;
      state.workRam[COUNTER_OFF] = 0;
      return;
    }
  }

  // inc_b4: addq.b #1, *0x4003B4. Wrap modulo 256 (byte add).
  state.workRam[COUNTER_OFF] = (((state.workRam[COUNTER_OFF] ?? 0) + 1) & 0xff);
}
