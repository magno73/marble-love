/**
 * render-string-entry-286b0.ts — replica `FUN_000286B0` (62 byte).
 *
 * (`render-string-entry-28fde.ts`). Key differences:
 *
 *   - fixed work struct at `0x400410` (not `0x400434`).
 *     `arg4` (NOT hard-coded a `0x3400`).
 *
 * **Disasm 0x286B0..0x286EE** (62 byte, 4 long-on-stack args, ret void):
 *
 *   000286b0  move.l A2,-(SP)                    ; save A2 (4 byte)
 *   000286b2  movea.l (0x8,SP),A0                ; A0 = arg1Long (ptr-to-ptr)
 *   000286b6  move.b  (0xf,SP),D1b               ; D1b = LSB of arg2Long (with the)
 *   000286ba  move.b  (0x13,SP),D0b              ; D0b = LSB of arg3Long (tickOff)
 *   000286be  movea.l #0x400410,A1               ; A1 = STRUCT_BASE
 *   000286c4  movea.l (A0),A2                    ; A2 = *(arg1) = source pointer
 *   000286c6  movea.l (0x2,A1),A0                ; A0 = *(0x400412) = dest ptr
 *   000286ca  move.b  (A2)+,(A0)+                ; copy byte src to dst (postinc)
 *   000286cc  bne.b   0x000286ca                 ; loop until written byte == 0
 *   000286ce  move.b  D1b,(A1)                   ; struct[0] = with the byte
 *   000286d0  move.b  D0b,(0x1,A1)               ; struct[1] = tickOff byte
 *   000286d4  clr.b   (0x6,A1)                   ; struct[6] = 0 (marker)
 *   000286d8  move.w  (0x16,SP),D0w              ; D0.w = LOW WORD of arg4Long (attr)
 *   000286dc  ext.l   D0
 *   000286de  move.l  D0,-(SP)                   ; push attr ext_l
 *   000286e0  pea     (A1)                       ; push struct ptr (0x400410)
 *   000286e2  jsr     0x00000142.l               ; FUN_2572 (renderStringChain)
 *   000286e8  addq.l  0x8,SP                     ; pop 8 byte (attr long + struct ptr)
 *   000286ea  movea.l (SP)+,A2                   ; restore A2
 *   000286ec  rts
 *
 * **Caller convention** (xref @ 0x10bb8 / 0x10bde / etc., FUN_10504):
 *
 *   pea     (attr_word).w        ; 4 bytes (BE: hi=00, lo=attr_word)
 *   move.l  D0,-(SP)             ; arg3Long (ext_l of tickOff byte)
 *   pea     (col_word).w         ; arg2Long (ext_l of with the byte)
 *   pea     (stringPtrPtr).l     ; arg1Long
 *   jsr     0x000286b0.l
 *
 *   - SP+0   saved A2  (4 byte)
 *   - SP+4   return PC (4 byte)
 *   - SP+8   arg1Long  (4 byte) — ptr-to-ptr a source string
 *
 * **Layout struct @ `0x400410`** (workRam off `0x410`):
 *
 *   +0  byte  : with the (written by FUN_286B0)
 *   +1  byte  : tickOff (written by FUN_286B0)
 *               not modified here; caller/init code configures it)
 *   +8  long  : pointer to the next entry (not modified here)
 *
 *     `0x00` (terminator included, like standard `strcpy`).
 *     `*(0x400412)` remains unchanged after the call. Destination pointer
 *     advancement is local to the A0 register.
 *
 * **Side effects** in workRam (relativi a base `0x400000`):
 *
 *      with `destOff = readLong(0x412)` mapped to work RAM and `N` equal to
 *      the copied string length; tests keep dest in the `[0..0x2000)` work RAM range.
 *
 *   2. `[0x410]` ← `arg2Long & 0xff`           (with the byte)
 *   3. `[0x411]` ← `arg3Long & 0xff`           (tickOff byte)
 *   4. `[0x416]` ← `0`                         (marker clear)
 *
 *   5. Calls `subs.renderStringChain(0x400410, arg4Long & 0xffff)`.
 *
 * Final work RAM write order:
 *   1. string copy (postinc loop)
 *   2. struct[0] = with the
 *   3. struct[1] = tickOff
 *   4. struct[6] = 0
 *   5. jsr 0x142 (patched to `rts` in parity tests, so no extra effects)
 *
 * **JSR sub injection**: `FUN_2572` (renderStringChain). Smoke tests leave it
 * as the default no-op; parity tests patch the binary subroutine to `rts`.
 *
 */

import type { GameState } from "./state.js";

export const STRUCT_ABS_ADDR = 0x00400410 as const;

/** Offset struct in `state.workRam` (= STRUCT_ABS_ADDR - 0x400000). */
export const STRUCT_OFF = 0x410 as const;

export const COL_BYTE_OFF = 0 as const;
export const TICKOFF_BYTE_OFF = 1 as const;
export const DEST_PTR_LONG_OFF = 2 as const;
export const MARKER_BYTE_OFF = 6 as const;

