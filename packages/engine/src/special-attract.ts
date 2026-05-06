/**
 * special-attract.ts — replica `FUN_000288F8` (68 byte).
 *
 * Sub chiamata da `FUN_00028788` (mainTick / IRQ4 vblank handler) dopo
 * `gameMainGate` e prima di `particleBounce`. Funzione "special / attract /
 * end-screen": legge il word signed @ `0x4003EA` (work RAM offset 0x3EA) e
 * decide quale comando sonoro inviare in base a 3 soglie discrete.
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
 * **Semantica**: dato `S = sint16(workRam[0x3EA..0x3EB])`:
 *   - `S >= 0x18` → soundCommand(0x67)
 *   - `0x0C <= S < 0x18` → soundCommand(0x65)
 *   - `S < 0x0C` (incluso negativo) → soundCommand(0x61)
 *
 * Le soglie 0x0C / 0x18 (12 / 24) suggeriscono uno step counter di
 * attract / end-screen che cambia tema sonoro a 1/3 e 2/3 della progressione.
 *
 * **Side effect**: solo la chiamata a FUN_158AC (sound queue). Nessuna
 * scrittura su workRam/colorRam/etc. da parte di FUN_288F8 stessa.
 *
 * **Arg passing alla sub**: `pea (imm).l` pusha un long sullo stack.
 * `FUN_00158AC` legge solo il byte LSB via `move.b (0x7,SP), D0b`. Quindi
 * la TS expone soltanto il byte (gli alti 24 bit non hanno significato).
 *
 * **JSR sub injection**: come `sound-tick.ts` con `SoundTickSubs`, `FUN_158AC`
 * (sound command sender) NON è ancora replicata in TS, quindi la chiamata
 * è esposta come callback opzionale `SpecialAttractSubs.soundCommand`. Il
 * caller (mainTick futuro) la collegherà al vero soundCommand replicator.
 */

import type { GameState } from "./state.js";

/** Offset (work RAM) della word signed letta da FUN_288F8. */
const STAGE_WORD_OFF = 0x3ea;

/** Soglia "alta": `S >= 0x18` → sound 0x67. */
const HIGH_THRESHOLD = 0x18;
/** Soglia "media": `S >= 0x0C` → sound 0x65 (a meno che high). */
const MID_THRESHOLD = 0x0c;

/** Sound IDs cabled in FUN_288F8 via `pea (imm).l; jsr FUN_158AC`. */
const SOUND_HIGH = 0x67;
const SOUND_MID = 0x65;
const SOUND_LOW = 0x61;

/**
 * Sub-functions stub iniettabili per `specialAttract`.
 *
 * `FUN_00158AC` (sound command sender) NON è replicata; default no-op.
 */
export interface SpecialAttractSubs {
  /**
   * `FUN_00158AC`: invia un sound command. Arg = byte LSB del long pushato
   * via `pea (imm).l`. Default no-op (caller futuro connette al sound chip).
   */
  soundCommand?: (cmd: number) => void;
}

/**
 * Replica `FUN_000288F8` — special / attract / end-screen sound trigger.
 *
 * Legge `int16` signed @ `workRam[0x3EA..0x3EB]` (big-endian) e chiama
 * `subs.soundCommand` con uno dei tre sound id (0x67 / 0x65 / 0x61) in base
 * alla soglia. Nessun side effect su workRam.
 *
 * @param state  GameState (legge `workRam[0x3EA..0x3EB]`).
 * @param subs   Stub iniettabili (default: soundCommand no-op).
 */
export function specialAttract(
  state: GameState,
  subs?: SpecialAttractSubs,
): void {
  const r = state.workRam;

  // Read int16 big-endian @ workRam[0x3EA..0x3EB] e sign-extend a JS number.
  const lo = r[STAGE_WORD_OFF + 1] ?? 0;
  const hi = r[STAGE_WORD_OFF] ?? 0;
  const u16 = ((hi << 8) | lo) & 0xffff;
  const s16 = u16 >= 0x8000 ? u16 - 0x10000 : u16;

  // Selezione branch identica al binario:
  //   bgt = "if D0 (= imm) > mem (signed) then skip current play".
  //   Equivale a: "if mem (signed) >= imm then play".
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
