import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import {
  ABS_LONG_1216A_ADDR,
  ALPHA_TILE_WORD_WRITE_383A_ADDR,
  PALETTE_INIT_565A_ADDR,
  absLong1216A,
  alphaTileWordWrite383A,
  paletteInit565A,
} from "../src/mini-helpers.js";

describe("FUN_1216A absLong1216A", () => {
  it("expone l'address del binario", () => {
    expect(ABS_LONG_1216A_ADDR).toBe(0x1216a);
  });

  it("positivo invariato", () => {
    expect(absLong1216A(42)).toBe(42);
    expect(absLong1216A(0)).toBe(0);
  });

  it("negativo negato", () => {
    expect(absLong1216A(-42)).toBe(42);
    expect(absLong1216A(-1)).toBe(1);
  });

  it("INT32_MIN edge case", () => {
    expect(absLong1216A(-2147483648)).toBe(-2147483648);
  });
});

describe("FUN_383A alphaTileWordWrite383A", () => {
  it("expone l'address del binario", () => {
    expect(ALPHA_TILE_WORD_WRITE_383A_ADDR).toBe(0x383a);
  });

  it("scrive word @ alphaRam[tileIndex*2]", () => {
    const s = emptyGameState();
    alphaTileWordWrite383A(s, 5, 0xcafe);
    expect(s.alphaRam[10]).toBe(0xca);
    expect(s.alphaRam[11]).toBe(0xfe);
  });

  it("tileIndex 0 → write @ alphaRam[0]", () => {
    const s = emptyGameState();
    alphaTileWordWrite383A(s, 0, 0x1234);
    expect(s.alphaRam[0]).toBe(0x12);
    expect(s.alphaRam[1]).toBe(0x34);
  });

  it("masking del word arg", () => {
    const s = emptyGameState();
    alphaTileWordWrite383A(s, 3, 0xfffff5);
    expect(s.alphaRam[6]).toBe(0xff);
    expect(s.alphaRam[7]).toBe(0xf5);
  });

  it("tileIndex out-of-range → no-op", () => {
    const s = emptyGameState();
    s.alphaRam[0] = 0x42;
    alphaTileWordWrite383A(s, 0xffff, 0xffff);
    expect(s.alphaRam[0]).toBe(0x42);
  });
});

describe("FUN_565A paletteInit565A", () => {
  it("expone l'address del binario", () => {
    expect(PALETTE_INIT_565A_ADDR).toBe(0x565a);
  });

  it("copia 8 word ROM[0x7B18] → colorRam[0..0xF]", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    for (let i = 0; i < 8; i++) {
      rom.program[0x7b18 + i * 2] = 0x10 + i;
      rom.program[0x7b18 + i * 2 + 1] = 0x20 + i;
    }
    paletteInit565A(s, rom);
    for (let i = 0; i < 8; i++) {
      expect(s.colorRam[i * 2]).toBe(0x10 + i);
      expect(s.colorRam[i * 2 + 1]).toBe(0x20 + i);
    }
  });

  it("clear colorRam[0x400..0x401]", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.colorRam[0x400] = 0xff;
    s.colorRam[0x401] = 0xff;
    paletteInit565A(s, rom);
    expect(s.colorRam[0x400]).toBe(0);
    expect(s.colorRam[0x401]).toBe(0);
  });

  it("colorRam[0x10..0x3FF] non toccato", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.colorRam[0x10] = 0x42;
    s.colorRam[0x100] = 0x73;
    paletteInit565A(s, rom);
    expect(s.colorRam[0x10]).toBe(0x42);
    expect(s.colorRam[0x100]).toBe(0x73);
  });
});
