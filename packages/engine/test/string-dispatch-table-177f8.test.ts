/**
 * Test stringDispatchTable177F8 (FUN_177F8) — smoke tests on the main branches.
 *
 * `cli/src/test-string-dispatch-table-177f8-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import {
  stringDispatchTable177F8,
  stringDispatchTable177F8Detailed,
  ROM_TABLE_BASE_177F8_TBL1,
  ROM_TABLE_BASE_177F8_TBL2,
  ROM_TABLE_BIAS_177F8,
  ROM_TABLE_TOP4_MASK,
  ROM_TABLE_PAIR_LONG,
  WR_LEVEL_HEADER_PTR_ABS,
  WR_BIAS_Y_LONG_ABS,
  WR_BIAS_X_WORD_ABS,
  WR_STRING_TABLE_PTR_ABS,
  WR_BASE_OFFSET_TABLE_ABS,
  A1_BASE_PFRAM_177F8,
  BIAS_SENTINEL_177F8,
  LEVEL_HEADER_BOUND_OFF,
} from "../src/string-dispatch-table-177f8.js";

const WORK_RAM_BASE = 0x400000;

function setLong(buf: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  buf[off] = (u >>> 24) & 0xff;
  buf[off + 1] = (u >>> 16) & 0xff;
  buf[off + 2] = (u >>> 8) & 0xff;
  buf[off + 3] = u & 0xff;
}
function setWord(buf: Uint8Array, off: number, v: number): void {
  const u = v & 0xffff;
  buf[off] = (u >>> 8) & 0xff;
  buf[off + 1] = u & 0xff;
}

function makeFreshFixtures(): {
  state: ReturnType<typeof emptyGameState>;
  rom: ReturnType<typeof emptyRomImage>;
  pfRam: Uint8Array;
} {
  const state = emptyGameState();
  const rom = emptyRomImage();
  const pfRam = new Uint8Array(0x4000); // 0xa00000..0xa04000
  return { state, rom, pfRam };
}

describe("stringDispatchTable177F8 (FUN_177F8)", () => {
  it("constants consistent with the disasm", () => {
    expect(ROM_TABLE_BASE_177F8_TBL1).toBe(0x0001eb3a);
    expect(ROM_TABLE_BASE_177F8_TBL2).toBe(0x0001ed0a);
    expect(ROM_TABLE_BIAS_177F8).toBe(0x0001ed62);
    expect(ROM_TABLE_TOP4_MASK).toBe(0x00024176);
    expect(ROM_TABLE_PAIR_LONG).toBe(0x0002417e);
    expect(WR_LEVEL_HEADER_PTR_ABS).toBe(0x00400474);
    expect(WR_BIAS_Y_LONG_ABS).toBe(0x00400988);
    expect(WR_BIAS_X_WORD_ABS).toBe(0x0040098a);
    expect(WR_STRING_TABLE_PTR_ABS).toBe(0x0040065a);
    expect(WR_BASE_OFFSET_TABLE_ABS).toBe(0x00400478);
    expect(A1_BASE_PFRAM_177F8).toBe(0xa00000);
    expect(BIAS_SENTINEL_177F8).toBe(0x1000);
    expect(LEVEL_HEADER_BOUND_OFF).toBe(0x18);
  });

  it("early-exit 'bound': D2.w >= bound (signed) → returns 0", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    // Set level header @ 0x401000 (in workRam), bound @ +0x18 = 5.
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 5); // bound = 5
    // arg0w = 5 → D2.w (signed) = 5, NOT < 5 → bound exit
    const res = stringDispatchTable177F8Detailed(
      state,
      rom,
      pfRam,
      5,
      0,
      0,
    );
    expect(res.d0Word).toBe(0);
    expect(res.earlyExit).toBe("bound");

    // NOT at the bound).
    const res2 = stringDispatchTable177F8Detailed(
      state,
      rom,
      pfRam,
      4,
      0,
      0,
    );
    expect(res2.earlyExit).not.toBe("bound");
  });

  it("early-exit 'fff_zero': if A2-lookup returns 0 → returns 0", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    //   - bound check: bound = 0; arg0w = 0 → 0 NOT < 0 → WOULD BE bound exit.
    // Force bound > 0 to reach the central lookup.
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100); // bound = 100
    // *(0x40065a) = some valid ptr (workRam), and (A2 + D1).w = 0 → fff_zero.
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    // workRam @ 0x401200..0x401400 default 0 → lookup yields 0 → top4 = 0
    // → fff = 0 → fff_zero.
    const res = stringDispatchTable177F8Detailed(
      state,
      rom,
      pfRam,
      0,
      0,
      0,
    );
    expect(res.d0Word).toBe(0);
    expect(res.earlyExit).toBe("fff_zero");
  });

  it("early-exit 'bias_sentinel': lookup bias = 0x1000 → returns 0", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100); // bound = 100
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    // Force the A2 lookup D0.w to have top4 != 0 (bit11 set + something)
    // And make top4_mask check fail -> top4_search path -> bias = 0x1000.
    // (A2 + 0).w = 0x1080 (top4 = 0x1000, bit 7 = 0x80 → D1_search bits 7..11 = 0x80)
    setWord(state.workRam, 0x1200, 0x1080);
    // top4_mask @ 0x24176 (ROM) = 0 default → D1_andResult = 0 → top4_search.
    // bias @ 0x1ed62 + (0x80 >> 6 = 2) → ROM[0x1ed64..0x1ed65].
    // Set that byte pair directly = 0x1000 → sentinel.
    rom.program[0x1ed62 + 2] = 0x10;
    rom.program[0x1ed62 + 3] = 0x00;
    const res = stringDispatchTable177F8Detailed(
      state,
      rom,
      pfRam,
      0,
      0,
      0,
    );
    expect(res.d0Word).toBe(0);
    expect(res.earlyExit).toBe("bias_sentinel");
  });

  it("early-exit 'byte_zero': in the case_no_bit11, byte image = 0 → returns 0", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100); // bound = 100
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    // (A0).l = some addr; default workRam @ 0x1000 = 0 → A0_deref = 0
    // → A1 = 0 + 0 = 0 → (A1).b = ROM[0] = 0. Same for the others.
    // But A2 lookup: (A2 + 0).w = 0x0040 (positive, top4 = 0, bit11 not set, fff = 0x40)
    setWord(state.workRam, 0x1200, 0x0040);
    // → bit11 not set → no_bit11 path.
    // (A0).l: set workRam @ 0x1000 (level header) to provide a valid ptr.
    // Set long @ 0x401000 = 0 (default) → A0_deref = 0.
    // A1 = 0 + sext(0x40) = 0x40. ROM[0x40] = 0 → byte_zero.
    const res = stringDispatchTable177F8Detailed(
      state,
      rom,
      pfRam,
      0,
      0,
      0,
    );
    expect(res.d0Word).toBe(0);
    expect(res.earlyExit).toBe("byte_zero");
  });

  it("path 'top4_short': top4!=0 and mask hit → compute D0 from the short-form", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100); // bound = 100
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    // D0.w lookup → we want top4 != 0 and mask hit.
    setWord(state.workRam, 0x1200, 0x2000); // top4 = 0x2000
    rom.program[0x24176 + 0] = 0x20;
    rom.program[0x24176 + 1] = 0x00;
    // baseOffsetTable @ 0x400478 + 2*arg0w = 0x400478 -> set 0x0100.
    setWord(state.workRam, 0x478, 0x0100);
    // D0_short = D0.w & 0x7f = 0; -0x40 = 0xffc0 (16-bit); + 0x100 = 0x00c0.
    // Wait: 0x2000 & 0x7f = 0; 0 - 0x40 = -64 = 0xFFC0; + 0x100 = 0x10060 → masked = 0x0060.
    const res = stringDispatchTable177F8Detailed(
      state,
      rom,
      pfRam,
      0,
      0,
      0,
    );
    expect(res.earlyExit).toBeNull();
    expect(res.normalPath).toBe("top4_short");
    expect(res.d0Word).toBe(0x00c0);
  });

  it("also reads the slapstic ROM window when the string table points above 0x80000", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100);

    // Live Marble level 1 can point the string table into the slapstic window
    // (for example 0x81874). That is still readable program ROM.
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x80000);
    rom.program[0x80000] = 0x20;
    rom.program[0x80001] = 0x00;
    rom.program[0x24176] = 0x20;
    rom.program[0x24177] = 0x00;
    setWord(state.workRam, 0x478, 0x0100);

    const res = stringDispatchTable177F8Detailed(state, rom, pfRam, 0, 0, 0);
    expect(res.earlyExit).toBeNull();
    expect(res.normalPath).toBe("top4_short");
    expect(res.d0Word).toBe(0x00c0);
  });

  it("path 'no_bit11' with pixel != 0: produces a deterministic D0.w", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100); // bound = 100
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    // D0.w (post-A2-lookup) = 0x0040 (top4 = 0, bit11 not set, fff = 0x40 ≠ 0 → no_bit11)
    setWord(state.workRam, 0x1200, 0x0040);
    // (A0).l: long @ 0x401000 = 0 → A0_deref = 0. A1 = 0 + 0x40 = 0x40 (ROM byte).
    // ROM @ 0x2417e + 0 (D3=0) = offset0 long. Set = 0xfffffffe (= -2 long signed);
    rom.program[0x2417e + 0] = 0xff;
    rom.program[0x2417e + 1] = 0xff;
    rom.program[0x2417e + 2] = 0xff;
    rom.program[0x2417e + 3] = 0xfe;
    rom.program[0x3e] = 0x42; // D0.b candidate
    // offset4 = long @ 0x24182. Set 0x00000000 → A1 unchanged = 0x40.
    rom.program[0x24182] = 0;
    rom.program[0x24183] = 0;
    rom.program[0x24184] = 0;
    rom.program[0x24185] = 0;
    rom.program[0x40] = 0x10; // D1.b candidate (smaller than 0x42)
    // max(0x42, 0x10) = 0x42; -0x80 = 0xFFC2 (signed -62); + baseTbl word.
    setWord(state.workRam, 0x478, 0x100); // baseWord = 0x100
    // 0xFFC2 + 0x100 = 0x100C2 → masked = 0x00C2.
    const res = stringDispatchTable177F8Detailed(
      state,
      rom,
      pfRam,
      0,
      0,
      0,
    );
    expect(res.earlyExit).toBeNull();
    expect(res.normalPath).toBe("no_bit11");
    expect(res.d0Word).toBe(0x00c2);
  });

  it("always returns 0..0xFFFF (output mask)", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 0x7fff); // big bound
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    for (let arg0 = 0; arg0 < 8; arg0++) {
      const v = stringDispatchTable177F8(state, rom, pfRam, arg0, 0xabcd, 0x1234);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffff);
    }
  });

  it("dispatcher is pure: does not write to state.workRam, rom.program, pfRam", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100);
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    setWord(state.workRam, 0x1200, 0x0040);

    const wrCopy = new Uint8Array(state.workRam);
    const romCopy = new Uint8Array(rom.program);
    const pfCopy = new Uint8Array(pfRam);

    stringDispatchTable177F8(state, rom, pfRam, 5, 0x10, 0x20);

    expect(state.workRam).toEqual(wrCopy);
    expect(rom.program).toEqual(romCopy);
    expect(pfRam).toEqual(pfCopy);
  });

  it("3-word-arg API: arg0/1/2 are treated as 16-bit (mask)", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100);
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    setWord(state.workRam, 0x1200, 0x0040);
    // arg0=5 vs arg0=5 + 0x10000 (high bits) -> same D0.w.
    const a = stringDispatchTable177F8(state, rom, pfRam, 5, 0x10, 0x20);
    const b = stringDispatchTable177F8(
      state,
      rom,
      pfRam,
      5 + 0x10000,
      0x10 + 0x20000,
      0x20 + 0x30000,
    );
    expect(a).toBe(b);
  });
});
