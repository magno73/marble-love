/**
 * state-sub-1953e.ts - port of `FUN_0001953E` (48 bytes).
 *
 * Common finalizer for `FUN_194BA` case 0/1 entity dispatch. It selects the
 * animation/script pointer in `entity+0x1C` from the entity subtype byte
 * `entity+0x25`.
 *
 * Verified by binary probes:
 *   - subtype 7 -> 0x00021F72
 *   - subtype 8 -> 0x0002194E
 *   - subtype 9 -> 0x00021F06
 *   - all other subtype values leave `entity+0x1C` unchanged
 */

import type { GameState } from "./state.js";

export const ENTITY_SUBTYPE_OFFSET = 0x25 as const;
export const ENTITY_SCRIPT_PTR_OFFSET = 0x1c as const;

export const SCRIPT_PTR_SUBTYPE_7 = 0x00021f72 as const;
export const SCRIPT_PTR_SUBTYPE_8 = 0x0002194e as const;
export const SCRIPT_PTR_SUBTYPE_9 = 0x00021f06 as const;

function writeU32BE(state: GameState, off: number, value: number): void {
  const v = value >>> 0;
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

/**
 * Bit-exact port of `FUN_0001953E`.
 *
 * @param state       GameState.
 * @param entityAddr  Absolute M68k address of the entity struct.
 * @returns Written pointer, or `null` when the subtype leaves the field unchanged.
 */
export function stateSub1953E(
  state: GameState,
  entityAddr: number,
): number | null {
  const off = (entityAddr - 0x400000) >>> 0;
  const subtype = (state.workRam[off + ENTITY_SUBTYPE_OFFSET] ?? 0) & 0xff;

  let ptr: number | null = null;
  if (subtype === 0x07) {
    ptr = SCRIPT_PTR_SUBTYPE_7;
  } else if (subtype === 0x08) {
    ptr = SCRIPT_PTR_SUBTYPE_8;
  } else if (subtype === 0x09) {
    ptr = SCRIPT_PTR_SUBTYPE_9;
  }

  if (ptr !== null) {
    writeU32BE(state, off + ENTITY_SCRIPT_PTR_OFFSET, ptr);
  }
  return ptr;
}

export const STATE_SUB_1953E_ADDR = 0x0001953e as const;
