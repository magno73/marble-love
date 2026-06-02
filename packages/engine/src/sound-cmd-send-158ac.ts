/**
 * sound-cmd-send-158ac.ts - replica of `FUN_000158AC` (32 bytes).
 *
 * **Disasm 0x158AC..0x158CB** (confirmed via ghidra_disasm_at.py):
 *
 *   000158ac  move.b (0x7,SP),D0b        ; D0.b = low byte of pushed long
 *   000158b0  tst.w  (0x004003b8).l      ; flag "skip" word @ workRam+0x3B8
 *   000158b6  beq.b  0x000158bc          ; if zero, proceed
 *   000158b8  moveq  0x0,D0              ; otherwise D0=0
 *   000158ba  bra.b  0x000158ca
 *   000158bc  ext.w  D0w                 ; sign-extend byte to word
 *   000158be  ext.l  D0                  ; sign-extend word to long
 *   000158c0  move.l D0,-(SP)            ; push long arg
 *   000158c2  jsr    0x0000023c.l        ; thunk → JMP 0x4C6E (sound dispatcher)
 *   000158c8  addq.l 0x4,SP              ; pop arg
 *   000158ca  rts
 *
 * Behavior:
 *   - `tst.w (0x004003B8).l` reads a big-endian word from workRam[0x3B8..0x3B9].
 *     If non-zero, the skip flag is active and D0 returns 0 immediately.
 *   - If skip is zero, the byte is sign-extended to long and passed to
 *     FUN_4C6E, which writes the sound mailbox when the chip is ready.
 *   - This module models D0 and emits optional hooks; bus/chip code owns MMIO.
 *
 * Return:
 *   0 = not sent, because skip flag is set or chip never became ready.
 *   1 = sent, when `chipPending=false`.
 *
 * Callers: 98 ROM call sites; this is the central sound-command path.
 */

import type { GameState } from "./state.js";

/** ROM address of FUN_158AC. */
export const SOUND_CMD_SEND_158AC_ADDR = 0x000158ac as const;

/** workRam offset relative to 0x400000 for the "skip command" BE word. */
const SKIP_FLAG_WORD_OFF = 0x3b8 as const;

/**
 * Bit-exact replica of `FUN_000158AC`, the sound command send wrapper.
 *
 * @param state        Reads `workRam[0x3B8..0x3B9]` as a BE skip word.
 * @param cmd          Logical command byte to send to the chip.
 * @param chipPending  Models MMIO `0xF60001` bit 7. Default false means ready.
 * @returns            0 = skipped/not ready; 1 = sent.
 */
import { notifySoundCmd as notifyGlobalSoundCmd } from "./sound-hook.js";

/** Optional external hook called when soundCmdSend158AC sends a command. Used by
 * the web frontend to wire SoundChip.submitCommand without mutating GameState. */
let onSoundCmdHook: ((cmd: number) => void) | undefined = undefined;

export function setSoundCmdHook(hook: ((cmd: number) => void) | undefined): void {
  onSoundCmdHook = hook;
}

export function soundCmdSend158AC(
  state: GameState,
  cmd: number,
  chipPending: boolean = false,
): number {
  // tst.w (0x004003B8).l reads a big-endian word; skip when non-zero.
  const skipWord =
    (((state.workRam[SKIP_FLAG_WORD_OFF] ?? 0) << 8) |
      (state.workRam[SKIP_FLAG_WORD_OFF + 1] ?? 0)) &
    0xffff;

  if (skipWord !== 0) {
    // moveq #0,D0; bra.b done
    return 0;
  }

  // ext.w D0; ext.l D0 sign-extends byte to long. The low byte remains cmd.
  void ((cmd << 24) >> 24);

  // JSR 0x023C → FUN_4C6E (sound dispatcher).
  // Modeled with chipPending: busy -> D0=0, ready -> D0=1.
  if (chipPending) {
    // FUN_4C6E retries 256 times and returns D0=0 when never ready.
    return 0;
  }

  // Chip ready: FUN_4C6E writes MMIO 0xFE0000 and returns D0=1.
  if (onSoundCmdHook !== undefined) {
    onSoundCmdHook(cmd & 0xff);
  }
  // Notify the global hook as a fallback for other sub emitters.
  notifyGlobalSoundCmd(cmd & 0xff);
  return 1;
}
