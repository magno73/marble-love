/**
 * sound-pair-15884.ts — replica `FUN_00015884` (40 byte).
 *
 * Sub helper minimale: invia il sound id `0x3A` via `FUN_00158AC` (sound
 * command sender), poi — se il "game mode" word @ `0x400394` non vale `2` —
 * invia anche il sound id `0x3B`. Tipicamente i due id formano una coppia
 * (probabile stereo / left+right o intro+sustain dello stesso effetto)
 * e in mode `2` il binario sopprime il secondo trigger.
 *
 * **Disasm 0x15884..0x158AB** (40 byte):
 *
 *   pea     (0x3A).l                  ; arg long → byte LSB = 0x3A
 *   jsr     0x000158AC.l              ; FUN_158AC(0x3A) — sound trigger
 *   moveq   #0x2, D0                  ; D0 = 2
 *   cmp.w   (0x00400394).l, D0w       ; D0 - mem (word compare)
 *   addq.l  #0x4, SP                  ; pop arg 0x3A
 *   beq.b   end                       ; if mem == 2 → skip secondo trigger
 *   pea     (0x3B).l                  ; arg long → byte LSB = 0x3B
 *   jsr     0x000158AC.l              ; FUN_158AC(0x3B) — sound trigger
 *   addq.l  #0x4, SP                  ; pop arg 0x3B
 * end:
 *   rts
 *
 * **Semantica**: dato `M = uint16(workRam[0x394..0x395])` letto come word:
 *   - sempre: `soundCommand(0x3A)`
 *   - se `M != 2`: `soundCommand(0x3B)` (trigger pair)
 *   - se `M == 2`: skip pair (single trigger)
 *
 * **0x400394** è il "game mode discriminator" (cfr `trackball-apply.ts`,
 * `sprite-coords.ts`): valori noti `0`, `2`, `4` selezionano sub-state.
 *
 * **Side effect**: solo le 1 o 2 chiamate a FUN_158AC. Nessuna scrittura
 * su workRam/colorRam/etc. da parte di FUN_15884 stessa.
 *
 * **Arg passing alla sub**: `pea (imm).l` pusha un long sullo stack e
 * `FUN_00158AC` legge solo il byte LSB via `move.b (0x7,SP), D0b`. La TS
 * espone soltanto il byte (gli alti 24 bit non hanno significato).
 *
 * **JSR sub injection**: come `special-attract.ts` con `SpecialAttractSubs`,
 * `FUN_158AC` è sub esterna iniettabile via `SoundPair15884Subs.soundCommand`
 * (default no-op). Il caller (mainTick / context futuro) la collegherà al
 * vero sound dispatcher.
 *
 * **CMP.W con word zero-extended**: `cmp.w D0w, mem.w` confronta solo i 16
 * bit bassi; il flag `Z` riflette `(D0w - mem.w) == 0`. Quindi è un confronto
 * di word, indifferente al sign-extend (`D0=2`, `mem=0xFFFF` → 2-0xFFFF≠0
 * → Z=0 → secondo trigger eseguito).
 */

import type { GameState } from "./state.js";

/** Offset (work RAM) della word "game mode" letta da FUN_15884. */
const GAME_MODE_WORD_OFF = 0x394;

/** Valore di game mode che sopprime il secondo sound trigger. */
const SUPPRESS_SECOND_MODE = 0x0002;

/** Sound IDs cabled in FUN_15884 via `pea (imm).l; jsr FUN_158AC`. */
const SOUND_FIRST = 0x3a;
const SOUND_SECOND = 0x3b;

/**
 * Sub-functions stub iniettabili per `soundPair15884`.
 *
 * `FUN_00158AC` (sound command sender) NON è replicata; default no-op.
 */
export interface SoundPair15884Subs {
  /**
   * `FUN_00158AC`: invia un sound command. Arg = byte LSB del long pushato
   * via `pea (imm).l`. Default no-op (caller futuro connette al sound chip).
   */
  soundCommand?: (cmd: number) => void;
}

/**
 * Replica `FUN_00015884` — sound pair trigger con game-mode gate.
 *
 * Legge `uint16` @ `workRam[0x394..0x395]` (big-endian). Invia sempre il
 * sound id `0x3A`; se la word non vale `0x0002` invia anche `0x3B`. Nessun
 * side effect su workRam.
 *
 * @param state  GameState (legge `workRam[0x394..0x395]`).
 * @param subs   Stub iniettabili (default: soundCommand no-op).
 */
export function soundPair15884(
  state: GameState,
  subs?: SoundPair15884Subs,
): void {
  const r = state.workRam;

  // First trigger — sempre eseguito (precede la cmp).
  subs?.soundCommand?.(SOUND_FIRST);

  // Read uint16 big-endian @ workRam[0x394..0x395].
  // `cmp.w D0=2, mem.w` → branch se `mem == 2` (word, unsigned).
  const hi = r[GAME_MODE_WORD_OFF] ?? 0;
  const lo = r[GAME_MODE_WORD_OFF + 1] ?? 0;
  const mode = ((hi << 8) | lo) & 0xffff;

  if (mode === SUPPRESS_SECOND_MODE) {
    return;
  }

  // Second trigger — gated.
  subs?.soundCommand?.(SOUND_SECOND);
}
