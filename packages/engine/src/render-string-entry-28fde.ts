/**
 * render-string-entry-28fde.ts — replica `FUN_00028FDE` (52 byte).
 *
 *
 * **Entry layout @ `0x400434`** (work RAM offset `0x434`; see `string-render.ts`):
 *
 *   +1  byte  : tick offset
 *   +8  long  : pointer to the next entry (not modified here)
 *
 * **Disasm 0x28FDE..0x29010** (52 byte):
 *
 *   move.w (0x6,SP),D1w        ; D1.w = arg1 low word
 *   move.w (0xa,SP),D0w        ; D0.w = arg2 low word
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push arg2 ext_l
 *   move.w D1w,D0w
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push arg1 ext_l
 *   pea    (0x400434).l        ; push entry pointer
 *   jsr    0x13C.l             ; FUN_255A: byte writes (with the, tickOff, clr marker)
 *     ; FUN_255A:
 *     ;   movea.l (0x4,SP),A0  ; A0 = 0x400434
 *     ;   move.b  (0xb,SP),D1b ; D1.b = arg1 ext_l low byte = arg1.w & 0xff
 *     ;   move.b  (0xf,SP),D0b ; D0.b = arg2 ext_l low byte = arg2.w & 0xff
 *     ;   move.b  D1b,(A0)     ; entry[0] = with the
 *     ;   move.b  D0b,(0x1,A0) ; entry[1] = tickOff
 *     ;   clr.b   (0x6,A0)     ; entry[6] = 0
 *     ;   rts
 *   pea    (0x3400).w          ; push attr 0x3400 (long)
 *   pea    (0x400434).l        ; push entry pointer
 *   jsr    0x142.l             ; FUN_2572 (renderStringChain)
 *   lea    (0x14,SP),SP        ; pop 20 byte (5 long)
 *   rts
 *
 * **Stack notes** (between the two jsr calls):
 *   - `pea 0x3400; pea 0x400434` adds 8 bytes, leaving 20 total bytes before
 *     `jsr 0x142`.
 *
 * **Args**:
 *   - `arg1Long`: long pushed by the caller; only `arg1.w & 0xff` is used.
 *   - `arg2Long`: long pushed by the caller; only `arg2.w & 0xff` lands in
 *     `entry[1]` (tickOff).
 *   The byte read extracts the low byte, equivalent to `arg1Long & 0xff` when
 *   `arg1Long & 0xffff` is the effective word.
 *
 *   1. `state.workRam[0x434] = arg1Long & 0xff`   (with the)
 *   2. `state.workRam[0x435] = arg2Long & 0xff`   (tickOff)
 *   3. `state.workRam[0x43A] = 0`                 (marker)
 *   4. Calls `renderStringChain(state, rom, 0x400434, 0x3400)` via stub.
 *
 * The external sub-call is exposed through `RenderStringEntry28FDESubs.renderStringChain`
 * and defaults to no-op. Smoke tests leave it as no-op; parity tests patch the
 * binary subroutine.
 * entry @ 0x434/0x435/0x43A).
 */

import type { GameState } from "./state.js";

const ENTRY_ABS_ADDR = 0x00400434 as const;

/** Offset entry in `state.workRam` (= ENTRY_ABS_ADDR - 0x400000). */
export const ENTRY_OFF = 0x434 as const;

export const COL_BYTE_OFF = 0 as const;
export const TICKOFF_BYTE_OFF = 1 as const;
export const MARKER_BYTE_OFF = 6 as const;

export const RENDER_ATTR = 0x3400 as const;

export const RENDER_STRUCT_ADDR = ENTRY_ABS_ADDR;

/**
 */
export interface RenderStringEntry28FDESubs {
  /**
   * `FUN_2572` — render string chain. Default no-op.
   *
   * Production wiring should call `string-render.renderStringChain(state, rom, ...)`.
   */
  renderStringChain?: (structAddr: number, attrWord: number) => void;
}

/**
 *
 * marker=0), then calls `renderStringChain(0x400434, 0x3400)` via stub.
 *
 * @param state     GameState; mutates `workRam[0x434]`, `[0x435]`, `[0x43A]`.
 * @param subs      stub injection for `renderStringChain` (default no-op).
 *
 * **Side effects** in `state.workRam`:
 *   - `[ENTRY_OFF + 0]   = arg1Long & 0xff`   (with the byte)
 *   - `[ENTRY_OFF + 1]   = arg2Long & 0xff`   (tickOff byte)
 *   - `[ENTRY_OFF + 6]   = 0`                 (marker clear)
 *
 * It leaves D0 equal to `renderStringChain`'s return value (1), but the TS
 * signature returns void because callers ignore it.
 */
export function renderStringEntry28FDE(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  subs?: RenderStringEntry28FDESubs,
): void {
  const r = state.workRam;

  // FUN_255A inline: three deterministic byte writes on entry @ 0x400434.
  // - `move.b D1b,(A0)`     : entry[0] = LSB of arg1 ext_l = arg1Long & 0xff
  // - `move.b D0b,(0x1,A0)` : entry[1] = LSB of arg2 ext_l = arg2Long & 0xff
  // - `clr.b  (0x6,A0)`     : entry[6] = 0
  r[ENTRY_OFF + COL_BYTE_OFF] = arg1Long & 0xff;
  r[ENTRY_OFF + TICKOFF_BYTE_OFF] = arg2Long & 0xff;
  r[ENTRY_OFF + MARKER_BYTE_OFF] = 0;

  // Args: (structAddr=0x400434, attrWord=0x3400).
  subs?.renderStringChain?.(RENDER_STRUCT_ADDR, RENDER_ATTR);
}
