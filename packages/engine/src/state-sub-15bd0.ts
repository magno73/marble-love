/**
 * state-sub-15bd0.ts — replica `FUN_00015BD0` (118 byte).
 *
 *   1. **Block A** (gated by low byte of `arg3Long`):
 *
 *   2. **Block B** (gated by low byte of `arg2Long`):
 *      `0x400018` stride `0xE2`, for i in [0..count), where
 *      `count = *0x400396` (word). For every obj with `obj+0x18 not in {0, 2}`
 *
 *   - `arg1Long` (long -> A0 = structPtr): absolute pointer to a struct
 *       - `clr.b (0x18, A0)` - write 0
 *       - `move.b (0x19, A0), D0b` - read byte -> sign-ext -> FUN_18F46 arg2
 *     Block B gate. Zero skips Block B.
 *     Block A gate. Zero skips Block A.
 *
 * **Disasm 0x15BD0..0x15C46** (118 byte):
 *
 *   movem.l {A2,D3,D2},-(SP)         ; save A2/D3/D2 (12 byte)
 *   movea.l (0x10,SP),A0             ; A0 = arg1 long (structPtr)
 *   move.b  (0x17,SP),D2b            ; D2.b = arg2 low byte
 *   move.b  (0x1B,SP),D0b            ; D0.b = arg3 low byte
 *   tst.b   D0b
 *   beq.b   0x15BFE                  ; arg3.b == 0, skip Block A
 *   ; Block A:
 *   clr.b   (0x18, A0)               ; structPtr+0x18 = 0
 *   move.b  (0x19, A0), D0b
 *   ext.w   D0w
 *   ext.l   D0                       ; D0 = sext_l(structPtr+0x19)
 *   move.l  D0,-(SP)                 ; push arg2 (long sext)
 *   pea     (0x2).w                  ; push arg1 = sext_l(0x2) = 2
 *   jsr     0x00018F46.l             ; FUN_18F46(2, sext_l(structPtr+0x19))
 *   addq.l  #8, SP
 * 0x15BFE:
 *   tst.b   D2b
 *   beq.b   0x15C40                  ; arg2.b == 0, skip Block B
 *   movea.l #0x400018, A2            ; A2 = OBJ_BASE_ADDR
 *   clr.b   D2b                      ; D2.b = 0 (loop counter)
 *   bra.b   0x15C34                  ; jump to loop test
 * 0x15C0C: ; loop body
 *   cmpi.b  #0x2, (0x18, A2)         ; obj.state == 2?
 *   tst.b   (0x18, A2)               ; obj.state == 0?
 *   pea     (0x3).w                  ; push 3 (long sext)
 *   move.l  A2,-(SP)                 ; push objAddr
 *   jsr     0x000285B0.l             ; FUN_285B0(objAddr, 3)
 *   addq.l  #8, SP
 * 0x15C28:
 *   move.l  A2, D3
 *   addi.l  #0xE2, D3                ; A2 += 0xE2 (next obj stride)
 *   movea.l D3, A2
 *   addq.b  #1, D2b                  ; D2++
 * 0x15C34: ; loop test
 *   move.b  D2b, D0b
 *   ext.w   D0w
 *   cmp.w   (0x00400396).l, D0w      ; D0.w == count word?
 *   bne.b   0x15C0C                  ; no, loop
 * 0x15C40:
 *   movem.l (SP)+, {D2,D3,A2}
 *   rts
 *
 *   - (0, 0): total no-op
 *   - (0, !0): only Block A (reset structPtr.state + FUN_18F46)
 *
 * **Known callers** (8 xrefs): `FUN_15A12 @ 0x15BB4`, `FUN_121B8 @ 0x1229E`,
 * `FUN_121B8 @ 0x126E8`, `FUN_1BC88 @ 0x1BFD2`, `FUN_25C74 @ 0x25DD8`,
 *
 * sign-extended. If `count > 127` or `count == 0`, the loop has edge cases.
 *
 *
 * **JSR sub injection**: two callees exposed through `StateSub15BD0Subs`:
 *   - `fun_18f46(arg1Long, arg2Long, state)` - called 0 or 1 times per
 *     `stateSub15BD0`. Default no-op.
 *   - `fun_285b0(objAddr, eventByte, state)` - called 0..count times.
 *     Default no-op.
 *
 * **Direct side effects** (excluding sub effects):
 *   - `workRam[(structPtr - 0x400000) + 0x18] = 0` when `arg3.b != 0` and
 *
 * `addq.l #8, SP` or the `bne` flag. The TS API returns `void`.
 *
 */

import type { GameState } from "./state.js";

// ─── Address constants ───────────────────────────────────────────────────

export const OBJ_BASE_ADDR = 0x00400018 as const;
/** Stride between adjacent object structs. */
export const OBJ_STRIDE = 0xe2 as const;
/** Absolute address of the "object count" word (0x400396). */
export const OBJ_COUNT_ADDR = 0x00400396 as const;

/** Relative offset of the "state" byte in the struct/object. */
export const STATE_FIELD_OFF = 0x18 as const;
export const FIELD_19_OFF = 0x19 as const;

