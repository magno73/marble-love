/**
 * Port of ROM routine `FUN_00028624`.
 *
 * Iterates object slots `0..*0x400396`, checks the corresponding bit in the
 * dirty bitmap byte at `0x40039C`, and calls `FUN_00028E3C` for each set bit
 * with six long arguments derived from the object and a ROM table at `0x23D3A`.
 * The dirty bitmap is cleared unconditionally in the epilogue.
 *
 * Known callers:
 *   - `FUN_00010504` @ 0x000106E2
 *   - `FUN_00010FCE` @ 0x00011016
 */

import type { GameState } from "./state.js";

// ─── Address constants (workRam offsets) ────────────────────────────────

/** Object-struct base byte (absolute 0x400018), matching game-tick timers. */
export const OBJECTS_BASE_OFF = 0x18 as const;
/** Byte stride between adjacent object structs (= OBJECT_STRIDE). */
export const OBJECT_STRIDE = 0xe2 as const;
/** Active object count word (absolute 0x400396). */
export const OBJECT_COUNT_OFF = 0x396 as const;
/** Dirty-slot bitmap byte (absolute 0x40039C). */
export const DIRTY_BITMAP_OFF = 0x39c as const;
/** Object-struct offset for the long passed as arg1. */
export const OBJ_ARG1_OFF = 0xbc as const;
export const ROM_TABLE_ADDR = 0x00023d3a as const;
export const FUN_28624_ADDR = 0x00028624 as const;

// ─── Sub injection ──────────────────────────────────────────────────────

/** Arguments passed to `FUN_00028E3C` for each dirty object slot. */
export type RenderStringHelperFn = (
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  arg4Long: number,
  arg5Long: number,
  arg6Long: number,
) => void;

export interface ObjDirtyDispatch28624Subs {
  /** `FUN_00028E3C` — render-string helper. Default: no-op. */
  renderStringHelper?: RenderStringHelperFn;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function readObjectCount(state: GameState): number {
  const r = state.workRam;
  return (((r[OBJECT_COUNT_OFF] ?? 0) << 8) | (r[OBJECT_COUNT_OFF + 1] ?? 0)) &
    0xffff;
}

function readWorkLongBE(state: GameState, off: number): number {
  const r = state.workRam;
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

/**
 * ROM table @ 0x23D3A: byte values indexed by D2 and sign-extended to long.
 *
 * Tests can pass a short zero-filled table when the renderStringHelper callback
 * does not depend on the real ROM bytes.
 */
export type Rom23D3ATable = Uint8Array | readonly number[];


/**
 * Runs the dirty-slot dispatch loop.
 *
 * Iterates D2 = 0..count-1, where count is the word at 0x400396. For each set
 * dirty bit, it calls `subs.renderStringHelper`; at the end it clears the
 * bitmap byte at 0x40039C.
 *
 * M68K `asl.l` masks register shift counts to 6 bits. This implementation
 * mirrors the useful 32-bit behavior with `(1 << (D2 & 31)) >>> 0`.
 *
 * @param state   GameState; work RAM is mutated.
 * @param romTab  ROM byte table for indices 0..count-1.
 * @param subs    Callback bag. Default: no-op.
 */
export function objDirtyDispatch28624(
  state: GameState,
  romTab: Rom23D3ATable,
  subs: ObjDirtyDispatch28624Subs = {},
): void {
  const r = state.workRam;
  const count = readObjectCount(state);
  const bitmap = r[DIRTY_BITMAP_OFF] ?? 0;
  // The 8-bit bitmap contains all bits the ROM can observe here.
  const bitmap32 = ((bitmap & 0x80) !== 0
    ? bitmap | 0xffffff00
    : bitmap) >>> 0;

  // Loop D2 = 0..count-1.
  for (let d2 = 0; d2 < count; d2++) {
    // mask = 1 << (d2 & 31), zero-extended to 32 bits (= asl.l).
    const mask = ((1 << (d2 & 31)) >>> 0) & 0xffffffff;
    const hit = (mask & bitmap32) >>> 0;
    if (hit !== 0) {
      // arg6 = (D2 == 0) ? 0x2000 : 0x2400.
      const arg6 = d2 === 0 ? 0x2000 : 0x2400;
      // arg3 = sext_l(byte ROM[0x23D3A + D2]).
      const tabByte =
        romTab instanceof Uint8Array
          ? (romTab[d2] ?? 0)
          : (romTab[d2] ?? 0) & 0xff;
      const arg3 = (tabByte & 0x80 ? tabByte | 0xffffff00 : tabByte) | 0;
      // arg1 = *(A2 + 0xBC) long BE. A2 = 0x400018 + d2 * 0xE2.
      const objOff = OBJECTS_BASE_OFF + d2 * OBJECT_STRIDE;
      const arg1 = readWorkLongBE(state, objOff + OBJ_ARG1_OFF);

      subs.renderStringHelper?.(state, arg1, 2, arg3, 2, 7, arg6);
    }
  }

  // Epilogue: clr.b *0x40039C, unconditional.
  r[DIRTY_BITMAP_OFF] = 0;
}

/**
 * Re-export the symbol as "FUN_00028624" for explicit ROM mapping.
 */
export { objDirtyDispatch28624 as FUN_00028624 };
