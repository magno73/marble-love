/**
 * init-helpers.ts — piccole utility init/copy/transform.
 *
 * - **FUN_11AC2 (22 byte)** — `copyRomToWorkram66Words()`: copia 66 word
 *   da ROM 0x1D370 a workRam 0x40076E.
 * - **FUN_26B10 (26 byte)** — `copyRomToPalette32Words()`: copia 32 word
 *   da ROM 0x1FBD0 a palette RAM 0xB00000.
 * - **FUN_1286E (24 byte)** — `negateXYSwap(ptr)`: scambia (x, y) e nega
 *   entrambi: result.x = -y_old, result.y = -x_old.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

export function copyRomToWorkram66Words(state: GameState, rom: RomImage): void {
  // 0x42 (66) word loop via dbf #0x41 (= 66 iterations)
  const SRC = 0x1d370;
  const DST = 0x76e; // 0x40076E
  for (let i = 0; i < 66; i++) {
    state.workRam[DST + i * 2] = rom.program[SRC + i * 2] ?? 0;
    state.workRam[DST + i * 2 + 1] = rom.program[SRC + i * 2 + 1] ?? 0;
  }
}

export function copyRomToPalette32Words(state: GameState, rom: RomImage): void {
  // 0x20 (32) word loop
  const SRC = 0x1fbd0;
  for (let i = 0; i < 32; i++) {
    state.colorRam[i * 2] = rom.program[SRC + i * 2] ?? 0;
    state.colorRam[i * 2 + 1] = rom.program[SRC + i * 2 + 1] ?? 0;
  }
}

export function negateXYSwap(state: GameState, ptr: number): void {
  // *A0 = -(*A0+4); *(A0+4) = -(*A0)  (with intermediate save)
  const off = ptr - 0x400000;
  const r = state.workRam;
  const x = (((r[off] ?? 0) << 24) | ((r[off + 1] ?? 0) << 16) | ((r[off + 2] ?? 0) << 8) | (r[off + 3] ?? 0)) >>> 0;
  const y = (((r[off + 4] ?? 0) << 24) | ((r[off + 5] ?? 0) << 16) | ((r[off + 6] ?? 0) << 8) | (r[off + 7] ?? 0)) >>> 0;
  // Compute negated (M68k neg.l: 0x80000000 stays 0x80000000)
  const negY = y === 0x80000000 ? 0x80000000 : (((-y) | 0) >>> 0);
  const negX = x === 0x80000000 ? 0x80000000 : (((-x) | 0) >>> 0);
  // Write: *A0 = neg(y), *(A0+4) = neg(x)
  r[off] = (negY >>> 24) & 0xff;
  r[off + 1] = (negY >>> 16) & 0xff;
  r[off + 2] = (negY >>> 8) & 0xff;
  r[off + 3] = negY & 0xff;
  r[off + 4] = (negX >>> 24) & 0xff;
  r[off + 5] = (negX >>> 16) & 0xff;
  r[off + 6] = (negX >>> 8) & 0xff;
  r[off + 7] = negX & 0xff;
}
