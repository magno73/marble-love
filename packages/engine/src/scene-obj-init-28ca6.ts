/**
 * scene-obj-init-28ca6.ts — replica `FUN_00028CA6`.
 *
 * The routine initializes the scene object rect-list backing storage:
 * 31 rect-slot first bytes are cleared at `0x4001DC + n*0x0E`, `FUN_1B12A`
 * is called once per slot with the slot pointer, and the byte index list at
 * `0x4003BC` is filled with 31 `0xFF` sentinel bytes. It then advances the
 * frame byte twice around two `FUN_26F3E` calls, sets the scene-ready flag
 * at `0x40039A`, calls `FUN_28DEA`, and returns.
 *
 * Internal JSRs are sub-injections because `FUN_1B12A`, `FUN_26F3E`, and the
 * primitive `FUN_28DEA` do not have an exportable implementation on main yet.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";

const WORK_RAM_BASE = 0x00400000;

export const SCENE_OBJ_INIT_28CA6_ADDR = 0x00028ca6 as const;
export const SCENE_OBJ_SLOT_BASE = 0x004001dc as const;
export const SCENE_OBJ_SLOT_STRIDE = 0x0e as const;
export const SCENE_OBJ_SLOT_COUNT = 31 as const;
export const SCENE_OBJ_INDEX_BASE = 0x004003bc as const;
export const SCENE_OBJ_READY_FLAG = 0x0040039a as const;
export const SCENE_OBJ_FRAME_BYTE = 0x004003f0 as const;

export interface SceneObjInit28CA6Subs {
  /** FUN_1B12A: rect-builder called with the absolute slot pointer. */
  fun_1b12a?: (state: GameState, slotAbs: number) => void;
  /** FUN_26F3E: late game logic, called twice. */
  fun_26f3e?: (state: GameState) => void;
  /** FUN_28DEA: vblank ack primitive, called after setting ready flag. */
  fun_28dea?: (state: GameState) => void;
}

function off(abs: number): number {
  return (abs - WORK_RAM_BASE) >>> 0;
}

function readByte(state: GameState, abs: number): number {
  return state.workRam[off(abs)] ?? 0;
}

function writeByte(state: GameState, abs: number, value: number): void {
  state.workRam[off(abs)] = value & 0xff;
}

function incByte(state: GameState, abs: number): void {
  writeByte(state, abs, readByte(state, abs) + 1);
}

export function sceneObjInit28CA6(
  state: GameState,
  rom: RomImage,
  subs: SceneObjInit28CA6Subs = {},
): void {
  void rom;

  let slotAbs = SCENE_OBJ_SLOT_BASE;
  let indexAbs = SCENE_OBJ_INDEX_BASE;

  for (let d2 = 0; d2 !== SCENE_OBJ_SLOT_COUNT; d2++) {
    const currentSlot = slotAbs;
    writeByte(state, currentSlot, 0);
    slotAbs = (slotAbs + SCENE_OBJ_SLOT_STRIDE) >>> 0;
    subs.fun_1b12a?.(state, currentSlot);
    writeByte(state, indexAbs, 0xff);
    indexAbs = (indexAbs + 1) >>> 0;
  }

  incByte(state, SCENE_OBJ_FRAME_BYTE);
  subs.fun_26f3e?.(state);
  incByte(state, SCENE_OBJ_FRAME_BYTE);
  subs.fun_26f3e?.(state);
  writeByte(state, SCENE_OBJ_READY_FLAG, 1);
  subs.fun_28dea?.(state);
}

export { sceneObjInit28CA6 as FUN_00028CA6 };