export const RENDER_STRUCT_ADDR = STRUCT_ABS_ADDR;

/** Absolute work RAM base, used to convert absolute pointers to offsets. */
const WORK_RAM_BASE_ADDR = 0x00400000 as const;
const WORK_RAM_SIZE = 0x2000 as const;

/**
 * Stub injection for the JSR to `FUN_2572` (renderStringChain).
 */
export interface RenderStringEntry286B0Subs {
  /**
   * `FUN_2572` — render string chain. Default no-op.
   *
   * Production wiring should call `string-render.renderStringChain(state, rom, ...)`.
   */
  renderStringChain?: (structAddr: number, attrWord: number) => void;
}

/**
 */
function readLongBE(mem: Uint8Array, off: number): number {
  const a = mem[off] ?? 0;
  const b = mem[off + 1] ?? 0;
  const c = mem[off + 2] ?? 0;
  const d = mem[off + 3] ?? 0;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/**
 *
 * **Side effects** in `state.workRam`:
 *
 *   1. **String copy** from `srcPtr = *(*arg1Long)` to `dstPtr = *(0x400412)`.
 *
 *   2. `workRam[0x410]` ← `arg2Long & 0xff`     (with the byte)
 *   3. `workRam[0x411]` ← `arg3Long & 0xff`     (tickOff byte)
 *   4. `workRam[0x416]` ← `0`                    (marker clear)
 *
 *   5. Calls `subs.renderStringChain(0x400410, arg4Long & 0xffff)` (default
 *      no-op).
 *
 * @param state     GameState; mutates `workRam[dstOff..dstOff+N]`,
 *                  `[0x410]`, `[0x411]`, `[0x416]`).
 * @param arg1Long  long arg1: pointer to the **pointer-to-source-string**.
 * @param subs      stub injection for `renderStringChain` (default no-op).
 *
 * D0 is not meaningful for the TS API because caller `FUN_10504` ignores it.
 */
export function renderStringEntry286B0(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  arg4Long: number,
  subs?: RenderStringEntry286B0Subs,
  romRead8?: (absAddr: number) => number,
): void {
  const r = state.workRam;

  let srcPtr: number;
  const a1Abs = arg1Long >>> 0;
  if (a1Abs >= WORK_RAM_BASE_ADDR && a1Abs + 4 <= WORK_RAM_BASE_ADDR + WORK_RAM_SIZE) {
    srcPtr = readLongBE(r, a1Abs - WORK_RAM_BASE_ADDR);
  } else if (romRead8) {
    srcPtr =
      (((romRead8(a1Abs) & 0xff) << 24) |
        ((romRead8(a1Abs + 1) & 0xff) << 16) |
        ((romRead8(a1Abs + 2) & 0xff) << 8) |
        (romRead8(a1Abs + 3) & 0xff)) >>>
      0;
  } else {
    srcPtr = 0;
  }

  // Step 2: A0 = *(0x400412) = destination pointer (long-BE from work RAM @ 0x412).
  const dstPtr = readLongBE(r, STRUCT_OFF + DEST_PTR_LONG_OFF) >>> 0;

  const inWorkRam = (abs: number): boolean =>
    abs >= WORK_RAM_BASE_ADDR && abs < WORK_RAM_BASE_ADDR + WORK_RAM_SIZE;

  const readSrc = (abs: number): number => {
    if (inWorkRam(abs)) return r[abs - WORK_RAM_BASE_ADDR] ?? 0;
    if (romRead8) return romRead8(abs) & 0xff;
    return 0;
  };

  const writeDst = (abs: number, v: number): void => {
    if (inWorkRam(abs)) r[abs - WORK_RAM_BASE_ADDR] = v & 0xff;
    // Writes outside work RAM are intentionally ignored here; parity tests keep
    // dstPtr in work RAM.
  };

  const COPY_HARD_CAP = WORK_RAM_SIZE;
  let s = srcPtr >>> 0;
  let d = dstPtr >>> 0;
  for (let n = 0; n < COPY_HARD_CAP; n++) {
    const byte = readSrc(s) & 0xff;
    writeDst(d, byte);
    s = (s + 1) >>> 0;
    d = (d + 1) >>> 0;
    if (byte === 0) break;
  }

  // Step 4: byte writes on the struct (with the, tickOff, marker=0).
  r[STRUCT_OFF + COL_BYTE_OFF] = arg2Long & 0xff;
  r[STRUCT_OFF + TICKOFF_BYTE_OFF] = arg3Long & 0xff;
  r[STRUCT_OFF + MARKER_BYTE_OFF] = 0;

  // Step 5: jsr 0x142 to FUN_2572 (renderStringChain). Stub injection.
  // attr = low word of arg4Long, matching `move.w (0x16,SP),D0w`.
  const attrWord = arg4Long & 0xffff;
  subs?.renderStringChain?.(RENDER_STRUCT_ADDR, attrWord);
}

/** Re-export the symbol as "FUN_000286B0" for cross-reference. */
export { renderStringEntry286B0 as FUN_000286B0 };
