/**
 * object-compare.ts — `FUN_00015FE6` (118 byte): compare 2 obj depth.
 *
 * Returns 1 when obj1 wins over obj2 in depth comparison, otherwise 0.
 * Compares byte +0x1B (z-order layer):
 *   - Equal z: compare the sum of `(long >> 19)` for +0xC and +0x10.
 *   - Different z: return 1 when obj2.1B < obj1.1B, meaning obj1 is above.
 */

import type { GameState } from "./state.js";

function readU32Signed(state: GameState, off: number): number {
  const v =
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>> 0;
  return v >= 0x80000000 ? v - 0x100000000 : v;
}

export function compareObjDepth(state: GameState, obj1Addr: number, obj2Addr: number): number {
  const r = state.workRam;
  const o1 = obj1Addr - 0x400000;
  const o2 = obj2Addr - 0x400000;

  if ((r[o1 + 0x18] ?? 0) !== 1) return 0;
  if ((r[o2 + 0x18] ?? 0) !== 1) return 0;

  const z1 = r[o1 + 0x1B] ?? 0;
  const z2 = r[o2 + 0x1B] ?? 0;

  if (z1 === z2) {
    // Sum (long >> 19) word of +0x10 + (long >> 19) word of +0xC for each
    const v1_10 = (readU32Signed(state, o1 + 0x10) >> 19) & 0xffff;
    const v1_0c = (readU32Signed(state, o1 + 0xC) >> 19) & 0xffff;
    const v1_10s = v1_10 & 0x8000 ? v1_10 - 0x10000 : v1_10;
    const v1_0cs = v1_0c & 0x8000 ? v1_0c - 0x10000 : v1_0c;
    const d3w = (v1_10s + v1_0cs) & 0xffff;
    const d3 = d3w & 0x8000 ? d3w - 0x10000 : d3w;

    const v2_10 = (readU32Signed(state, o2 + 0x10) >> 19) & 0xffff;
    const v2_0c = (readU32Signed(state, o2 + 0xC) >> 19) & 0xffff;
    const v2_10s = v2_10 & 0x8000 ? v2_10 - 0x10000 : v2_10;
    const v2_0cs = v2_0c & 0x8000 ? v2_0c - 0x10000 : v2_0c;
    const d4w = (v2_10s + v2_0cs) & 0xffff;
    const d4 = d4w & 0x8000 ? d4w - 0x10000 : d4w;

    // ble: branch if D3 <= D4 → return 0. Else: return 1.
    return d3 > d4 ? 1 : 0;
  } else {
    // cmp.b src=(A1+0x1B), dest=D0(=A0+0x1B) → D0 - (A1+0x1B) = obj2.1B - obj1.1B
    // bge: signed >= 0 → obj2 >= obj1 → skip (return 0).
    // Don't branch (D2=1) if obj2 < obj1 signed.
    const z1Signed = z1 & 0x80 ? z1 - 0x100 : z1;
    const z2Signed = z2 & 0x80 ? z2 - 0x100 : z2;
    return z2Signed < z1Signed ? 1 : 0;
  }
}
