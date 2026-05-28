/**
 * sound-pair-15884.ts - replica of `FUN_00015884` (40 bytes).
 *
 * Minimal helper: sends sound id `0x3A` through `FUN_00158AC`, then sends
 * `0x3B` unless the game-mode word at `0x400394` equals 2. The two ids usually
 * form a pair, and mode 2 suppresses the second trigger.
 *
 * **Disasm 0x15884..0x158AB** (40 byte):
 *
 *   pea     (0x3A).l                  ; arg long, byte LSB = 0x3A
 *   jsr     0x000158AC.l              ; FUN_158AC(0x3A)
 *   moveq   #0x2, D0                  ; D0 = 2
 *   cmp.w   (0x00400394).l, D0w       ; D0 - mem (word compare)
 *   addq.l  #0x4, SP                  ; pop arg 0x3A
 *   beq.b   end                       ; if mem == 2, skip second trigger
 *   pea     (0x3B).l                  ; arg long, byte LSB = 0x3B
 *   jsr     0x000158AC.l              ; FUN_158AC(0x3B)
 *   addq.l  #0x4, SP                  ; pop arg 0x3B
 * end:
 *   rts
 *
 * Semantics for `M = uint16(workRam[0x394..0x395])`:
 *   - always: `soundCommand(0x3A)`
 *   - if `M != 2`: `soundCommand(0x3B)`
 *   - if `M == 2`: single trigger only
 *
 * `0x400394` is the game-mode discriminator; known values `0`, `2`, and `4`
 * select sub-states.
 *
 * Side effect: only the one or two calls to FUN_158AC. FUN_15884 itself does
 * not write workRam/colorRam/etc.
 *
 * Argument passing: `pea (imm).l` pushes a long and FUN_00158AC reads only its
 * low byte. TS exposes only that byte.
 *
 * JSR injection: like `special-attract.ts`, FUN_158AC is injectable through
 * `SoundPair15884Subs.soundCommand`.
 *
 * CMP.W compares only the low 16 bits; sign extension does not affect the
 * branch decision.
 */

import type { GameState } from "./state.js";
import { notifySoundCmd as notifyGlobalSoundCmd } from "./sound-hook.js";

/** workRam offset of the game-mode word read by FUN_15884. */
const GAME_MODE_WORD_OFF = 0x394;

/** Game-mode value that suppresses the second sound trigger. */
const SUPPRESS_SECOND_MODE = 0x0002;

/** Sound IDs cabled in FUN_15884 via `pea (imm).l; jsr FUN_158AC`. */
const SOUND_FIRST = 0x3a;
const SOUND_SECOND = 0x3b;

/**
 * Injectable sub-function stubs for `soundPair15884`.
 *
 * `FUN_00158AC` is modeled elsewhere; this hook keeps the helper testable.
 */
export interface SoundPair15884Subs {
  /**
   * `FUN_00158AC`: sends a sound command. Arg is the low byte of the long
   * pushed via `pea (imm).l`.
   */
  soundCommand?: (cmd: number) => void;
}

/**
 * Mirrors `FUN_00015884`, a sound-pair trigger with game-mode gate.
 *
 * Reads BE uint16 at `workRam[0x394..0x395]`. Always sends sound id `0x3A`; if
 * the word is not `0x0002`, also sends `0x3B`. No workRam side effects.
 *
 * @param state  GameState; reads `workRam[0x394..0x395]`.
 * @param subs   Injectable stubs.
 */
export function soundPair15884(
  state: GameState,
  subs?: SoundPair15884Subs,
): void {
  const r = state.workRam;

  // First trigger always runs before the compare.
  subs?.soundCommand?.(SOUND_FIRST);
  notifyGlobalSoundCmd(SOUND_FIRST);

  // Read uint16 big-endian @ workRam[0x394..0x395].
  // `cmp.w D0=2, mem.w` branches when `mem == 2` (word, unsigned).
  const hi = r[GAME_MODE_WORD_OFF] ?? 0;
  const lo = r[GAME_MODE_WORD_OFF + 1] ?? 0;
  const mode = ((hi << 8) | lo) & 0xffff;

  if (mode === SUPPRESS_SECOND_MODE) {
    return;
  }

  // Second trigger — gated.
  subs?.soundCommand?.(SOUND_SECOND);
  notifyGlobalSoundCmd(SOUND_SECOND);
}
