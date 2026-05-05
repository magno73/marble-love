/**
 * obj-pick-larger.ts — `FUN_000180BE` (156 byte): pick obj with larger |x|+|y|.
 *
 * Compute |obj1.0xC6| + |obj1.0xC7| vs |obj2.0xC6| + |obj2.0xC7|
 * (signed bytes). Whichever is larger, write its bytes to globals
 * 0x4006AA (= 0xC6) and 0x4006A8 (= 0xC7).
 *
 * obj1 @ 0x400018, obj2 @ 0x4000FA.
 */

import type { GameState } from "./state.js";

const OBJ1_OFF = 0x18; // 0x400018
const OBJ2_OFF = 0xfa; // 0x4000FA

function absByteSigned(b: number): number {
  const s = b & 0x80 ? b - 0x100 : b;
  return s < 0 ? -s : s;
}

export function pickObjLarger(state: GameState): void {
  const r = state.workRam;
  const a_c6 = r[OBJ1_OFF + 0xC6] ?? 0;
  const a_c7 = r[OBJ1_OFF + 0xC7] ?? 0;
  const b_c6 = r[OBJ2_OFF + 0xC6] ?? 0;
  const b_c7 = r[OBJ2_OFF + 0xC7] ?? 0;
  const sumA = absByteSigned(a_c6) + absByteSigned(a_c7);
  const sumB = absByteSigned(b_c6) + absByteSigned(b_c7);
  // blt: if sumA < sumB signed → branch (use B). Else (sumA >= sumB) use A.
  if (sumA < sumB) {
    r[0x6aa] = b_c6;
    r[0x6a8] = b_c7;
  } else {
    r[0x6aa] = a_c6;
    r[0x6a8] = a_c7;
  }
}