/** Constant `2` passed as arg1 to FUN_18F46. */
export const FUN_18F46_ARG1 = 0x2 as const;
/** Constant `3` passed as arg2 (eventByte) to FUN_285B0. */
export const FUN_285B0_EVENT = 0x3 as const;

/** Absolute M68k work RAM base. */
const WORK_RAM_BASE = 0x00400000;
/** Work RAM size (8 KB). */
const WORK_RAM_SIZE = 0x2000;

// ─── Sub injection types ─────────────────────────────────────────────────

/**
 * Stub injection for the two JSR calls in FUN_15BD0.
 *
 *   `arg1Long = 2` (constant) and `arg2Long = sext_l(structPtr+0x19)`
 *   (signed byte expanded to signed long, wrapped to u32). Default no-op.
 * - `fun_285b0`: called in Block B (0..count times). Receives
 *   `objAddrLong` (absolute long of object slot) and `eventByteLong = 3`.
 *   Default no-op.
 */
export interface StateSub15BD0Subs {
  /** FUN_18F46(arg1=2, arg2=sext_l(structPtr+0x19), state). */
  fun_18f46?: (arg1Long: number, arg2Long: number, state: GameState) => void;
  /** FUN_285B0(objAddr, eventByte=3, state). */
  fun_285b0?: (objAddrLong: number, eventByteLong: number, state: GameState) => void;
}

// ─── Implementation ──────────────────────────────────────────────────────

/**
 *
 *                    `workRam[(structPtr - 0x400000) + 0x18] = 0` when active.
 * @param structPtrLong  long: absolute pointer to the struct passed by caller.
 * @param arg2Long    long: Block B gate, low byte only.
 * @param arg3Long    long: Block A gate, low byte only.
 * @param subs        stub injection for `fun_18f46` (1 call) and
 *                    `fun_285b0` (0..count call).
 *
 *   1. If `arg3Long & 0xFF != 0`:
 *          wrapped to u32 for the callback).
 *   2. If `arg2Long & 0xFF != 0`:
 *        - For i in [0..count) sequentially:
 *            - `objAddr = 0x400018 + i * 0xE2` (long).
 *            - `objStateByte = workRam[objAddr+0x18 - 0x400000]`.
 *            - If `objStateByte != 0` and `objStateByte != 2`:
 *
 * observed at real call sites).
 *
 * that produces -128..127. To pass it to the callback as `u32`:
 * 0xFFFFFFFF).
 */
export function stateSub15BD0(
  state: GameState,
  structPtrLong: number,
  arg2Long: number,
  arg3Long: number,
  subs?: StateSub15BD0Subs,
): void {
  const r = state.workRam;
  const a0 = structPtrLong >>> 0;
  const arg2B = arg2Long & 0xff;
  const arg3B = arg3Long & 0xff;

  // ─── Block A: arg3.b != 0 ────────────────────────────────────────────
  if (arg3B !== 0) {
    // clr.b (0x18, A0)
    const stateAddr = (a0 + STATE_FIELD_OFF) >>> 0;
    if (stateAddr >= WORK_RAM_BASE && stateAddr < WORK_RAM_BASE + WORK_RAM_SIZE) {
      r[stateAddr - WORK_RAM_BASE] = 0;
    }
    // move.b (0x19, A0), D0b ; ext.w D0w ; ext.l D0
    const fld19Addr = (a0 + FIELD_19_OFF) >>> 0;
    let byte19 = 0;
    if (fld19Addr >= WORK_RAM_BASE && fld19Addr < WORK_RAM_BASE + WORK_RAM_SIZE) {
      byte19 = r[fld19Addr - WORK_RAM_BASE] ?? 0;
    }
    // Sign-extend byte to long, then wrap to u32 for callback bit pattern.
    const arg2Sext = (((byte19 & 0xff) << 24) >> 24) >>> 0;
    // pea (0x2).w -> arg1 long = sext_l(0x2) = 2.
    subs?.fun_18f46?.(FUN_18F46_ARG1, arg2Sext, state);
  }

  // ─── Block B: arg2.b != 0 ────────────────────────────────────────────
  if (arg2B !== 0) {
    // count = word @ 0x400396 (big-endian).
    const countOff = OBJ_COUNT_ADDR - WORK_RAM_BASE;
    const countWord =
      (((r[countOff] ?? 0) << 8) | (r[countOff + 1] ?? 0)) & 0xffff;

    // Loop: D2.b from 0 to count-1.
    // Equivalent to `for (i = 0; i < count; i++)` for count <= 127.
    let objAddr = OBJ_BASE_ADDR >>> 0;
    for (let i = 0; i < countWord; i++) {
      const objStateOff = (objAddr + STATE_FIELD_OFF) - WORK_RAM_BASE;
      const objStateByte = r[objStateOff] ?? 0;

      // cmpi.b #0x2, (0x18, A2); beq skip → if state == 2: skip
      // tst.b (0x18, A2); beq skip → if state == 0: skip
      if (objStateByte !== 0 && objStateByte !== 2) {
        // pea (0x3).w -> eventByte arg = sext_l(3) = 3.
        subs?.fun_285b0?.(objAddr, FUN_285B0_EVENT, state);
      }

      // A2 += 0xE2
      objAddr = (objAddr + OBJ_STRIDE) >>> 0;
    }
  }
}
