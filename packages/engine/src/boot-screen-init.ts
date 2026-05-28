/**
 * Replica of `FUN_0000222E`, the boot-screen initialization helper.
 *
 * It clears the visible RAM through `FUN_00001C88`, initializes six low color
 * RAM priority-mask words, runs intro text setup, and on cold boot dispatches
 * two ROM vector slots at `0x10048` and `0x1004E`.
 *
 * **Disasm 0x222E..0x22A3** (118 byte, 0 args, 0 ret):
 *
 *   jsr     0x1C88.l                  ; clearScreen (alpha+MO+0x860000+0xB00400)
 *   clr.w   ($B00000).l               ; MO/palette priority reg 0
 *   move.w  #0x1FFF, ($B00002).l      ; reg 1 — 13-bit priority mask
 *   move.w  #0x7FFF, ($B00004).l      ; reg 2 — 15-bit priority mask
 *   move.w  #-0x4001, ($B00006).l     ; reg 3 = 0xBFFF
 *   clr.w   ($B00008).l               ; reg 4
 *   clr.w   ($B0000A).l               ; reg 5
 *   jsr     0x22A4.l                  ; introSetup (text/string render)
 *   tst.w   ($400016).l               ; frame counter low (cold boot if 0)
 *   bne.b   end                       ; warm boot -> return
 *   jsr     0x3A9C.l                  ; coldBootInit (RAM globals + scroll)
 *   movea.l #0x10048, A0
 *   cmpi.w  #0x4EF9, (A0)             ; "JMP.L" opcode in ROM slot 1?
 *   bne.b   slot1_fallback
 *     jsr   (A0)                      ; ROM at 0x10048 = JMP.L target
 *     bra.b slot2
 *   slot1_fallback:
 *     clr.l -(SP); jsr 0x5E00.l; addq.l #4,SP   ; FUN_5E00(0)
 *   slot2:
 *   movea.l #0x1004E, A0
 *   cmpi.w  #0x4EF9, (A0)
 *   bne.b   slot2_fallback
 *     jsr   (A0)                      ; ROM at 0x1004E = JMP.L target
 *     bra.b end
 *   slot2_fallback:
 *     jsr   0x5DEC.l
 *   end: rts
 *
 * **Vector slot convention**: Atari System II exposes two ROM patch points for
 * game-specific cold-boot logic. If the slot starts with `0x4EF9`
 * (`JMP.L abs.l`), the game ROM supplies the target; otherwise the core
 * fallback routines run.
 *
 *   colorRam[0x00..0x01] = 0x0000     (BE word @ 0xB00000)
 *   colorRam[0x02..0x03] = 0x1FFF     (BE word @ 0xB00002)
 *   colorRam[0x04..0x05] = 0x7FFF     (BE word @ 0xB00004)
 *   colorRam[0x06..0x07] = 0xBFFF     (BE word @ 0xB00006, = -0x4001 unsigned)
 *   colorRam[0x08..0x09] = 0x0000     (BE word @ 0xB00008)
 *   colorRam[0x0A..0x0B] = 0x0000     (BE word @ 0xB0000A)
 *
 * `cli/src/test-boot-screen-init-parity.ts` (500/500 cases).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** Work RAM offset of the frame-counter low word at absolute `0x400016`. */
const FRAME_COUNTER_OFF = 0x16 as const;

/** ROM offsets for the two cold-boot vector slots. */
const VECTOR_SLOT_1 = 0x10048 as const;
const VECTOR_SLOT_2 = 0x1004e as const;

/** 68000 opcode for `JMP.L abs.l`, first big-endian word. */
const OPCODE_JMP_L = 0x4ef9 as const;

/**
 *   clearScreen -> introSetup -> coldBootInit on cold boot
 *                                 -> dispatchSlot1 (hook or fallback)
 *                                 -> dispatchSlot2 (hook or fallback)
 */
export interface BootScreenInitSubs {
  /** FUN_1C88: clear MO/alpha RAM, MMIO $860000, palette $B00400. */
  clearScreen?: (state: GameState) => void;
  /** FUN_22A4: text rendering screen (game over / coin / press start). */
  introSetup?: (state: GameState) => void;
  /** FUN_3A9C: cold-boot RAM globals and scroll init; only when frame == 0. */
  coldBootInit?: (state: GameState) => void;
  dispatchSlot1Hook?: (state: GameState) => void;
  slot1Fallback?: (state: GameState) => void;
  dispatchSlot2Hook?: (state: GameState) => void;
  slot2Fallback?: (state: GameState) => void;
}

function writePaletteWord(state: GameState, off: number, word: number): void {
  state.colorRam[off] = (word >>> 8) & 0xff;
  state.colorRam[off + 1] = word & 0xff;
}

function readRomWord(rom: RomImage, off: number): number {
  return (
    (((rom.program[off] ?? 0) << 8) | (rom.program[off + 1] ?? 0)) & 0xffff
  );
}

/**
 * Replica of `FUN_0000222E`.
 *
 *   - `state.colorRam[0..0xB]` (six priority-register words).
 *
 * @param state GameState, mutated in place.
 * @param subs  Callback bag for subroutine injection. Defaults are no-op.
 */
export function bootScreenInit(
  state: GameState,
  rom: RomImage,
  subs: BootScreenInitSubs = {},
): void {
  // 0x222E: jsr 0x1C88, clear screen.
  subs.clearScreen?.(state);

  // 0x2234..0x225C: 6 register init writes a $B00000..$B0000A.
  writePaletteWord(state, 0x00, 0x0000);
  writePaletteWord(state, 0x02, 0x1fff);
  writePaletteWord(state, 0x04, 0x7fff);
  writePaletteWord(state, 0x06, 0xbfff); // = -0x4001 unsigned word
  writePaletteWord(state, 0x08, 0x0000);
  writePaletteWord(state, 0x0a, 0x0000);

  // 0x225E: jsr 0x22A4, intro setup.
  subs.introSetup?.(state);

  // 0x2264: tst.w *0x400016. Non-zero means warm boot and returns early.
  const fc = state.workRam[FRAME_COUNTER_OFF] ?? 0;
  const fc1 = state.workRam[FRAME_COUNTER_OFF + 1] ?? 0;
  if (((fc << 8) | fc1) !== 0) {
    return;
  }

  // 0x226C: jsr 0x3A9C, cold-boot init.
  subs.coldBootInit?.(state);

  // 0x2272..0x228B: vector slot 1 dispatch.
  if (readRomWord(rom, VECTOR_SLOT_1) === OPCODE_JMP_L) {
    subs.dispatchSlot1Hook?.(state);
  } else {
    subs.slot1Fallback?.(state);
  }

  // 0x228C..0x22A1: vector slot 2 dispatch.
  if (readRomWord(rom, VECTOR_SLOT_2) === OPCODE_JMP_L) {
    subs.dispatchSlot2Hook?.(state);
  } else {
    subs.slot2Fallback?.(state);
  }
}

// Constants exported for tests.
export const BOOT_SCREEN_FRAME_COUNTER_OFF = FRAME_COUNTER_OFF;
export const BOOT_SCREEN_VECTOR_SLOT_1 = VECTOR_SLOT_1;
export const BOOT_SCREEN_VECTOR_SLOT_2 = VECTOR_SLOT_2;
export const BOOT_SCREEN_MAGIC_JMP_L = OPCODE_JMP_L;
