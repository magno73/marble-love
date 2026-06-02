/**
 * state-sub-50f4.test.ts — smoke tests of stateSub50F4 (FUN_50F4).
 *
 *   - 10 byte copied dto the input ai 10 byte of output (offsets 6,A,C,E,12,...,1C)
 *   - syndromi all zero → return 0, no mutation counter
 *   - syndrome non-zero → return 1 (correzione) o 0x80000001 (uncorrectable)
 *   - counter long-BE incremented a A2[0x11..0x12]
 *   - epilogue: D2 += 1, D3 += 1
 */

import { describe, it, expect } from "vitest";
import {
  stateSub50F4,
  CORRECTION_TABLE,
  ITER_BYTE_OFFSETS,
  OUTPUT_BYTE_COUNT,
  UNCORRECTABLE_FLAG,
  COUNTER_HI_OFFSET,
  COUNTER_LO_OFFSET,
} from "../src/state-sub-50f4.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const A2_BASE = 0x00400100; // workRam offset 0x100
const A3_ROM_BASE = 0x00010000; // ROM offset 0x10000

describe("stateSub50F4 (FUN_50F4)", () => {
  it("copies 10 byte dto the input agli output offset corretti", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    const inputBytes: number[] = [];
    for (let i = 0; i < 30; i++) {
      const v = (i * 17) & 0xff;
      rom.program[A3_ROM_BASE + i] = v;
      inputBytes.push(v);
    }

    // arg: D3w=0 → output @ A2 + 0.
    const r = stateSub50F4(state, rom, A2_BASE, A3_ROM_BASE, 0, 0);

    // Output[i] = inputBytes[ITER_BYTE_OFFSETS[i]]
    for (let i = 0; i < OUTPUT_BYTE_COUNT; i++) {
      const expected = inputBytes[ITER_BYTE_OFFSETS[i]!]!;
      expect(r.outputBytes[i]).toBe(expected);
      // Anche workRam matches.
      expect(state.workRam[(A2_BASE - 0x400000) + i]).toBe(expected);
    }
  });

  it("syndromi zero → return 0, no mutation counter", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    // Build input that produces all-zero syndromes.
    // Init: D6b = ~A0[0] ^ A0[16] ^ A0[8] ^ A0[4] ^ A0[2]
    // Allora D6b = 0 ^ 0 ^ 0 ^ 0 ^ 0 = 0.
    rom.program[A3_ROM_BASE + 0x00] = 0xff;
    // Output[i] = 0 ovunque.

    const counterAddrLo = (A2_BASE + COUNTER_LO_OFFSET) - 0x400000;
    const counterAddrHi = (A2_BASE + COUNTER_HI_OFFSET) - 0x400000;
    state.workRam[counterAddrLo] = 0x00;
    state.workRam[counterAddrHi] = 0x00;

    const r = stateSub50F4(state, rom, A2_BASE, A3_ROM_BASE, 0, 0);

    expect(r.d0).toBe(0);
    expect(r.noError).toBe(true);
    expect(r.corrected).toBe(false);
    expect(r.uncorrectable).toBe(false);
    expect(r.counterAfter).toBe(0);
    expect(state.workRam[counterAddrLo]).toBe(0);
    expect(state.workRam[counterAddrHi]).toBe(0);
  });

  it("epilogue: D2 += 1, D3 += 1 (long)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    rom.program[A3_ROM_BASE + 0x00] = 0xff;

    // D2w=5, D3w=3 → return D2'=6, D3'=4.
    const r = stateSub50F4(state, rom, A2_BASE, A3_ROM_BASE, 5, 3);
    expect(r.d2Out).toBe(6);
    expect(r.d3Out).toBe(4);

    // D2w=0, D3w=0 → return 1, 1.
    const r2 = stateSub50F4(state, rom, A2_BASE, A3_ROM_BASE, 0, 0);
    expect(r2.d2Out).toBe(1);
    expect(r2.d3Out).toBe(1);
  });

  it("D2w/D3w: row stride 30/10 (input=A3+D2w*30, output=A2+D3w*10)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    for (let i = 0; i < 30; i++) {
      rom.program[A3_ROM_BASE + 30 + i] = (i + 1) & 0xff;
    }

    // D2w=1, D3w=2 → output @ A2 + 20.
    const r = stateSub50F4(state, rom, A2_BASE, A3_ROM_BASE, 1, 2);

    for (let i = 0; i < OUTPUT_BYTE_COUNT; i++) {
      const expected = (ITER_BYTE_OFFSETS[i]! + 1) & 0xff;
      expect(r.outputBytes[i]).toBe(expected);
      expect(state.workRam[(A2_BASE - 0x400000) + 20 + i]).toBe(expected);
    }
  });

  it("syndrome non-zero con bit 4 unset → uncorrectable (D0 = 0x80000001)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    // To trigger uncorrectable, syndrome LSBs must make the first bit-iter
    // produce D0w != 0 with bit 4 (0x10) clear. D0w bit 4
    // = 1.
    //
    // Init: D6b = 0x01 ^ 0 ^ 0 ^ 0 ^ 0 = 0x01.
    // Inner loop: byte = 0 ovunque → D2..D6 invariati.
    // D6b = 0x01 (LSB=1), D2b..D5b = 0 (LSB=0).
    // Bit-iter 1: lsbD6=1, lsbD5=0, lsbD4=0, lsbD3=0, lsbD2=0.
    // D0w = (1 << 4) | 0 | 0 | 0 | 0 = 0x10. Bit 4 set → look up table[0].
    //
    // Setup: D2b LSB = 1, D6b LSB = 0.
    // Init D6b = ~A0[0] ^ A0[16] ^ A0[8] ^ A0[4] ^ A0[2].
    // D2b = A0[2]. Inner loop: D2b XOR'd with bytes for table values with bit 0 set:
    //   table = [3,5,6,7,9,10,11,12,13,14], bit 0 set: 3,5,7,9,11,13 (offsets 6,10,14,18,22,26).
    //
    //   D2b = 1, D3b=0, D4b=0, D5b=0, D6b = ~0 ^ 0 ^ 0 ^ 0 ^ 1 = 0xFE.
    //   D6b LSB = 0. D2b LSB = 1.
    //
    // Bit-iter 1: lsbD6=0, lsbD5=0, lsbD4=0, lsbD3=0, lsbD2=1.
    // D0w = (0<<4)|(0<<3)|(0<<2)|(0<<1)|1 = 1. Bit 4 NOT set → UNCORRECTABLE.
    rom.program[A3_ROM_BASE + 0x02] = 0x01;

    const r = stateSub50F4(state, rom, A2_BASE, A3_ROM_BASE, 0, 0);

    expect(r.uncorrectable).toBe(true);
    expect((r.d0 & UNCORRECTABLE_FLAG) >>> 0).toBe(UNCORRECTABLE_FLAG);
    expect(r.d0 & 0xff).toBe(0x01);
    expect(r.d0 >>> 0).toBe(0x80000001 >>> 0);
  });

  it("counter A2[0x11..0x12] incremented per syndrome non-zero", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    // Setup as uncorrectable test: D6b=0xFE, D2b=1.
    // Bit-iter 1: D0w=1 (non-zero) → increment counter.
    // Bit-iter 2..8: i bit of D6b (0xFE = 0b11111110) shifted out:
    //   iter 1 LSB(D6b)=0, iter 2 LSB=1, iter 3 LSB=1, ... iter 8 LSB=1.
    //   D0w iter 2 = (1<<4)|0|0|0|0 = 0x10 → bit 4 set, lookup table[0]=0xFF → no correction.
    //
    rom.program[A3_ROM_BASE + 0x02] = 0x01;

    const r = stateSub50F4(state, rom, A2_BASE, A3_ROM_BASE, 0, 0);

    expect(r.counterAfter).toBeGreaterThanOrEqual(1);
    const counterAddrLo = (A2_BASE + COUNTER_LO_OFFSET) - 0x400000;
    expect(state.workRam[counterAddrLo]).toBeGreaterThanOrEqual(1);
  });

  it("CORRECTION_TABLE costante valida (16 byte, 0xFF per indici non-correggibili)", () => {
    expect(CORRECTION_TABLE).toHaveLength(16);
    // Entries note: 0xFF, 0xFF, 0xFF, 0x00, 0xFF, 0x01, ...
    expect(CORRECTION_TABLE[0]).toBe(0xff);
    expect(CORRECTION_TABLE[3]).toBe(0x00);
    expect(CORRECTION_TABLE[5]).toBe(0x01);
    expect(CORRECTION_TABLE[15]).toBe(0xff);
  });

  it("output buffer ha exactly 10 byte", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const r = stateSub50F4(state, rom, A2_BASE, A3_ROM_BASE, 0, 0);
    expect(r.outputBytes).toHaveLength(OUTPUT_BYTE_COUNT);
  });
});
