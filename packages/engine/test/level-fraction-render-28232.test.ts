/**
 * Test levelFractionRender28232 (FUN_00028232) — smoke test on the main branches.
 *
 * mode selector, level idx and level number from workRam, dispatches 5
 * workRam @ 0x42A.
 *
 * `cli/src/test-level-fraction-render-28232-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  levelFractionRender28232,
  defaultInitStructHeader,
  FUN_28232_ADDR,
  MODE_SELECTOR_OFF,
  LEVEL_IDX_OFF,
  LEVEL_NUM_OFF,
  STRUCT_BASE_OFF,
  FRACTION_PTR_OFF,
  ROM_TABLE1_ADDR,
  ROM_TABLE2_ADDR,
  ROM_ENTRY_228CA,
  ROM_ENTRY_228D6,
  MODE_SELECTOR_ACTIVE,
  ATTR_ALT_1800,
  ATTR_BASE_3400,
  PALETTE_SHIFT,
  SENTINEL_NO_LEVEL,
  LEVEL_DIVISOR,
  RENDER_HELPER_ARG3,
  RENDER_HELPER_ARG4,
  RENDER_HELPER_ARG5,
  INIT_STRUCT_COL,
  INIT_STRUCT_TICKOFF,
  INIT_STRUCT_MARKER_OFF,
  FUN_28232_SUB_ADDRS,
} from "../src/level-fraction-render-28232.js";
import type { LevelFractionRender28232Subs } from "../src/level-fraction-render-28232.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { GameState } from "../src/state.js";
import type { RomImage } from "../src/bus.js";

function writeWordBE(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 8) & 0xff;
  ram[off + 1] = value & 0xff;
}

function writeLongBE(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 24) & 0xff;
  ram[off + 1] = (value >>> 16) & 0xff;
  ram[off + 2] = (value >>> 8) & 0xff;
  ram[off + 3] = value & 0xff;
}

function writeRomLongBE(rom: RomImage, addr: number, value: number): void {
  rom.program[addr] = (value >>> 24) & 0xff;
  rom.program[addr + 1] = (value >>> 16) & 0xff;
  rom.program[addr + 2] = (value >>> 8) & 0xff;
  rom.program[addr + 3] = value & 0xff;
}

/** Trace bag: records the 3 sub-calls for assertions. */
interface SubsTrace {
  renderChainCalls: Array<{ entryPtr: number; attrLong: number }>;
  initStructCalls: Array<{
    structPtr: number;
    colLong: number;
    tickOffLong: number;
  }>;
  renderHelperCalls: Array<{
    arg1: number;
    arg2: number;
    arg3: number;
    arg4: number;
    arg5: number;
    arg6: number;
  }>;
}

function makeTracingSubs(trace: SubsTrace): LevelFractionRender28232Subs {
  return {
    renderStringChain: (_s, entryPtr, attrLong) => {
      trace.renderChainCalls.push({ entryPtr, attrLong });
    },
    initStructHeader: (s, structPtr, colLong, tickOffLong) => {
      trace.initStructCalls.push({ structPtr, colLong, tickOffLong });
      defaultInitStructHeader(s, structPtr, colLong, tickOffLong);
    },
    renderStringHelper: (_s, a1, a2, a3, a4, a5, a6) => {
      trace.renderHelperCalls.push({
        arg1: a1, arg2: a2, arg3: a3, arg4: a4, arg5: a5, arg6: a6,
      });
    },
  };
}

function emptyTrace(): SubsTrace {
  return {
    renderChainCalls: [],
    initStructCalls: [],
    renderHelperCalls: [],
  };
}

/**
 */
function setupRom(): RomImage {
  const rom = emptyRomImage();
  // ROM table 1 @ 0x23C04: 8 long (idx+1 ∈ [1..8]).
  for (let i = 1; i <= 8; i++) {
    writeRomLongBE(rom, ROM_TABLE1_ADDR + i * 4, 0x10000000 | i);
  }
  // ROM table 2 @ 0x23C18: 8 long.
  for (let i = 1; i <= 8; i++) {
    writeRomLongBE(rom, ROM_TABLE2_ADDR + i * 4, 0x20000000 | i);
  }
  return rom;
}

/**
 *  Buffer target: workRam[bufOff..bufOff+4]. */
function setFractionBuffer(s: GameState, bufOff: number): void {
  // up to 0x1FFF (8 KB workRam). To actually write to workRam[bufOff],
  writeLongBE(s.workRam, FRACTION_PTR_OFF, 0x00400000 | bufOff);
}

