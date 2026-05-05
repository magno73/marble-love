/**
 * proximity-check.ts — `FUN_000193D8` (136 byte): check obj proximity to (x,y).
 *
 * Loop 9 entry @ 0x401890 stride 0x28. Per ogni entry:
 *   - if entry == exclude_ptr (D3): skip
 *   - if byte+0x18 == 0: skip
 *   - if byte+0x1A == 2: skip
 *   - compute |entry.xpos - x|, |entry.ypos - y|
 *   - if both abs distances < 0xC: return 1 (close match found)
 * Returns 0 if no match.
 */

import type { GameState } from "./state.js";

function readW(s: GameState, off: number): number {
  return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
}

const ARRAY_BASE = 0x1890; // 0x401890
const STRIDE = 0x28;

function absWord(w: number): number {
  // Word abs via signed (matches `tst.w; bge skip; neg.l; ...`)
  if (w & 0x8000) {
    // signed negative
    const neg = w === 0x8000 ? 0x8000 : ((-(w - 0x10000)) & 0xffff);
    return neg;
  }
  return w;
}

export function proximityCheckArray(state: GameState, excludePtr: number, xWord: number, yWord: number): number {
  for (let i = 0; i < 9; i++) {
    const entryAddr = (0x401890 + i * STRIDE) >>> 0;
    if (excludePtr === entryAddr) continue;
    const off = ARRAY_BASE + i * STRIDE;
    if ((state.workRam[off + 0x18] ?? 0) === 0) continue;
    if ((state.workRam[off + 0x1A] ?? 0) === 2) continue;
    // dx = entry.xpos.w - x.w (word sub)
    const xPos = readW(state, off + 0xC);
    const yPos = readW(state, off + 0x10);
    const dx = (xPos - (xWord & 0xffff)) & 0xffff;
    const dy = (yPos - (yWord & 0xffff)) & 0xffff;
    const dxAbs = absWord(dx);
    const dyAbs = absWord(dy);
    // bls: branch if 0xC <= D6 unsigned → skip. So we want D6 < 0xC for match.
    if (dxAbs >= 0xC) continue;
    if (dyAbs >= 0xC) continue;
    return 1;
  }
  return 0;
}
