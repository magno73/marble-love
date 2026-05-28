/**
 * special-attract.ts — replica `FUN_000288F8` (68 byte).
 *
 * Chooses which sound command to send based on three discrete thresholds.
 *
 * **Disasm 0x288F8..0x2893A** (68 byte):
 *
 *   moveq   #0x18, D0
 *   cmp.w   (0x004003EA).l, D0w        ; D0 - mem
 *   bgt.b   skip0x67                   ; if D0 > mem (signed) → skip
 *   pea     (0x67).l                   ; arg = sound id 0x67
 *   jsr     0x000158ac.l               ; FUN_158AC: play sound (byte arg LSB)
 *   addq.l  #4, SP
 *   bra.b   end
 * skip0x67:
 *   moveq   #0x0C, D0
 *   cmp.w   (0x004003EA).l, D0w
 *   bgt.b   skip0x65
 *   pea     (0x65).l
 *   jsr     0x000158ac.l
 *   addq.l  #4, SP
 *   bra.b   end
 * skip0x65:
 *   pea     (0x61).l
 *   jsr     0x000158ac.l
 *   addq.l  #4, SP
 * end:
 *   rts
 *
 * **Semantics**: given `S = sint16(workRam[0x3EA..0x3EB])`:
 *   - `S >= 0x18` -> soundCommand(0x67)
 *   - `0x0C <= S < 0x18` -> soundCommand(0x65)
 *   - `S < 0x0C` (including negative) -> soundCommand(0x61)
 *
 * Thresholds 0x0C / 0x18 (12 / 24) suggest an attract/end-screen step counter
 * that changes sound theme at one-third and two-thirds progress.
 *
 *
 * **Subroutine arg passing**: `pea (imm).l` pushes a long on the stack. The TS
 * API exposes only the low byte; the high 24 bits carry no meaning here.
 *
 * **JSR sub injection**: as in `sound-tick.ts` with `SoundTickSubs`, `FUN_158AC`
 */

import type { GameState } from "./state.js";

const STAGE_WORD_OFF = 0x3ea;

/** High threshold: `S >= 0x18` -> sound 0x67. */
const HIGH_THRESHOLD = 0x18;
/** Mid threshold: `S >= 0x0C` -> sound 0x65 unless high threshold wins. */
const MID_THRESHOLD = 0x0c;

/** Sound IDs cabled in FUN_288F8 via `pea (imm).l; jsr FUN_158AC`. */
const SOUND_HIGH = 0x67;
const SOUND_MID = 0x65;
const SOUND_LOW = 0x61;

/**
 *
 */
export interface SpecialAttractSubs {
  /**
   * `FUN_00158AC`: sends a sound command. Arg = LSB byte of the long pushed via
   * `pea (imm).l`. Default no-op; caller wiring connects it to the sound chip.
   */
  soundCommand?: (cmd: number) => void;
}

/**
 * Replica `FUN_000288F8` — special / attract / end-screen sound trigger.
 *
 * Calls `subs.soundCommand` with one of the three sound IDs (0x67 / 0x65 / 0x61)
 * based on the signed stage word.
 *
 */
export function specialAttract(
  state: GameState,
  subs?: SpecialAttractSubs,
): void {
  const r = state.workRam;

  // Read int16 big-endian @ workRam[0x3EA..0x3EB] and sign-extend to JS number.
  const lo = r[STAGE_WORD_OFF + 1] ?? 0;
  const hi = r[STAGE_WORD_OFF] ?? 0;
  const u16 = ((hi << 8) | lo) & 0xffff;
  const s16 = u16 >= 0x8000 ? u16 - 0x10000 : u16;

  // bgt = "if D0 (= imm) > mem (signed), skip current play".
  // Equivalent to: "if mem (signed) >= imm, play".
  let cmd: number;
  if (s16 >= HIGH_THRESHOLD) {
    cmd = SOUND_HIGH;
  } else if (s16 >= MID_THRESHOLD) {
    cmd = SOUND_MID;
  } else {
    cmd = SOUND_LOW;
  }

  subs?.soundCommand?.(cmd);
}
