/**
 * render-string-entry-28f62.ts — replica `FUN_00028F62` (62 byte).
 *
 * Same fixed entry at `0x40041C`; note that FUN_28FDE uses a different entry.
 * The render attribute comes from the caller.
 *
 * **Entry layout @ `0x40041C`** (work RAM offset `0x41C`, same structure as
 * the `0x400434` entry):
 *
 *   +1  byte  : tick offset
 *   +8  long  : pointer to the next entry (not modified here)
 *
 * **Disasm 0x28F62..0x28FA0** (62 byte):
 *
 *   move.l D2,-(SP)            ; save D2 (scratch for arg3.w)
 *   move.w (0xa,SP),D1w        ; D1.w = arg1.low_word  (with the)
 *   move.w (0xe,SP),D0w        ; D0.w = arg2.low_word  (tickOff)
 *   move.w (0x12,SP),D2w       ; D2.w = arg3.low_word  (attr)
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push ext_l(arg2.w)
 *   move.w D1w,D0w
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push ext_l(arg1.w)
 *   pea    (0x40041C).l        ; push entry pointer
 *   jsr    0x13C.l             ; FUN_255A: byte writes (with the, tickOff, marker=0)
 *     ; See render-string-entry-28fde.ts for FUN_255A disassembly; this file
 *     ; inlines it as three deterministic byte writes.
 *   move.w D2w,D0w
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push ext_l(arg3.w)  ← attr dinamico
 *   pea    (0x40041C).l        ; push entry pointer
 *   jsr    0x142.l             ; FUN_2572 (renderStringChain)
 *   lea    (0x14,SP),SP        ; pop 20 byte (5 long)
 *   move.l (SP)+,D2            ; restore D2
 *   rts
 *
 * **Relevant differences vs FUN_28FDE**:
 *   - struct address: `0x40041C` (vs `0x400434`)
 *   - attr is dynamic instead of hard-coded to `0x3400`
 *
 * **Stack notes** (same pattern as FUN_28FDE):
 *   - FUN_255A does not pop its arguments.
 *   - The second `push arg3L + pea` adds 8 bytes, leaving 20 total bytes
 *     before `jsr 0x142`.
 *
 * **Args**:
 *   - `arg1Long`: low word -> ext.l -> push -> byte read from `(0xb,SP)` in FUN_255A
 *   - `arg3Long`: low word -> ext.l -> push as long -> `attr` argument
 *
 *   1. `state.workRam[0x41C] = arg1Long & 0xff`   (with the)
 *   2. `state.workRam[0x41D] = arg2Long & 0xff`   (tickOff)
 *   3. `state.workRam[0x422] = 0`                 (marker)
 *   4. Calls `renderStringChain(0x40041C, arg3Long & 0xffff)` via stub.
 *
 * The external call is exposed through `RenderStringEntry28F62Subs.renderStringChain`
 * and defaults to no-op.
 *
 * **Callers** (xref):
 *     attr=arg4.w) as the third step of the pipeline `format-and-render-28e00`.
 *     attr=0x1000).
 */

import type { GameState } from "./state.js";

const ENTRY_ABS_ADDR = 0x0040041c as const;

/** Offset entry in `state.workRam` (= ENTRY_ABS_ADDR - 0x400000). */
export const ENTRY_OFF = 0x41c as const;

export const COL_BYTE_OFF = 0 as const;
export const TICKOFF_BYTE_OFF = 1 as const;
export const MARKER_BYTE_OFF = 6 as const;

export const RENDER_STRUCT_ADDR = ENTRY_ABS_ADDR;

export interface RenderStringEntry28F62Subs {
  /**
   * `FUN_2572` — render string chain. Default no-op.
   *
   * Production wiring should call `string-render.renderStringChain(state, rom, ...)`.
   */
  renderStringChain?: (structAddr: number, attrWord: number) => void;
}

/**
 *
 * marker=0), then calls `renderStringChain(0x40041C, attr)` via stub. `attr`
 * `0x3400`.
 *
 * @param state     GameState; mutates `workRam[0x41C]`, `[0x41D]`, `[0x422]`.
 * @param subs      stub injection for `renderStringChain` (default no-op).
 *
 * **Side effects** in `state.workRam`:
 *   - `[ENTRY_OFF + 0]   = arg1Long & 0xff`   (with the byte)
 *   - `[ENTRY_OFF + 1]   = arg2Long & 0xff`   (tickOff byte)
 *   - `[ENTRY_OFF + 6]   = 0`                 (marker clear)
 */
export function renderStringEntry28F62(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  subs?: RenderStringEntry28F62Subs,
): void {
  const r = state.workRam;

  // FUN_255A inline: three deterministic byte writes on entry @ 0x40041C.
  // - entry[0] = LSB of arg1 ext_l = arg1Long & 0xff
  // - entry[1] = LSB of arg2 ext_l = arg2Long & 0xff
  // - entry[6] = 0 (clr.b)
  r[ENTRY_OFF + COL_BYTE_OFF] = arg1Long & 0xff;
  r[ENTRY_OFF + TICKOFF_BYTE_OFF] = arg2Long & 0xff;
  r[ENTRY_OFF + MARKER_BYTE_OFF] = 0;

  // Args: (structAddr=0x40041C, attrWord=arg3Long & 0xffff).
  // word, matching FUN_2572 disassembly: `move.w (0x1e,SP),D2w` on attr.
  subs?.renderStringChain?.(RENDER_STRUCT_ADDR, arg3Long & 0xffff);
}
