/**
 * helper-253bc.ts - `FUN_000253BC` replica (15 instructions, 0x253BC-0x253EA).
 *
 *
 * If `*(A0+0x36).b == 0`:
 *   1. `*(A0+0x32).w = arithmetic_shift_right_32(*(A0+0x0C).l, 19) & 0xFFFF`
 *   2. `*(A0+0x34).w = arithmetic_shift_right_32(*(A0+0x10).l, 19) & 0xFFFF`
 *   3. `*(A0+0x2A).l = *(A0+0x14).l`   (long copy)
 *   4. `*(A0+0x1D).b = *(A0+0x1B).b`   (byte copy)
 *
 * **Disasm 0x253BC..0x253EA** (15 instructions):
 *
 *   000253bc  movea.l (0x4,SP),A0           ; A0 = arg1 = objPtr (struct abs addr)
 *   000253c0  tst.b   (0x36,A0)             ; test freeze flag
 *   000253c4  bne.b   0x000253ea            ; if freeze != 0: skip -> rts
 *   000253c6  move.l  (0xc,A0),D1           ; D1 = *(A0+0x0C) [x long, 16.16 fp]
 *   000253ca  moveq   0x13,D0               ; D0 = 19
 *   000253cc  asr.l   D0,D1                 ; D1 >>= 19 (arithmetic, long drops frac)
 *   000253ce  move.w  D1w,(0x32,A0)         ; *(A0+0x32).w = D1.w (screen-X short)
 *   000253d2  move.l  (0x10,A0),D1          ; D1 = *(A0+0x10) [y long]
 *   000253d6  moveq   0x13,D0               ; D0 = 19
 *   000253d8  asr.l   D0,D1                 ; D1 >>= 19 (arithmetic)
 *   000253da  move.w  D1w,(0x34,A0)         ; *(A0+0x34).w = D1.w (screen-Y short)
 *   000253de  move.l  (0x14,A0),(0x2a,A0)   ; *(A0+0x2A) = *(A0+0x14) (long copy)
 *   000253e4  move.b  (0x1b,A0),(0x1d,A0)   ; *(A0+0x1D).b = *(A0+0x1B).b
 *   000253ea  rts
 *
 *     (range typical: `0x400018..0x401FFC`).
 *
 * **Side effects** (workRam offset relative to `objPtr - 0x400000`):
 *   - `*(objPtr+0x32).w` - screen X short (from long 16.16 >> 19)
 *   - `*(objPtr+0x34).w` - screen Y short (from long 16.16 >> 19)
 *
 * **Callers** (4 real call sites, 1 external entry point = 5 total refs):
 *   - `FUN_000158F6` @ 0x0001597C
 *   - `FUN_000253EC` @ 0x00025732, 0x00025756, 0x000257C4
 */

import type { GameState } from "./state.js";


export const HELPER_253BC_ADDR = 0x000253bc as const;

/** Absolute work RAM base. */
const WORK_RAM_BASE = 0x00400000 as const;

// Internal helpers.

function readU32(r: Uint8Array, off: number): number {
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

function writeU32(r: Uint8Array, off: number, v: number): void {
  const x = v >>> 0;
  r[off] = (x >>> 24) & 0xff;
  r[off + 1] = (x >>> 16) & 0xff;
  r[off + 2] = (x >>> 8) & 0xff;
  r[off + 3] = x & 0xff;
}


/**
 *
 *
 * @param state   GameState: mutates `state.workRam` in place.
 *                (e.g. `0x401D00`). Must be in range `0x400000..0x401FFF`.
 */
export function helper253BC(state: GameState, objPtr: number): void {
  const r = state.workRam;
  const objOff = (objPtr - WORK_RAM_BASE) >>> 0;

  // tst.b (0x36,A0) / bne.b 0x253EA -> no-op if freeze flag != 0
  if ((r[objOff + 0x36] ?? 0) !== 0) return;

  // move.l (0xc,A0),D1 → D1 = unsigned long
  // asr.l  #19, D1     → arithmetic shift right: tratta D1 as signed 32-bit
  const longX = readU32(r, objOff + 0x0c);
  const longXSigned = longX >= 0x80000000 ? longX - 0x100000000 : longX;
  const screenX = (longXSigned >> 19) & 0xffff;
  r[objOff + 0x32] = (screenX >>> 8) & 0xff;
  r[objOff + 0x33] = screenX & 0xff;

  const longY = readU32(r, objOff + 0x10);
  const longYSigned = longY >= 0x80000000 ? longY - 0x100000000 : longY;
  const screenY = (longYSigned >> 19) & 0xffff;
  r[objOff + 0x34] = (screenY >>> 8) & 0xff;
  r[objOff + 0x35] = screenY & 0xff;

  // ── Long copy: *(A0+0x14) → *(A0+0x2A) ─────────────────────────────────
  // move.l (0x14,A0),(0x2a,A0)
  writeU32(r, objOff + 0x2a, readU32(r, objOff + 0x14));

  // ── Byte copy: *(A0+0x1B) → *(A0+0x1D) ──────────────────────────────────
  // move.b (0x1b,A0),(0x1d,A0)
  r[objOff + 0x1d] = r[objOff + 0x1b] ?? 0;
}
