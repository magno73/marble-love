/**
 * mini-helpers.ts — replica di 3 funzioni leaf/small residue:
 *   - FUN_0001216A: abs(arg) signed-32 (alias di FUN_1B5A6)
 *   - FUN_0000383A: alpha-tile word write
 *   - FUN_0000565A: palette init (8 word ROM→colorRam + clear @0x400)
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

export const ABS_LONG_1216A_ADDR = 0x0001216a as const;
export const ALPHA_TILE_WORD_WRITE_383A_ADDR = 0x0000383a as const;
export const PALETTE_INIT_565A_ADDR = 0x0000565a as const;

/**
 * Replica `FUN_0001216A` — abs(arg) signed-32.
 *
 *   move.l (0x4,SP),D0
 *   bpl skip          ; if D0 >= 0 → exit
 *   neg.l D0
 *   skip: rts
 *
 * Identical a `FUN_1B5A6` (in abs-helpers.ts) ma con address diverso.
 * Mantenuto separato per parity completeness.
 */
export function absLong1216A(arg: number): number {
  const a = arg | 0;
  return a < 0 ? (-a | 0) : a;
}

/**
 * Replica `FUN_0000383A` — alpha-tile word write.
 *
 *   D0.l = (0x4,SP).l   ; tile index (long)
 *   D1.w = (0xA,SP).w   ; tile data word
 *   A0 = 0xA03000        ; alphaRam base
 *   A0 += D0 * 2         ; offset = tileIndex * 2
 *   *(A0).w = D1.w
 *
 * Equivale a `state.alphaRam[tileIndex*2..*2+1] = data` (big-endian word).
 */
export function alphaTileWordWrite383A(
  state: GameState,
  tileIndex: number,
  data: number,
): void {
  const off = ((tileIndex >>> 0) * 2) | 0;
  if (off < 0 || off + 1 >= state.alphaRam.length) return;
  state.alphaRam[off] = (data >>> 8) & 0xff;
  state.alphaRam[off + 1] = data & 0xff;
}

/**
 * Replica `FUN_0000565A` — palette init: copia 8 word da ROM[0x7B18] in
 * colorRam[0..0xF], poi clear word @ colorRam[0x400] (per quel slot).
 *
 *   A1 = 0xB00000 (colorRam base)
 *   A2 = 0x7B18 (ROM source)
 *   D2 = A1; D2 += 0x400; A0 = D2
 *   *(A0).w = 0       ; clear colorRam[0x400]
 *   D1 = 0
 *   loop: *(A1)+ = (A2)+      ; copy word
 *         D1++
 *         while D1 < 8
 *   rts
 */
export function paletteInit565A(state: GameState, rom: RomImage): void {
  // Clear colorRam[0x400] word (= colorRam offset 0x400 = palette slot)
  state.colorRam[0x400] = 0;
  state.colorRam[0x401] = 0;

  // Copy 8 word ROM[0x7B18..0x7B27] → colorRam[0..0xF]
  for (let i = 0; i < 8; i++) {
    const src = 0x7b18 + i * 2;
    const dst = i * 2;
    state.colorRam[dst] = rom.program[src] ?? 0;
    state.colorRam[dst + 1] = rom.program[src + 1] ?? 0;
  }
}
