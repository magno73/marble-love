/**
 * Replica of `FUN_0001ABD4`, a binary search over a sorted word table.
 *
 * The table base and end pointers are stored in long slots `0x40065A` and
 * `0x40065E`. The caller (`FUN_0001AA38`) uses the returned word index to map
 * a signed 16-bit offset into a sample/index slot.
 *
 * **Disasm 0x1ABD4..0x1AC18** (68 byte = 0x44):
 *
 *   0001abd4  move.l  (0x4,SP),D1            ; D1 = arg1 long (target)
 *   0001abd8  movea.l (0x0040065A).l,A0      ; A0 = lo bound (base)
 *   0001abde  movea.l (0x0040065E).l,A1      ; A1 = hi bound (end)
 *   0001abe4  move.l  A2,-(SP)               ; save A2
 *   0001abe6  movea.l A0,A2                  ; A2 = base (probe ptr)
 *   0001abe8  move.l  #0x400,D0              ; initial step
 *   ; loop @ 0x1ABEE:
 *   0001abee  cmp.w   (A2),D1w               ; flags from D1.w - (A2).w
 *   0001abf0  bcc.b   0x1ABF6                ; D1 >= (A2) unsigned, check eq
 *   0001abf2    suba.l D0,A2                 ; D1<(A2): A2 -= step
 *   0001abf4    bra.b  0x1AC06                ; clamp + halve
 *   0001abf6  beq.b   0x1ABFC                ; D1 == (A2), return
 *   0001abf8    adda.l D0,A2                 ; D1>(A2): A2 += step
 *   0001abfa    bra.b  0x1AC06                ; clamp + halve
 *   ; return @ 0x1ABFC:
 *   0001abfc  move.l  A2,D0                  ; D0 = A2
 *   0001abfe  sub.l   A0,D0                  ; D0 = A2 - A0 (byte offset)
 *   0001ac00  lsr.l   #1,D0                  ; D0 >>= 1 (word index)
 *   0001ac02  movea.l (SP)+,A2
 *   0001ac04  rts
 *   ; clamp + halve @ 0x1AC06:
 *   0001ac06  cmpa.l  A2,A1                  ; flags from A1 - A2
 *   0001ac08  bcc.b   0x1AC0E                ; A1 >= A2, no clamp top
 *   0001ac0a    movea.l A1,A2                ; A2 > A1, clamp to A1
 *   0001ac0c    bra.b  0x1AC14                ; skip lower clamp
 *   0001ac0e  cmpa.l  A0,A2                  ; flags from A2 - A0
 *   0001ac10  bcc.b   0x1AC14                ; A2 >= A0, no lower clamp
 *   0001ac12    movea.l A0,A2                ; A2 < A0, clamp to A0
 *   0001ac14  lsr.l   #1,D0                  ; step >>= 1
 *   0001ac16  bra.b   0x1ABEE                ; loop
 *
 * The ROM only terminates on equality. If the target is absent, the step reaches
 * zero and the binary spins forever. The TS replica keeps a safety cap so tests
 * with arbitrary data cannot hang, while matching binary behavior when the table
 * contains the target.
 *
 * Comparisons are unsigned 16-bit word comparisons.
 *
 * **Caller** (FUN_0001AA38 @ 0x1ABBE):
 *
 *   0x1ABB6: move.l A1,D1
 *   0x1ABB8: sub.w  D6w,D1w
 *   0x1ABBA: ext.l  D1               ; D1 = sign-extended 16-bit offset
 *   0x1ABBC: move.l D1,-(SP)         ; push arg
 *   0x1ABBE: jsr    0x0001ABD4.l
 *   0x1ABC4: move.w D0w,(-0x8,A2)    ; save word index in AI slot
 *
 * Verified by `cli/src/test-bsearch-table-1abd4-parity.ts`.
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";

/** Long slot at `0x0040065A`: table base pointer in work RAM. */
export const TABLE_BASE_PTR_ABS = 0x0040065a as const;
/** Long slot at `0x0040065E`: table end pointer in work RAM. */
export const TABLE_END_PTR_ABS = 0x0040065e as const;

/** Workram base (used to map absolute addresses to `workRam` offset). */
const WORK_RAM_BASE_ADDR = 0x00400000 as const;
const WORK_RAM_SIZE = 0x2000 as const;