describe("levelFractionRender28232 (FUN_00028232)", () => {
  it("D2==0, idx=0, no early-out: 4 renderStringChain + 1 helper + 1 initStruct + 1 finale (5 chain totali)", () => {
    const s = emptyGameState();
    const rom = setupRom();
    // mode selector != 2 → D2 = 0.
    writeWordBE(s.workRam, MODE_SELECTOR_OFF, 0);
    // level idx = 0 → idxScaled = (0+1)*4 = 4. ROM lookup @ 0x23C04+4 / 0x23C18+4.
    writeWordBE(s.workRam, LEVEL_IDX_OFF, 0);
    // level num = 0 → quotient=0, remainder=0 → default "    ".
    writeWordBE(s.workRam, LEVEL_NUM_OFF, 0);
    // fraction buffer @ workRam[0x100..0x104]
    setFractionBuffer(s, 0x100);

    const trace = emptyTrace();
    const subs = makeTracingSubs(trace);

    levelFractionRender28232(s, rom, subs);

    expect(trace.renderChainCalls).toHaveLength(5);
    // Step B: ROM_TABLE1[idx+1=1] = 0x10000001, attr=0x1800
    expect(trace.renderChainCalls[0]).toEqual({
      entryPtr: 0x10000001,
      attrLong: ATTR_ALT_1800,
    });
    // Step C: ROM_TABLE2[idx+1=1] = 0x20000001, attr=0x3400
    expect(trace.renderChainCalls[1]).toEqual({
      entryPtr: 0x20000001,
      attrLong: ATTR_BASE_3400,
    });
    // Step E: ROM_ENTRY_228CA, attr=0x1800
    expect(trace.renderChainCalls[2]).toEqual({
      entryPtr: ROM_ENTRY_228CA,
      attrLong: ATTR_ALT_1800,
    });
    // Step F: ROM_ENTRY_228D6, attr=0x3400
    expect(trace.renderChainCalls[3]).toEqual({
      entryPtr: ROM_ENTRY_228D6,
      attrLong: ATTR_BASE_3400,
    });
    // Step K: 0x400428, attr=0x3400
    expect(trace.renderChainCalls[4]).toEqual({
      entryPtr: 0x00400428,
      attrLong: ATTR_BASE_3400,
    });

    expect(trace.renderHelperCalls).toHaveLength(1);
    expect(trace.renderHelperCalls[0]).toEqual({
      arg1: 0, // ext_l(D4 = quot = 0)
      arg2: 0,
      arg3: RENDER_HELPER_ARG3,
      arg4: RENDER_HELPER_ARG4,
      arg5: RENDER_HELPER_ARG5,
      arg6: ATTR_BASE_3400,
    });

    expect(trace.initStructCalls).toHaveLength(1);
    expect(trace.initStructCalls[0]).toEqual({
      structPtr: 0x00400428,
      colLong: INIT_STRUCT_COL,
      tickOffLong: INIT_STRUCT_TICKOFF,
    });

    expect(s.workRam[STRUCT_BASE_OFF]).toBe(INIT_STRUCT_COL);
    expect(s.workRam[STRUCT_BASE_OFF + 1]).toBe(INIT_STRUCT_TICKOFF);
    expect(s.workRam[STRUCT_BASE_OFF + INIT_STRUCT_MARKER_OFF]).toBe(0);

    expect(s.workRam[0x100]).toBe(0x20);
    expect(s.workRam[0x101]).toBe(0x20);
    expect(s.workRam[0x102]).toBe(0x20);
    expect(s.workRam[0x103]).toBe(0x20);
    expect(s.workRam[0x104]).toBe(0x00);
  });

  it("D2!=0 (mode==2): skip 2 jsr condizionali → 3 renderStringChain (no Step B, no Step E)", () => {
    const s = emptyGameState();
    const rom = setupRom();
    // mode selector = 2 → D2 = 0x2000.
    writeWordBE(s.workRam, MODE_SELECTOR_OFF, MODE_SELECTOR_ACTIVE);
    writeWordBE(s.workRam, LEVEL_IDX_OFF, 0);
    writeWordBE(s.workRam, LEVEL_NUM_OFF, 0);
    setFractionBuffer(s, 0x100);

    const trace = emptyTrace();
    const subs = makeTracingSubs(trace);

    levelFractionRender28232(s, rom, subs);

    expect(trace.renderChainCalls).toHaveLength(3);
    // attr always = 0x3400 - 0x2000 = 0x1400
    const attrAlways = ATTR_BASE_3400 - PALETTE_SHIFT;
    // Step C: ROM_TABLE2[1], attr=0x1400
    expect(trace.renderChainCalls[0]).toEqual({
      entryPtr: 0x20000001,
      attrLong: attrAlways,
    });
    // Step F: ROM_ENTRY_228D6, attr=0x1400
    expect(trace.renderChainCalls[1]).toEqual({
      entryPtr: ROM_ENTRY_228D6,
      attrLong: attrAlways,
    });
    // Step K: 0x400428, attr=0x1400
    expect(trace.renderChainCalls[2]).toEqual({
      entryPtr: 0x00400428,
      attrLong: attrAlways,
    });

    // Helper invoked with arg6=0x1400.
    expect(trace.renderHelperCalls).toHaveLength(1);
    expect(trace.renderHelperCalls[0]?.arg6).toBe(attrAlways);
  });

  it("idx=-1 (sentinel): early-out dopo Step C (2 renderStringChain totali, no helper, no initStruct)", () => {
    const s = emptyGameState();
    const rom = setupRom();
    writeWordBE(s.workRam, MODE_SELECTOR_OFF, 0); // D2 = 0
    writeWordBE(s.workRam, LEVEL_IDX_OFF, SENTINEL_NO_LEVEL); // 0xFFFF
    writeWordBE(s.workRam, LEVEL_NUM_OFF, 0);
    setFractionBuffer(s, 0x100);

    // idx=0xFFFF: idxScaled = (0xFFFF+1)*4 mod 0x10000 = 0. Lookup @ ROM_TABLE1+0 / ROM_TABLE2+0.
    writeRomLongBE(rom, ROM_TABLE1_ADDR + 0, 0xdeadbeef);
    writeRomLongBE(rom, ROM_TABLE2_ADDR + 0, 0xcafebabe);

    const trace = emptyTrace();
    const subs = makeTracingSubs(trace);

    levelFractionRender28232(s, rom, subs);

    // 2 renderStringChain (Step B + Step C), then early-out.
    expect(trace.renderChainCalls).toHaveLength(2);
    expect(trace.renderChainCalls[0]).toEqual({
      entryPtr: 0xdeadbeef,
      attrLong: ATTR_ALT_1800,
    });
    expect(trace.renderChainCalls[1]).toEqual({
      entryPtr: 0xcafebabe,
      attrLong: ATTR_BASE_3400,
    });
    expect(trace.renderHelperCalls).toHaveLength(0);
    expect(trace.initStructCalls).toHaveLength(0);

    // workRam[0x428] not touched (remains 0).
    expect(s.workRam[STRUCT_BASE_OFF]).toBe(0);
    // Fraction buffer @ 0x100 not written.
    expect(s.workRam[0x100]).toBe(0);
  });

  it("dispatch fraction string: D3==3 → ' 1/4', D3==4 → ' 1/3', etc.", () => {
    // To obtain specific D3 (=remainder) values: levelNum % 12 = desired D3.
    const cases: Array<{
      levelNum: number;
      expectedRemainder: number;
      expectedBytes: [number, number, number, number]; // 4 byte (' ', + 3)
    }> = [
      { levelNum: 3, expectedRemainder: 3, expectedBytes: [0x20, 0x31, 0x2f, 0x34] },   // " 1/4"
      { levelNum: 4, expectedRemainder: 4, expectedBytes: [0x20, 0x31, 0x2f, 0x33] },   // " 1/3"
      { levelNum: 6, expectedRemainder: 6, expectedBytes: [0x20, 0x31, 0x2f, 0x32] },   // " 1/2"
      { levelNum: 8, expectedRemainder: 8, expectedBytes: [0x20, 0x32, 0x2f, 0x33] },   // " 2/3"
      { levelNum: 9, expectedRemainder: 9, expectedBytes: [0x20, 0x33, 0x2f, 0x34] },   // " 3/4"
      { levelNum: 1, expectedRemainder: 1, expectedBytes: [0x20, 0x20, 0x20, 0x20] },   // default
      { levelNum: 12, expectedRemainder: 0, expectedBytes: [0x20, 0x20, 0x20, 0x20] },  // 12%12=0
      { levelNum: 15, expectedRemainder: 3, expectedBytes: [0x20, 0x31, 0x2f, 0x34] },  // 15%12=3
    ];

    for (const tc of cases) {
      const s = emptyGameState();
      const rom = setupRom();
      writeWordBE(s.workRam, MODE_SELECTOR_OFF, 0);
      writeWordBE(s.workRam, LEVEL_IDX_OFF, 0);
      writeWordBE(s.workRam, LEVEL_NUM_OFF, tc.levelNum);
      setFractionBuffer(s, 0x200);

      const trace = emptyTrace();
      const subs = makeTracingSubs(trace);

      levelFractionRender28232(s, rom, subs);

      // Helper arg1 = quotient (level / 12).
      const expectedQuot = Math.trunc(tc.levelNum / LEVEL_DIVISOR);
      expect(
        trace.renderHelperCalls[0]?.arg1,
        `quotient for levelNum=${tc.levelNum}`,
      ).toBe(expectedQuot);

      expect(s.workRam[0x200], `byte 0 levelNum=${tc.levelNum}`).toBe(tc.expectedBytes[0]);
      expect(s.workRam[0x201], `byte 1 levelNum=${tc.levelNum}`).toBe(tc.expectedBytes[1]);
      expect(s.workRam[0x202], `byte 2 levelNum=${tc.levelNum}`).toBe(tc.expectedBytes[2]);
      expect(s.workRam[0x203], `byte 3 levelNum=${tc.levelNum}`).toBe(tc.expectedBytes[3]);
      // null terminator.
      expect(s.workRam[0x204], `null terminator levelNum=${tc.levelNum}`).toBe(0);
    }
  });

  it("default no-op subs: no eccezione; fraction string scritta inline; struct NOT scritto (initStructHeader no-op)", () => {
    const s = emptyGameState();
    const rom = setupRom();
    writeWordBE(s.workRam, MODE_SELECTOR_OFF, 0);
    writeWordBE(s.workRam, LEVEL_IDX_OFF, 0);
    writeWordBE(s.workRam, LEVEL_NUM_OFF, 6); // → " 1/2"
    setFractionBuffer(s, 0x300);

    // No subs → renderStringChain and renderStringHelper no-op,
    // initStructHeader no-op (struct not written). The 5 byte writes
    // of the fraction string are inline and still apply.
    expect(() => levelFractionRender28232(s, rom)).not.toThrow();

    expect(s.workRam[STRUCT_BASE_OFF]).toBe(0);
    expect(s.workRam[STRUCT_BASE_OFF + 1]).toBe(0);
    expect(s.workRam[STRUCT_BASE_OFF + INIT_STRUCT_MARKER_OFF]).toBe(0);

    expect(s.workRam[0x300]).toBe(0x20);
    expect(s.workRam[0x301]).toBe(0x31);
    expect(s.workRam[0x302]).toBe(0x2f);
    expect(s.workRam[0x303]).toBe(0x32);
    expect(s.workRam[0x304]).toBe(0x00);
  });

  it("defaultInitStructHeader: applicare la callback default produce le 3 byte writes attese", () => {
    const s = emptyGameState();
    const rom = setupRom();
    writeWordBE(s.workRam, MODE_SELECTOR_OFF, 0);
    writeWordBE(s.workRam, LEVEL_IDX_OFF, 0);
    writeWordBE(s.workRam, LEVEL_NUM_OFF, 6);
    setFractionBuffer(s, 0x300);

    levelFractionRender28232(s, rom, {
      initStructHeader: defaultInitStructHeader,
    });

    expect(s.workRam[STRUCT_BASE_OFF]).toBe(INIT_STRUCT_COL);
    expect(s.workRam[STRUCT_BASE_OFF + 1]).toBe(INIT_STRUCT_TICKOFF);
    expect(s.workRam[STRUCT_BASE_OFF + INIT_STRUCT_MARKER_OFF]).toBe(0);
  });

  it("costanti exposed: indirizzi binary corretti", () => {
    expect(FUN_28232_ADDR).toBe(0x00028232);
    expect(MODE_SELECTOR_OFF).toBe(0x392);
    expect(LEVEL_IDX_OFF).toBe(0x3de);
    expect(LEVEL_NUM_OFF).toBe(0x3ea);
    expect(STRUCT_BASE_OFF).toBe(0x428);
    expect(FRACTION_PTR_OFF).toBe(0x42a);
    expect(ROM_TABLE1_ADDR).toBe(0x00023c04);
    expect(ROM_TABLE2_ADDR).toBe(0x00023c18);
    expect(ROM_ENTRY_228CA).toBe(0x000228ca);
    expect(ROM_ENTRY_228D6).toBe(0x000228d6);
    expect(MODE_SELECTOR_ACTIVE).toBe(2);
    expect(ATTR_ALT_1800).toBe(0x1800);
    expect(ATTR_BASE_3400).toBe(0x3400);
    expect(PALETTE_SHIFT).toBe(0x2000);
    expect(SENTINEL_NO_LEVEL).toBe(0xffff);
    expect(LEVEL_DIVISOR).toBe(12);
    expect(RENDER_HELPER_ARG3).toBe(0x21);
    expect(RENDER_HELPER_ARG4).toBe(0x1c);
    expect(RENDER_HELPER_ARG5).toBe(2);
    expect(INIT_STRUCT_COL).toBe(0x23);
    expect(INIT_STRUCT_TICKOFF).toBe(0x1c);
    expect(INIT_STRUCT_MARKER_OFF).toBe(6);
    // Exposed sub addresses.
    expect(FUN_28232_SUB_ADDRS).toEqual([0x00000142, 0x0000013c, 0x00028e3c]);
  });
});
