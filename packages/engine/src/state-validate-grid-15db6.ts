/**
 * state-validate-grid-15db6.ts — replica `FUN_00015DB6` (110 byte).
 *
 *        - `signExt_l(byte (A1))`     vs `asr.l_signed((long *)(structPtr + 0x0C), 19)`
 *        - `signExt_l(byte (A1)+1)`   vs `asr.l_signed((long *)(structPtr + 0x10), 19)`
 *      match `field >> 19` (signed asr) as signed long.
 *   3. If match and `(byte structPtr + 0x1A) == 0x23`, replace the
 *      `kind` byte with `0x20` (in-place mutation of kind 0x23 → 0x20). Set
 *      D0 = 1.
 *   4. If mismatch, D0 = 0 (low byte; high byte/word not guaranteed but not
 *        - if == 0x23 → `FUN_00015D10(structPtr)`     (no D0 arg)
 *        - else        → `FUN_00015E24(structPtr, signExt_l(D0.b))`
 *
 * **Known caller** (1 site, see `find_xrefs`):
 *   - `0x182C4` in `FUN_000182BA`: `move.l A2,-(SP); jsr 0x15DB6.l;
 *     FUN_182BA.
 *
 * **Disasm 0x15DB6..0x15E23** (110 byte):
 *
 *   move.l   D2,-(SP)                  ; save D2
 *                                         saved-D2 + ret addr)
 *   movea.l  (0x6e,A0),A1              ; A1 = currentPtr (long @ +0x6E)
 *   move.b   (A1),D1b
 *   ext.w    D1w
 *   ext.l    D1                        ; D1 = signExt_l(currentPtr[0])
 *   move.l   (0xc,A0),D2               ; D2 = field_x (long @ +0x0C)
 *   moveq    #0x13,D0
 *   asr.l    D0,D2                     ; D2 = asr_signed(field_x, 19)
 *   cmp.l    D2,D1                     ; cmp signExt(currPtr[0]), x>>19
 *   bne.b    LFAIL                     ; mismatch → D0 = 0
 *   move.b   (0x1,A1),D1b
 *   ext.w    D1w
 *   ext.l    D1                        ; D1 = signExt_l(currentPtr[1])
 *   move.l   (0x10,A0),D2              ; D2 = field_y (long @ +0x10)
 *   moveq    #0x13,D0
 *   asr.l    D0,D2                     ; D2 = asr_signed(field_y, 19)
 *   cmp.l    D2,D1                     ; cmp signExt(currPtr[1]), y>>19
 *   bne.b    LFAIL                     ; mismatch → D0 = 0
 *   ; Match: maybe-mutate kind 0x23 → 0x20
 *   cmpi.b   #0x23,(0x1a,A0)
 *   bne.b    LSETD0                    ; kind != 0x23 → skip mutate
 *   move.b   #0x20,(0x1a,A0)           ; kind 0x23 → 0x20
 *  LSETD0:
 *   moveq    #0x1,D0                   ; D0 = 1 (match flag, full long)
 *   bra.b    LDISPATCH
 *  LFAIL:
 *   clr.b    D0b                       ; D0.b = 0 (mismatch flag, low byte)
 *  LDISPATCH:
 *   cmpi.b   #0x23,(0x1a,A0)           ; re-check kind (post-mutate)
 *   bne.b    LELSE
 *   ; kind == 0x23 → FUN_15D10(structPtr); D0 ignored
 *   move.l   A0,-(SP)
 *   jsr      0x00015D10.l              ; FUN_15D10(structPtr)
 *   addq.l   #0x4,SP
 *   bra.b    LEND
 *  LELSE:
 *   ; kind != 0x23 → FUN_15E24(structPtr, signExt_l(D0.b))
 *   move.b   D0b,D2b
 *   ext.w    D2w
 *   ext.l    D2                         ; D2 = signExt_l(D0.b) (long)
 *   move.l   D2,-(SP)                   ; push arg2 = signExt_l flag
 *   move.l   A0,-(SP)                   ; push arg1 = structPtr
 *   jsr      0x00015E24.l               ; FUN_15E24(structPtr, flag)
 *   addq.l   #0x8,SP
 *  LEND:
 *   move.l   (SP)+,D2                   ; restore D2
 *   rts
 *
 * **Direct side effect**:
 *   - `workRam[(structPtr + 0x1A) - 0x400000] = 0x20` if match and the
 *     original `*(structPtr+0x1A) == 0x23`.
 *
 *                       kind post-mutate == 0x20 != 0x23)
 *   - (true, !=0x23) → `fun_15e24(ptr, 1)`
 *   - (false, 0x23)  → `fun_15d10(ptr)` (kind not mutated)
 *   - (false, !=0x23)→ `fun_15e24(ptr, 0)`
 *
 * **JSR sub injection**: two callees exposed through
 * `StateValidateGrid15DB6Subs`:
 *     callee = low byte of flagLong.)
 *
 *   - `*(long *)(structPtr + 0x6E)` → currentPtr (absolute)
 *   - `*(long *)(structPtr + 0x0C)` → field_x
 *   - `*(long *)(structPtr + 0x10)` → field_y
 *   - `*(byte *)(currentPtr + 0)`   → cmp byte 0
 *   - `*(byte *)(currentPtr + 1)`   → cmp byte 1
 *
 * `state.workRam` only if the address falls within the workRam range.
 *
 */

