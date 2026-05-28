/**
 * Bit-perfect port of `FUN_0001A236`.
 *
 * Initializes level-load globals, stores the selected level pointer, then
 * chains the alpha clear, motion-object clear, `FUN_16F6C`, and palette-init
 * subcalls.
 *
 * **Disasm 0x1A236..0x1A286** (80 byte, 0 args, void ret):
 *
 *   move.l  D2,-(SP)                ; save D2
 *   clr.w   (0x00400394).l          ; *0x400394 = 0 (game-mode word)
 *   clr.w   (0x00400662).l          ; *0x400662 = 0 (slapstic index)
 *   move.w  #0x1, (0x00400664).l    ; *0x400664 = 1 (counter / flag word)
 *   ext.l   D0                      ; sign-extend D0.w → D0.l
 *   move.l  D0, D2                  ; D2 = D0
 *   asl.l   #0x2, D2                ; D2 <<= 2 → D2 = D0 * 4
 *   addi.l  #0x2BE00, D2            ; D2 += 0x2BE00 (level pointer table base)
 *   movea.l D2, A0                  ; A0 = level pointer table entry
 *   move.l  (A0), (0x00400474).l    ; *0x400474 = ROM[D2] (long, BE)
 *   clr.l   -(SP)                   ; push 0 long (arg per FUN_28C7E)
 *   jsr     0x00028C7E.l            ; clearAlphaTilesFromIndex(0)
 *   jsr     0x00012174.l            ; clearMoAlphaRam (no-op in TS state)
 *   jsr     0x00016F6C.l            ; FUN_16F6C — slapstic/level init
 *   jsr     0x0001A41E.l            ; paletteInitLevel(rom)
 *   addq.l  #0x4, SP                ; pop arg pushed before FUN_28C7E
 *   move.l  (SP)+, D2               ; restore D2
 *   rts
 *
 * Semantics: initialize the level-load globals before the subcall chain:
 *
 *   - workRam[0x394..0x395] = 0x0000           (BE word @ 0x400394)
 *   - workRam[0x662..0x663] = 0x0000           (BE word @ 0x400662)
 *   - workRam[0x664..0x665] = 0x0001           (BE word @ 0x400664)
 *   - workRam[0x474..0x477] = ROM[0x2BE00..3]  (BE long, level 1 pointer)
 *
 * The four sub-JSRs are injectable for parity tests and higher-level boot
 * wiring.
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Work RAM offset of the game-mode discriminator word (`0x400394`). */
const GAME_MODE_OFF = 0x394 as const;
/** Work RAM offset of the slapstic index word (`0x400662`). */
const SLAPSTIC_INDEX_OFF = 0x662 as const;
/** Work RAM offset of the counter/flag word (`0x400664`). */
const COUNTER_FLAG_OFF = 0x664 as const;
/** Work RAM offset of the destination level pointer long (`0x400474`). */
const LEVEL_PTR_DST_OFF = 0x474 as const;

/** Absolute ROM offset of the level pointer table. */
const LEVEL_POINTER_TABLE_ROM_OFF = 0x2be00 as const;

/**
 *   clearAlphaTiles → clearMoAlphaRam → fun16F6C → paletteInitLevel
 */
export interface InitLevelLoad1A236Subs {
  /** FUN_28C7E: clearAlphaTilesFromIndex(arg.w = 0). */
  clearAlphaTiles?: (state: GameState) => void;
  /** FUN_12174: clearMoAlphaRam (`clr.l` loop over 0xA00000..0xA01FFF). */
  clearMoAlphaRam?: (state: GameState) => void;
  fun16F6C?: (state: GameState, rom: RomImage) => void;
  paletteInitLevel?: (state: GameState, rom: RomImage) => void;
}

function writeWorkRamWord(state: GameState, off: number, word: number): void {
  state.workRam[off] = (word >>> 8) & 0xff;
  state.workRam[off + 1] = word & 0xff;
}

function readWorkRamWord(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

/** Sign-extend a M68k word to a signed long. */
function extWordToLong(w: number): number {
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) | 0 : w & 0xffff;
}

function readRomLong(rom: RomImage, off: number): number {
  return (
    (((rom.program[off] ?? 0) << 24) |
      ((rom.program[off + 1] ?? 0) << 16) |
      ((rom.program[off + 2] ?? 0) << 8) |
      (rom.program[off + 3] ?? 0)) >>> 0
  );
}

