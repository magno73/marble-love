/**
 * scene-init-11428.ts — replica `FUN_00011428` (42 byte, 6 jsr + clr.l/addq.l/rts).
 *
 * `FUN_00011452` (@0x114D4 and @0x1156E) as a scene reset/refresh step.
 *
 * **Disasm 0x11428..0x11450** (42 byte, 0 args, 0 ret):
 *
 *   jsr     0x28DEA.l            ; vblankAck (clear MMIO ack + advance frameLo)
 *   jsr     0x121A6.l            ; clearPaletteRam (0xB00000..0xB007FF, 0x800B)
 *   jsr     0x12174.l            ; clearMoAlphaRam (0xA00000..0xA01FFF, 0x2000B)
 *   jsr     0x28580.l            ; initFnPointers (4 long ptr in workRam +0x412)
 *   clr.l   -(SP)                ; push arg long = 0
 *   jsr     0x28CA6.l            ; sceneObjInit (no stack arg, ignores 4 bytes)
 *   addq.l  #4,SP                ; cleanup arg
 *   rts
 *
 *
 *   - The TS caller can provide six callbacks (default no-op) mirroring the ROM
 *     entry points. Parity tests patch each binary entry point with a sentinel
 *     increment and count hits.
 *
 * Parity sentinels live in work RAM 0x4003E0..0x4003E5; TS callbacks increment
 * the corresponding sentinel.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { sceneObjInit28CA6Default } from "./scene-obj-init-28ca6.js";

/**
 */
export interface SceneInit11428Subs {
  /** FUN_28DEA: ack vblank; clear (0x400016).b, busy-wait, ++(0x4003F0).b. */
  vblankAck?: (state: GameState) => void;
  /** FUN_121A6: clr.l loop over 0xB00000..0xB007FF (palette RAM, 2 KiB to 0). */
  clearPaletteRam?: (state: GameState) => void;
  /** FUN_12174: clr.l loop over 0xA00000..0xA01FFF (MO+alpha RAM, 8 KiB to 0). */
  clearMoAlphaRam?: (state: GameState) => void;
  /** FUN_28580: init four function-pointer fields at workRam +0x412/+0x41E/+0x42A/+0x436. */
  initFnPointers?: (state: GameState) => void;
  fillLoop?: (state: GameState) => void;
  /** FUN_28CA6: scene object init (32 slots @ 0x4001DC) + 2x FUN_26F3E + FUN_28DEA. */
  sceneObjInit?: (state: GameState) => void;
}

/**
 * Replica `FUN_00011428` — scene-init orchestrator.
 *
 *
 * @param state GameState passed to callbacks and mutated by subroutines.
 * @param subs  Callback bag for the six sub-jsr calls; defaults to no-op.
 */
export function sceneInit11428(
  state: GameState,
  subs: SceneInit11428Subs = {},
  rom?: RomImage,
): void {
  // 0x11428: jsr 0x28DEA — vblank ack.
  subs.vblankAck?.(state);
  // 0x1142E: jsr 0x121A6 — clear palette RAM.
  subs.clearPaletteRam?.(state);
  // 0x11434: jsr 0x12174 — clear MO + alpha RAM.
  subs.clearMoAlphaRam?.(state);
  // 0x1143A: jsr 0x28580 — init function pointers in workRam.
  subs.initFnPointers?.(state);
  // 0x11440: clr.l -(SP) — push arg = 0 long.
  subs.fillLoop?.(state);
  // 0x11448: jsr 0x28CA6 — scene object init (no stack arg).
  (subs.sceneObjInit ?? ((s) => { if (rom !== undefined) sceneObjInit28CA6Default(s, rom); }))(state);
  // 0x1144E: addq.l #4,SP — cleanup push.
  // 0x11450: rts.
}


export const SCENE_INIT_11428_ADDR = 0x00011428 as const;

export const SCENE_INIT_11428_SUB_ADDRS = [
  0x00028dea, // vblankAck
  0x000121a6, // clearPaletteRam
  0x00012174, // clearMoAlphaRam
  0x00028580, // initFnPointers
  0x00028c7e, // fillLoop (arg = 0)
  0x00028ca6, // sceneObjInit
] as const;
