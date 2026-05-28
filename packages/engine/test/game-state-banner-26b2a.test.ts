import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import {
  GAME_STATE_BANNER_26B2A_ADDR,
  PALETTE_COPY_26B10_ADDR,
  paletteCopy26B10,
  gameStateBanner26B2A,
} from "../src/game-state-banner-26b2a.js";

function writeRomWord(
  rom: ReturnType<typeof emptyRomImage>,
  off: number,
  value: number,
): void {
  rom.program[off] = (value >>> 8) & 0xff;
  rom.program[off + 1] = value & 0xff;
}
function writeRomLong(
  rom: ReturnType<typeof emptyRomImage>,
  off: number,
  value: number,
): void {
  rom.program[off] = (value >>> 24) & 0xff;
  rom.program[off + 1] = (value >>> 16) & 0xff;
  rom.program[off + 2] = (value >>> 8) & 0xff;
  rom.program[off + 3] = value & 0xff;
}

describe("FUN_26B10 paletteCopy26B10", () => {
  it("expone l'address del binario", () => {
    expect(PALETTE_COPY_26B10_ADDR).toBe(0x26b10);
  });

  it("copia 32 word (64 byte) ROM[0x1FBD0] → colorRam[0..0x3F]", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    for (let i = 0; i < 32; i++) {
      writeRomWord(rom, 0x1fbd0 + i * 2, 0x1000 + i);
    }
    paletteCopy26B10(state, rom);
    for (let i = 0; i < 32; i++) {
      const dst = i * 2;
      const expected = 0x1000 + i;
      const got = (state.colorRam[dst] << 8) | (state.colorRam[dst + 1] ?? 0);
      expect(got).toBe(expected);
    }
    // colorRam[0x40..] not touched.
    expect(state.colorRam[0x40]).toBe(0);
  });
});

describe("FUN_26B2A gameStateBanner26B2A", () => {
  it("expone l'address del binario", () => {
    expect(GAME_STATE_BANNER_26B2A_ADDR).toBe(0x26b2a);
  });

  it("scrive 195 word scatter da ROM[banner+mode*0x186] verso destinazioni in workRam", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    // Setup 195 dest pointers all pointing into workRam @ 0x400100, 0x400102, ...
    for (let i = 0; i < 195; i++) {
      writeRomLong(rom, 0x20534 + i * 4, 0x00400100 + i * 2);
    }
    // Banner mode 0 src @ 0x1FC10 with marker values.
    for (let i = 0; i < 195; i++) {
      writeRomWord(rom, 0x1fc10 + i * 2, 0xa000 + i);
    }
    // ROM colorPalette ROM source for FUN_26B10
    for (let i = 0; i < 32; i++) {
      writeRomWord(rom, 0x1fbd0 + i * 2, 0xb000 + i);
    }

    gameStateBanner26B2A(state, rom, 0);

    // 195 word a workRam[0x100..] = ROM banner data
    for (let i = 0; i < 195; i++) {
      const expected = 0xa000 + i;
      const off = 0x100 + i * 2;
      const got = (state.workRam[off] << 8) | (state.workRam[off + 1] ?? 0);
      expect(got).toBe(expected);
    }
    // 32 word a colorRam[0..0x3F] = palette copy
    for (let i = 0; i < 32; i++) {
      const expected = 0xb000 + i;
      const got = (state.colorRam[i * 2] << 8) | (state.colorRam[i * 2 + 1] ?? 0);
      expect(got).toBe(expected);
    }
  });

  it("mode != 0 usa offset diverso da BANNER_ROM_BASE", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    // Setup all dest ptrs → workRam[0x200..] (single-word entry)
    for (let i = 0; i < 195; i++) {
      writeRomLong(rom, 0x20534 + i * 4, 0x00400200 + i * 2);
    }
    // Banner mode 1: src @ 0x1FC10 + 0x186
    writeRomWord(rom, 0x1fc10 + 0x186, 0xcafe);
    writeRomWord(rom, 0x1fc10 + 0x186 + 0xc2 * 2, 0xface);

    gameStateBanner26B2A(state, rom, 1);

    expect((state.workRam[0x200] << 8) | (state.workRam[0x201] ?? 0)).toBe(0xcafe);
    expect((state.workRam[0x200 + 0xc2 * 2] << 8) | (state.workRam[0x200 + 0xc2 * 2 + 1] ?? 0)).toBe(0xface);
  });

  it("dest ptr in alphaRam scrive in state.alphaRam", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    for (let i = 0; i < 195; i++) {
      writeRomLong(rom, 0x20534 + i * 4, 0x00a03000 + i * 2);
    }
    writeRomWord(rom, 0x1fc10, 0xbeef);
    gameStateBanner26B2A(state, rom, 0);
    expect((state.alphaRam[0] << 8) | (state.alphaRam[1] ?? 0)).toBe(0xbeef);
    expect(state.workRam[0]).toBe(0); // workRam non toccato
  });
});