/**
 * Execute `FUN_0001A236`, the init-level-load helper.
 *
 *   - `state.workRam[0x394..0x395]`  (game-mode word = 0)
 *   - `state.workRam[0x662..0x663]`  (slapstic index = 0)
 *   - `state.workRam[0x664..0x665]`  (counter flag = 1)
 *   - `state.workRam[0x474..0x477]`  (level pointer long from ROM table)
 *
 * The post-clear game-mode word is read back before calculating the table
 * offset, matching the ROM sequence.
 *
 * @param state Game state mutated in-place.
 * @param rom ROM image used for the level pointer and subcalls.
 * @param subs Callback bag for the four sub-JSRs.
 */
export function initLevelLoad1A236(
  state: GameState,
  rom: RomImage,
  subs: InitLevelLoad1A236Subs = {},
): void {
  // 0x1A238: clr.w (0x400394).l
  writeWorkRamWord(state, GAME_MODE_OFF, 0);
  // 0x1A23E: clr.w (0x400662).l
  writeWorkRamWord(state, SLAPSTIC_INDEX_OFF, 0);
  // 0x1A244: move.w #0x1, (0x400664).l
  writeWorkRamWord(state, COUNTER_FLAG_OFF, 1);

  const d0w = readWorkRamWord(state, GAME_MODE_OFF);
  // 0x1A252: ext.l D0
  const d0Signed = extWordToLong(d0w);
  // 0x1A254..0x1A256: D2 = D0 << 2 (long shift)
  // M68k `asl.l #2` on a signed long multiplies by 4 with 32-bit wrapping.
  const d2Shifted = (d0Signed * 4) | 0;
  // 0x1A258: addi.l #0x2BE00, D2
  const tableEntryAbs = (d2Shifted + LEVEL_POINTER_TABLE_ROM_OFF) | 0;
  const tableEntryOff = tableEntryAbs >>> 0;

  // 0x1A260: move.l (A0), (0x00400474).l
  // Read long BE from ROM at tableEntryOff, write to workRam[0x474..0x477].
  const ptrLong = readRomLong(rom, tableEntryOff);
  state.workRam[LEVEL_PTR_DST_OFF] = (ptrLong >>> 24) & 0xff;
  state.workRam[LEVEL_PTR_DST_OFF + 1] = (ptrLong >>> 16) & 0xff;
  state.workRam[LEVEL_PTR_DST_OFF + 2] = (ptrLong >>> 8) & 0xff;
  state.workRam[LEVEL_PTR_DST_OFF + 3] = ptrLong & 0xff;

  // 0x1A266..0x1A268: clr.l -(SP); jsr 0x28C7E.l → clearAlphaTilesFromIndex(0)
  subs.clearAlphaTiles?.(state);
  // 0x1A26E: jsr 0x12174.l → clearMoAlphaRam
  subs.clearMoAlphaRam?.(state);
  // 0x1A274: jsr 0x16F6C.l → FUN_16F6C
  subs.fun16F6C?.(state, rom);
  // 0x1A27A: jsr 0x1A41E.l → paletteInitLevel
  subs.paletteInitLevel?.(state, rom);
  // 0x1A280: addq.l #4, SP — cleanup arg
  // 0x1A282: move.l (SP)+, D2 — restore
  // 0x1A284: rts
}


export const INIT_LEVEL_LOAD_1A236_ADDR = 0x0001a236 as const;

export const INIT_LEVEL_LOAD_1A236_SUB_ADDRS = [
  0x00028c7e, // clearAlphaTilesFromIndex(0)
  0x00012174, // clearMoAlphaRam
  0x00016f6c, // FUN_16F6C
  0x0001a41e, // paletteInitLevel
] as const;

export const INIT_LEVEL_LOAD_1A236_GAME_MODE_ADDR = 0x00400394 as const;
export const INIT_LEVEL_LOAD_1A236_SLAPSTIC_INDEX_ADDR = 0x00400662 as const;
export const INIT_LEVEL_LOAD_1A236_COUNTER_FLAG_ADDR = 0x00400664 as const;
export const INIT_LEVEL_LOAD_1A236_LEVEL_PTR_DST_ADDR = 0x00400474 as const;
export const INIT_LEVEL_LOAD_1A236_POINTER_TABLE_ROM_ADDR =
  LEVEL_POINTER_TABLE_ROM_OFF;
