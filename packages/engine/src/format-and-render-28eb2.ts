/**
 * Replica of `FUN_00028EB2`, a six-argument "format and render" wrapper.
 *
 * The ROM routine formats a value into the scratch string buffer ending at
 * `*(0x40041E)`, optionally trims one trailing space when `arg2.w == 2`, then
 * dispatches to `FUN_00028FA0` to render the string into alpha RAM. Its three
 * sub-calls are injectable so parity tests can verify call order and arguments
 * independently from the leaf routines.
 *
 * Stack contract after the ROM prologue:
 *   - arg1: value passed to `FUN_00003874`.
 *   - arg2.w: formatter width and trim selector.
 *   - arg3.w: render column byte.
 *   - arg4.w: render tick/offset byte.
 *   - arg5.w: formatter fill/max length.
 *   - arg6.w: third render argument.
 *
 * Verified by `packages/cli/src/test-format-and-render-28eb2-parity.ts`.
 */

import type { GameState } from "./state.js";

// Address constants.

export const BUFEND_PTR_ADDR = 0x0040041e as const;
/** Offset of `BUFEND_PTR_ADDR` inside `state.workRam`. */
export const BUFEND_PTR_OFF = 0x41e as const;

/** Hardcoded byte 'd' passed as the decimal format mode to `FUN_00003874`. */
export const FMT_MODE_D = 0x64 as const;

export const TRIM_SELECTOR = 2 as const;

export const FUN_28EB2_ADDR = 0x00028eb2 as const;

export const FUN_28EB2_SUB_ADDRS = [
  0x00003874, // FUN_3874 via trampoline 0x112: number formatter.
  0x00028f28, // FUN_28F28: trimTrailingSpace when arg2.w == 2.
  0x00028fa0, // FUN_28FA0: renderStringEntry28FA0.
] as const;

// Helpers.

/**
 * Sign-extends the low word exactly like `move.w ...; ext.l` on 68000.
 */
function extLowWordToLong(value: number): number {
  const w = value & 0xffff;
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) >>> 0 : w >>> 0;
}

/**
 * Reads a big-endian long from `state.workRam[off..off+3]`.
 */
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

// Sub-call injection.

/** Injectable sub-calls orchestrated by `FUN_00028EB2`. */
export interface FormatAndRender28EB2Subs {
  /**
   * `FUN_00003874` (via trampoline `0x112`) — number formatter.
   *
   *   - `value`     : arg1Long (full long).
   *   - `bufEnd`    : `*(0x40041E)` long big-endian (output buffer end ptr).
   *   - `fmtMode`   : 0x64 long (= 'd' byte). Hardcoded.
   *                   `FUN_00003874`; same low word as the trim selector.
   *
   * Default: no-op.
   */
  numberFormatter?: (
    state: GameState,
    value: number,
    bufEnd: number,
    fmtMode: number,
    width: number,
    fillExtra: number,
  ) => void;

  /** `FUN_00028F28`, the optional trailing-space trimmer. */
  trimTrailingSpace?: (
    state: GameState,
    strPtr: number,
    maxLen: number,
  ) => void;

  /** `FUN_00028FA0`, called with sign-extended arg3, arg4, and arg6 words. */
  renderStringEntry?: (
    state: GameState,
    arg1Long: number,
    arg2Long: number,
    arg3Long: number,
  ) => void;
}


/**
 * Orchestrates the three ROM sub-calls while preserving the original argument
 * sign-extension rules.
 */
export function formatAndRender28EB2(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  arg4Long: number,
  arg5Long: number,
  arg6Long: number,
  subs: FormatAndRender28EB2Subs = {},
): void {
  // Prologue callee-save of D2/D3 is a TypeScript no-op.

  // Read `*(0x40041E)` as the buffer-end pointer used by the formatter/trimmer.
  const bufEnd = readWorkLongBE(state, BUFEND_PTR_OFF);

  // Push order RTL: arg1, *0x40041E, 0x64, ext_l(arg2.w), ext_l(arg5.w).
  // The last two values are low-word sign extensions from the ROM sequence.
  const widthExtL = extLowWordToLong(arg2Long);
  const fillExtraExtL = extLowWordToLong(arg5Long);

  subs.numberFormatter?.(
    state,
    arg1Long >>> 0,
    bufEnd >>> 0,
    FMT_MODE_D,
    widthExtL,
    fillExtraExtL,
  );

  // Step 2: optional `FUN_00028F28` trailing-space trim.
  if ((arg2Long & 0xffff) === TRIM_SELECTOR) {
    // Args: (*(0x40041E), ext_l(arg5.w)).
    subs.trimTrailingSpace?.(state, bufEnd >>> 0, fillExtraExtL);
  }

  // Push order is RTL: ext_l(arg6.w), ext_l(arg4.w), ext_l(arg3.w).
  const colExtL = extLowWordToLong(arg3Long);
  const tickOffExtL = extLowWordToLong(arg4Long);
  const renderArgExtL = extLowWordToLong(arg6Long);

  subs.renderStringEntry?.(state, colExtL, tickOffExtL, renderArgExtL);

  // Epilogue stack cleanup and D2/D3 restore are TypeScript no-ops.
}

/**
 * Re-export the symbol under the ROM routine name for explicit mapping.
 */
export { formatAndRender28EB2 as FUN_00028EB2 };