/** Initial binary-search step in bytes; halved each iteration. */
export const INITIAL_STEP_BYTES = 0x400 as const;

/**
 * Defensive cap on the binary-search loop.
 *
 * The ROM has no cap and spins forever when the target is absent. We keep a cap
 * only to protect tests with arbitrary data.
 */
export const ITERATION_CAP = 64 as const;

/**
 * Stub injection placeholder. `FUN_0001ABD4` does not call JSR; this empty
 * shape keeps the same public pattern as other replicated routines.
 */
export type BsearchTable1ABD4Subs = Record<string, never>;

/** Read a big-endian long from `workRam` at offset. */
function readLongBE(mem: Uint8Array, off: number): number {
  const a = mem[off] ?? 0;
  const b = mem[off + 1] ?? 0;
  const c = mem[off + 2] ?? 0;
  const d = mem[off + 3] ?? 0;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** Read an unsigned big-endian word from `workRam` at offset. */
function readWordBE(mem: Uint8Array, off: number): number {
  const a = mem[off] ?? 0;
  const b = mem[off + 1] ?? 0;
  return ((a << 8) | b) & 0xffff;
}

function readAbsWordBE(state: GameState, rom: RomImage | undefined, abs: number): number {
  const a = abs >>> 0;
  if (a >= WORK_RAM_BASE_ADDR && a + 1 < WORK_RAM_BASE_ADDR + WORK_RAM_SIZE) {
    return readWordBE(state.workRam, a - WORK_RAM_BASE_ADDR);
  }
  if (rom !== undefined && a + 1 < rom.program.length) {
    return (((rom.program[a] ?? 0) << 8) | (rom.program[a + 1] ?? 0)) & 0xffff;
  }
  return 0;
}

/**
 * Bit-perfect replica of `FUN_0001ABD4`.
 *
 * Searches the word-aligned table selected by `0x40065A..0x40065E` for
 * `targetLong & 0xffff` and returns the matching word index. If the target is
 * absent, returns the final probe index after `ITERATION_CAP`; the real ROM
 * would not terminate in that case.
 */
export function bsearchTable1ABD4(
  state: GameState,
  targetLong: number,
  rom?: RomImage,
  _subs?: BsearchTable1ABD4Subs,
): number {
  const r = state.workRam;
  const target = targetLong & 0xffff;

  // A0 = *(0x40065A), A1 = *(0x40065E)
  const baseAbs = readLongBE(r, TABLE_BASE_PTR_ABS - WORK_RAM_BASE_ADDR);
  const endAbs = readLongBE(r, TABLE_END_PTR_ABS - WORK_RAM_BASE_ADDR);

  // Long arithmetic on A0/A1/A2 wraps modulo 2^32; `>>> 0` mirrors that.

  let probeAbs = baseAbs >>> 0;
  let step = INITIAL_STEP_BYTES;

  for (let iter = 0; iter < ITERATION_CAP; iter++) {
    const word = readAbsWordBE(state, rom, probeAbs);

    if (target === word) {
      // Match: D0 = (A2 - A0) >> 1 after 32-bit wrapping subtraction.
      return ((probeAbs - baseAbs) >>> 0) >>> 1;
    }

    // Branches: target < word subtracts step; target > word adds step.
    if (target < word) {
      probeAbs = (probeAbs - step) >>> 0;
    } else {
      probeAbs = (probeAbs + step) >>> 0;
    }

    // Clamp (cmpa.l ... bcc):
    //   if (A1 < A2 unsigned)  A2 = A1   (clamp top)
    //   else if (A2 < A0 unsigned) A2 = A0   (clamp bot)
    // These branches are mutually exclusive when base <= end.
    if (endAbs < probeAbs) {
      probeAbs = endAbs;
    } else if (probeAbs < baseAbs) {
      probeAbs = baseAbs;
    }

    // Halve step.
    step = step >>> 1;
  }

  // Cap reached: the ROM would be in an infinite loop here.
  return ((probeAbs - baseAbs) >>> 0) >>> 1;
}

/** Re-export the symbol under the ROM routine name for cross-reference. */
export { bsearchTable1ABD4 as FUN_0001ABD4 };