import type { GameState } from "./state.js";

/** Absolute M68k WORK RAM base. */
const WORK_RAM_BASE = 0x00400000;
/** Dimensione workRam (8 KB). */
const WORK_RAM_SIZE = 0x2000;

export const FIELD_X_OFF = 0x0c as const;
export const FIELD_Y_OFF = 0x10 as const;
export const KIND_BYTE_OFF = 0x1a as const;
export const CURRENT_PTR_OFF = 0x6e as const;
export const KIND_FROM = 0x23 as const;
export const KIND_TO = 0x20 as const;
export const ASR_COUNT = 0x13 as const;

/**
 * Stub injection per le 2 JSR of the validatore.
 *
 *   Default no-op.
 */
export interface StateValidateGrid15DB6Subs {
  /**
   * `FUN_00015D10(structPtr) → void`. Handler "fallback" per kind 0x23
   */
  fun_15d10?: (structPtrLong: number) => void;
  /**
   * `FUN_00015E24(structPtr, flagLong) → void`. Handler "main";
   */
  fun_15e24?: (structPtrLong: number, flagLong: number) => void;
  /**
   * Optional absolute byte reader for target pointers outside workRam
   * (notably ROM-backed path tables used by FUN_182BA).
   */
  readByteAbs?: (addr: number) => number;
}

/** Read big-endian long from workRam (or 0 if out-of-range). */
function readLongAbs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a + 4 > WORK_RAM_BASE + WORK_RAM_SIZE) return 0;
  const off = (a - WORK_RAM_BASE) >>> 0;
  const r = state.workRam;
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

/** Read unsigned byte from workRam (or 0 if out-of-range). */
function readByteAbs(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + WORK_RAM_SIZE) return 0;
  return state.workRam[a - WORK_RAM_BASE] ?? 0;
}

/** Write unsigned byte to workRam (no-op if out-of-range). */
function writeByteAbs(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_BASE + WORK_RAM_SIZE) return;
  state.workRam[a - WORK_RAM_BASE] = value & 0xff;
}

/** Signed asr.l su 32 bit. */
function asrL(value: number, count: number): number {
  const c = count & 0x3f;
  return ((value | 0) >> c) | 0;
}

/** Sign-extend byte 0..0xFF a int32 signed. */
function sextByteL(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

/**
 * the byte-pair @ `currentPtr` and cell `(field_x>>19, field_y>>19)`,
 * optionally mutates `kind` 0x23 → 0x20, then dispatches to
 * `fun_15d10` o `fun_15e24`.
 *
 *                       (mutated to 0x20 if match and original = 0x23).
 *                       2 byte @ currentPtr+{0,1}.
 * @param structPtrLong  long (A0): absolute pointer to the struct.
 * @param subs           stub injection for `fun_15d10` / `fun_15e24`.
 * @returns void. Direct side effect: mutates the kind byte when applicable;
 */
export function stateValidateGrid15DB6(
  state: GameState,
  structPtrLong: number,
  subs?: StateValidateGrid15DB6Subs,
): void {
  const a0 = structPtrLong >>> 0;

  // A1 = currentPtr (long @ +0x6E)
  const currentPtr = readLongAbs(state, a0 + CURRENT_PTR_OFF);

  // D1 = signExt_l(byte (A1)); D2 = asr_signed(field_x, 19)
  const readTargetByte = subs?.readByteAbs ?? ((addr: number) => readByteAbs(state, addr));
  const b0 = readTargetByte(currentPtr);
  const d1_a = sextByteL(b0); // signed long
  const fieldX = readLongAbs(state, a0 + FIELD_X_OFF);
  const d2_a = asrL(fieldX, ASR_COUNT); // signed long

  let matched = d1_a === d2_a;

  if (matched) {
    // 2nd compare: byte @ currentPtr+1 vs field_y >> 19
    const b1 = readTargetByte(currentPtr + 1);
    const d1_b = sextByteL(b1);
    const fieldY = readLongAbs(state, a0 + FIELD_Y_OFF);
    const d2_b = asrL(fieldY, ASR_COUNT);
    matched = d1_b === d2_b;
  }

  // Read original kind (pre-mutate) for dispatch decision later.
  let kindByte = readByteAbs(state, a0 + KIND_BYTE_OFF);
  let flagLow = 0;

  if (matched) {
    if (kindByte === KIND_FROM) {
      // Mutazione 0x23 → 0x20 in workRam
      writeByteAbs(state, a0 + KIND_BYTE_OFF, KIND_TO);
      kindByte = KIND_TO;
    }
    flagLow = 1; // moveq #0x1, D0 (full long, low byte = 1)
  } else {
    flagLow = 0; // clr.b D0b (low byte = 0)
  }

  // Re-check post-mutate kind per scegliere il dispatch.
  if (kindByte === KIND_FROM) {
    subs?.fun_15d10?.(a0);
    return;
  }

  // signExt_l of 0/1 = 0/1 long.
  const flagLong = sextByteL(flagLow) | 0;
  subs?.fun_15e24?.(a0, flagLong >>> 0);
}
