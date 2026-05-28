/**
 * render-string-entry-28fa0.ts — replica `FUN_00028FA0` (62 byte).
 *
 * `FUN_3520`) with `(entryPtr, arg3Long)`.
 *
 * Same shape as `FUN_28FDE` (see `render-string-entry-28fde.ts`), but:
 *   - entry @ `0x40041C` (workRam off `0x41C`), not `0x400434`.
 *   - 3 long args instead of 2: arg1/arg2 -> byte writes, arg3 -> second jsr.
 *   - second jsr passes `arg3Long` instead of constant `0x3400`.
 *   - second jsr targets `0x200.l` -> `FUN_3520` instead of `FUN_2572`.
 *
 * **Entry layout @ `0x40041C`** (work RAM offset `0x41C`, same structure as the
 * string-chain entry defined in `string-render.ts`):
 *
 *   +1  byte  : tick offset
 *   +8  long  : pointer to the next entry (not modified here)
 *
 * **Disasm 0x28FA0..0x28FDE** (62 byte):
 *
 *   move.l D2,-(SP)            ; save D2 (callee-save)
 *   move.w (0xa,SP),D1w        ; D1.w = arg1 low word (long arg @ SP+8 -> low word @ SP+0xA)
 *   move.w (0xe,SP),D0w        ; D0.w = arg2 low word (long arg @ SP+0xC -> +0xE)
 *   move.w (0x12,SP),D2w       ; D2.w = arg3 low word (long arg @ SP+0x10 -> +0x12)
 *   ext.l  D0                  ; sign-extend arg2.w -> arg2.l
 *   move.l D0,-(SP)            ; push arg2_ext.l
 *   move.w D1w,D0w
 *   ext.l  D0                  ; sign-extend arg1.w -> arg1.l
 *   move.l D0,-(SP)            ; push arg1_ext.l
 *   pea    (0x40041C).l        ; push entry pointer
 *   jsr    0x0000013c.l        ; FUN_255A: byte writes (col, tickOff, clr marker)
 *     ; FUN_255A:
 *     ;   movea.l (0x4,SP),A0  ; A0 = 0x40041C
 *     ;   move.b  (0xb,SP),D1b ; D1.b = arg1_ext_l & 0xff = arg1Long & 0xff
 *     ;   move.b  (0xf,SP),D0b ; D0.b = arg2_ext_l & 0xff = arg2Long & 0xff
 *     ;   move.b  D1b,(A0)     ; entry[0] = col
 *     ;   move.b  D0b,(0x1,A0) ; entry[1] = tickOff
 *     ;   clr.b   (0x6,A0)     ; entry[6] = 0
 *     ;   rts
 *   move.w D2w,D0w
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push arg3_ext.l
 *   pea    (0x40041C).l        ; push entry pointer
 *   jsr    0x00000200.l        ; FUN_3520 (render variant)
 *   move.l (SP)+,D2            ; restore D2
 *   rts
 *
 * **Stack notes**:
 *   - The second `jsr 0x200` adds `pea 0x40041C; pea arg3`, 8 bytes total.
 *
 * **Args**:
 *   - `arg1Long`: long pushed by the caller; only `arg1Long & 0xff` lands in
 *     `entry[0]` (col). Binary path: word -> ext.l -> push long -> byte read at
 *     SP+0xb extracts the low byte. ext.l preserves the low byte.
 *   - `arg2Long`: same path -> `entry[1]` (tickOff).
 *   - `arg3Long`: propagated to the stub after low-word sign extension, matching
 *     the "long argument with effective low word" convention used elsewhere.
 *
 *   1. `state.workRam[0x41C] = arg1Long & 0xff`   (col)
 *   2. `state.workRam[0x41D] = arg2Long & 0xff`   (tickOff)
 *   3. `state.workRam[0x422] = 0`                 (marker)
 *   4. Calls `subs.renderStringChain2(state, 0x40041C, arg3LongExtL)` via stub.
 *
 * The external call is exposed through `RenderStringEntry28FA0Subs.renderStringChain2`
 * and defaults to no-op. Smoke tests leave it as no-op; parity tests patch the
 * binary subroutine.
 *
 *   - FUN_28FDE: 2 args, entry @ 0x434, second jsr to FUN_2572 with const 0x3400.
 *   - FUN_28FA0: 3 args, entry @ 0x41C, second jsr to FUN_3520 with arg3.
 */

import type { GameState } from "./state.js";

const ENTRY_ABS_ADDR = 0x0040041c as const;

/** Offset entry in `state.workRam` (= ENTRY_ABS_ADDR - 0x400000). */
export const ENTRY_OFF = 0x41c as const;

export const COL_BYTE_OFF = 0 as const;
export const TICKOFF_BYTE_OFF = 1 as const;
export const MARKER_BYTE_OFF = 6 as const;

export const RENDER_STRUCT_ADDR = ENTRY_ABS_ADDR;

/**
 * Sign-extend a signed 16-bit word into a signed 32-bit long.
 *
 * Equivalent to `(value << 16) >> 16`, with explicit unsigned normalization.
 *
 */
function extLowWordToLong(value: number): number {
  const w = value & 0xffff;
  // Sign-extend bit 15.
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) >>> 0 : w >>> 0;
}

/**
 */
export interface RenderStringEntry28FA0Subs {
  /**
   * `FUN_3520` - render string chain variant 2. Default no-op.
   *
   *
   */
  renderStringChain2?: (structAddr: number, arg3LongExtL: number) => void;
}

/**
 *
 * marker=0), then calls `renderStringChain2(0x40041C, arg3LongExtL)` via stub.
 *
 * @param state     GameState; mutates `workRam[0x41C]`, `[0x41D]`, `[0x422]`.
 * @param arg3Long  long arg3 from the caller stack; low word is sign-extended
 *                  into the second `renderStringChain2` argument.
 * @param subs      stub injection for `renderStringChain2` (default no-op).
 *
 * **Side effects** in `state.workRam`:
 *   - `[ENTRY_OFF + 0]   = arg1Long & 0xff`   (col byte)
 *   - `[ENTRY_OFF + 1]   = arg2Long & 0xff`   (tickOff byte)
 *   - `[ENTRY_OFF + 6]   = 0`                 (marker clear)
 *     the three byte writes.
 *
 * FUN_3520's return value is ignored by caller `FUN_28EB2`; the TS signature
 * therefore returns void.
 */
export function renderStringEntry28FA0(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  subs?: RenderStringEntry28FA0Subs,
): void {
  const r = state.workRam;

  // FUN_255A inline: three deterministic byte writes on entry @ 0x40041C.
  // - `move.b D1b,(A0)`     : entry[0] = LSB of arg1 ext_l = arg1Long & 0xff
  // - `move.b D0b,(0x1,A0)` : entry[1] = LSB of arg2 ext_l = arg2Long & 0xff
  // - `clr.b  (0x6,A0)`     : entry[6] = 0
  r[ENTRY_OFF + COL_BYTE_OFF] = arg1Long & 0xff;
  r[ENTRY_OFF + TICKOFF_BYTE_OFF] = arg2Long & 0xff;
  r[ENTRY_OFF + MARKER_BYTE_OFF] = 0;

  // Args: (structAddr=0x40041C, arg3LongExtL=ext.l(arg3Long & 0xffff)).
  const arg3ExtL = extLowWordToLong(arg3Long);
  subs?.renderStringChain2?.(RENDER_STRUCT_ADDR, arg3ExtL);
}
