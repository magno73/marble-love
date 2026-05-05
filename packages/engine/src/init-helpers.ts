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

/**
 * Replica `FUN_0001A41E` — palette init level: copy 192 words ROM→palette[0x400..0x57F]
 * + call paletteInit (FUN_26B10).
 *
 * The disasm uses indirect ptrs from ROM 0x24694 but those simply form a table
 * pointing at palette[0x400..0x57F] in 2-byte stride.
 */
export function paletteInitLevel(state: GameState, rom: RomImage): void {
  // 192 words from ROM 0x24514 → palette via ptr table @ 0x24694
  for (let i = 0; i < 192; i++) {
    const ptrAddr = 0x24694 + i * 4;
    const dstAbs =
      (((rom.program[ptrAddr] ?? 0) << 24) |
        ((rom.program[ptrAddr + 1] ?? 0) << 16) |
        ((rom.program[ptrAddr + 2] ?? 0) << 8) |
        (rom.program[ptrAddr + 3] ?? 0)) >>> 0;
    const dstOff = (dstAbs - 0xb00000) >>> 0;
    if (dstOff >= 0x800) continue; // out of palette range
    const srcOff = 0x24514 + i * 2;
    state.colorRam[dstOff] = rom.program[srcOff] ?? 0;
    state.colorRam[dstOff + 1] = rom.program[srcOff + 1] ?? 0;
  }
  // Then FUN_26B10
  const SRC = 0x1fbd0;
  for (let i = 0; i < 32; i++) {
    state.colorRam[i * 2] = rom.program[SRC + i * 2] ?? 0;
    state.colorRam[i * 2 + 1] = rom.program[SRC + i * 2 + 1] ?? 0;
  }
}

/**
 * Replica `FUN_000031D0` — `gameStateMachineInit()`.
 *
 * Init logic:
 *   - rotation flag = (ROM[0x10072] != 0 AND ROM[0x10000..0x10001].w == 0x4EF9) ? 1 : 0
 *   - Clear globals 0x401F00, 0x401F02, 0x401F3A, 0x401F3C, 0x401F3E
 *   - Clear 4 slot state bytes (0x401F1C..1F1F) and 4 data ptrs (0x401F04..1F13)
 *   - Clear alpha RAM 0xA03000..0xA03EFF (3840 byte = 0xF00)
 */
export function gameStateMachineInit(state: GameState, rom: RomImage): void {
  // rotation flag: ROM byte at 0x10072 (truthy?) AND ROM word at 0x10000 == 0x4EF9
  const b72 = rom.program[0x10072] ?? 0;
  const w0 = ((rom.program[0x10000] ?? 0) << 8) | (rom.program[0x10001] ?? 0);
  const rotFlag = (b72 !== 0 && w0 === 0x4EF9) ? 1 : 0;
  state.workRam[0x1f42] = (rotFlag >>> 8) & 0xff;
  state.workRam[0x1f43] = rotFlag & 0xff;
  // Clear 5 word globals
  for (const off of [0x1f00, 0x1f02, 0x1f3a, 0x1f3c, 0x1f3e]) {
    state.workRam[off] = 0;
    state.workRam[off + 1] = 0;
  }
  // Clear 4 slot state bytes
  for (let i = 0; i < 4; i++) {
    state.workRam[0x1f1c + i] = 0;
  }
  // Clear 4 data ptr longs
  for (let i = 0; i < 4; i++) {
    const off = 0x1f04 + i * 4;
    state.workRam[off] = 0;
    state.workRam[off + 1] = 0;
    state.workRam[off + 2] = 0;
    state.workRam[off + 3] = 0;
  }
  // Clear alpha RAM 0xA03000..0xA03EFF (note: word loop until 0xA03F00, so writes 0..0xEFE in word boundaries)
  // Disasm: clr.w (A0)+ until A0 >= 0xA03F00 unsigned
  // So clears words at 0..0xEFE inclusive (0xF00 bytes total)
  for (let i = 0; i < 0xF00; i++) {
    state.alphaRam[i] = 0;
  }
}

/**
 * Replica `FUN_00001CEA` — `paletteRamInitFull()`.
 *
 * 2 loops:
 *   1. 256 iter: copy word from ROM[0x6A36 + i*4] to palette+0x200, +0x400, +0x600
 *   2. 16 iter: copy word from ROM[0x6E34 + i*2] to palette[0..0x1F]
 */
export function paletteRamInitFull(state: GameState, rom: RomImage): void {
  // Loop 1: 256 entries
  for (let i = 0; i < 256; i++) {
    const idx = 0x6a34 + 2 + i * 4; // ROM[base + 2 + i*4]
    const w = ((rom.program[idx] ?? 0) << 8) | (rom.program[idx + 1] ?? 0);
    // Write to 3 palette regions
    for (const baseOff of [0x200, 0x400, 0x600]) {
      state.colorRam[baseOff + i * 2] = (w >>> 8) & 0xff;
      state.colorRam[baseOff + i * 2 + 1] = w & 0xff;
    }
  }
  // Loop 2: 16 entries from 0x6E34
  for (let i = 0; i < 16; i++) {
    const idx = 0x6e34 + i * 2;
    const w = ((rom.program[idx] ?? 0) << 8) | (rom.program[idx + 1] ?? 0);
    state.colorRam[i * 2] = (w >>> 8) & 0xff;
    state.colorRam[i * 2 + 1] = w & 0xff;
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
