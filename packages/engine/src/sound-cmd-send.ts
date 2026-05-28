/**
 * sound-cmd-send.ts - replica of `FUN_000158AC` (32 bytes).
 *
 * High-level wrapper called by roughly 100 ROM call sites to send a logical
 * command to the 6502 sound CPU. The original binary reuses this path for a few
 * nearby semantics; the final target `FUN_00004C6E` writes the sound mailbox.
 *
 * **Disasm 0x158AC..0x158CB** (32 byte):
 *
 *   move.b  (0x7,SP),D0b               ; D0.b = low byte of pushed long arg
 *   tst.w   (0x004003B8).l             ; flag "skip" word @ workRam+0x3B8
 *   beq.b   continue                   ; if zero, proceed
 *   moveq   #0,D0                      ; otherwise D0=0
 *   bra.b   done
 * continue:
 *   ext.w   D0w                        ; sign-extend byte to word
 *   ext.l   D0                         ; sign-extend word to long
 *   move.l  D0,-(SP)                   ; push long arg
 *   jsr     0x023C.l                   ; thunk → JMP 0x4C6E (sound dispatcher)
 *   addq.l  #4,SP                      ; pop arg
 * done:
 *   rts
 *
 * Caller convention: byte argument pushed as a long on the stack (M68k cdecl);
 * `(0x7,SP)` recovers the low byte of that pushed long.
 *
 * **Return (D0)**:
 *   0 = command not sent. Two causes:
 *       a) skip flag active (`*0x4003B8 != 0`)
 *       b) sound chip not ready after 256 retries in FUN_4C6E
 *   1 = command sent successfully (FUN_4C6E wrote 0xFE0000)
 *
 * **Side effects**: none on `workRam`. The observable effect is the MMIO write
 * to `0xFE0000`, modeled by higher-level audio/bus code.
 *
 * Sign-extension note: the byte is sign-extended to long before FUN_4C6E, but
 * FUN_4C6E reads only the word from the pushed long:
 *   - byte < 0x80: 0x00xx
 *   - byte >= 0x80: 0xFFxx
 * That value is then written to 0xFE0000 (16-bit mailbox; only the low byte
 * MAME's sound CPU receives the low byte, which remains the original argument.
 *
 * TS models D0 here; chip side effects are handled outside this helper.
 */

import type { GameState } from "./state.js";
import { notifySoundCmd as notifyGlobalSoundCmd } from "./sound-hook.js";

/** workRam-relative offset of the "skip command" word. */
const SKIP_FLAG_WORD_OFF = 0x3b8;

/**
 * Mirrors `FUN_000158AC`, the sound command send wrapper with skip flag.
 *
 * @param state         GameState; reads `workRam[0x3B8..0x3B9]` as BE word.
 * @param byteArg       Logical command byte.
 * @param chipPending   Models MMIO `0xF60001` bit 7 for FUN_4C6E. Default
 *                      false means chip ready and D0=1; true exhausts retries.
 * @returns 0 when skipped or never ready, 1 when sent.
 */
export function soundCmdSend(
  state: GameState,
  byteArg: number,
  chipPending: boolean = false,
): number {
  // `byteArg` is accepted to mirror the ROM calling convention. FUN_4C6E would
  // write it to MMIO 0xFE0000; higher layers own that side effect.
  void byteArg;
  // tst.w (0x004003B8).l reads a big-endian word @ workRam+0x3B8.
  // tst.w reads a word, so either byte being non-zero activates the flag.
  const skipFlag =
    (((state.workRam[SKIP_FLAG_WORD_OFF] ?? 0) << 8) |
      (state.workRam[SKIP_FLAG_WORD_OFF + 1] ?? 0)) &
    0xffff;

  if (skipFlag !== 0) {
    // moveq #0,D0; bra done, with no side effect.
    return 0;
  }

  // Send path: equivalent to JSR 0x4C6E with the byte sign-extended to long.
  if (chipPending) {
    // Loop exhausts after 256 retries -> D0=0.
    return 0;
  }
  // Optional side effect: notify the web frontend of the sent command.
  notifyGlobalSoundCmd(byteArg & 0xff);
  return 1;
}
