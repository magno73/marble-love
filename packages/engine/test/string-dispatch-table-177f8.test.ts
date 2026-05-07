/**
 * Test stringDispatchTable177F8 (FUN_177F8) — smoke tests sui rami principali.
 *
 * Bit-perfect verificato vs binary tramite
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
  it("costanti coerenti col disasm", () => {
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

  it("early-exit 'bound': D2.w >= bound (signed) → ritorna 0", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    // Setta level header @ 0x401000 (in workRam), bound @ +0x18 = 5.
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

    // arg0w = 4 → 4 < 5 → proceed (entrerà in altri rami; verifica solo che
    // NON sia bound).
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

  it("early-exit 'fff_zero': se A2-lookup ritorna 0 → ritorna 0", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    // Tutti i lookup ROM/workRam restano 0 (default), quindi:
    //   - bound check: bound = 0; arg0w = 0 → 0 NOT < 0 → SAREBBE bound exit.
    // Forziamo bound > 0 per arrivare al lookup centrale.
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100); // bound = 100
    // *(0x40065a) = some valid ptr (workRam), e (A2 + D1).w = 0 → fff_zero.
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

  it("early-exit 'bias_sentinel': lookup bias = 0x1000 → ritorna 0", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100); // bound = 100
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    // Costringiamo D0.w al lookup A2 ad avere top4 != 0 (bit11 set + qualcosa)
    // E che il top4_mask check fallisca → top4_search path → bias = 0x1000.
    // (A2 + 0).w = 0x1080 (top4 = 0x1000, bit 7 = 0x80 → D1_search bits 7..11 = 0x80)
    setWord(state.workRam, 0x1200, 0x1080);
    // top4_mask @ 0x24176 (ROM) = 0 default → D1_andResult = 0 → top4_search.
    // bias @ 0x1ed62 + (0x80 >> 6 = 2) → ROM[0x1ed64..0x1ed65].
    // Default rom.program = 0, ma nel fixture non abbiamo ROM reale.
    // Settiamo direttamente quel byte pair = 0x1000 → sentinel.
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

  it("early-exit 'byte_zero': nel case_no_bit11, byte image = 0 → ritorna 0", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100); // bound = 100
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    // (A0).l = some addr; default workRam @ 0x1000 = 0 → A0_deref = 0
    // → A1 = 0 + 0 = 0 → (A1).b = ROM[0] = 0. Same per altre.
    // Ma A2 lookup: (A2 + 0).w = 0x0040 (positive, top4 = 0, bit11 not set, fff = 0x40)
    setWord(state.workRam, 0x1200, 0x0040);
    // → bit11 not set → no_bit11 path.
    // (A0).l: setta workRam @ 0x1000 (level header) per dare un ptr valido.
    // Ma il livello header è già a 0x401000 (workRam), e (A0).l = long @ 0x401000.
    // Setta long @ 0x401000 = 0 (default) → A0_deref = 0.
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

  it("path 'top4_short': top4!=0 e mask hit → calcolo D0 dal short-form", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100); // bound = 100
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    // D0.w lookup → vogliamo top4 != 0 e mask hit.
    setWord(state.workRam, 0x1200, 0x2000); // top4 = 0x2000
    // top4_mask @ 0x24176 (D3.w*2 sex; D3=0 quindi off=0). Setta 0x2000.
    rom.program[0x24176 + 0] = 0x20;
    rom.program[0x24176 + 1] = 0x00;
    // baseOffsetTable @ 0x400478 + 2*arg0w = 0x400478 → setta 0x0100.
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

  it("path 'no_bit11' con pixel != 0: produce D0.w deterministico", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100); // bound = 100
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    // D0.w (post-A2-lookup) = 0x0040 (top4 = 0, bit11 not set, fff = 0x40 ≠ 0 → no_bit11)
    setWord(state.workRam, 0x1200, 0x0040);
    // (A0).l: long @ 0x401000 = 0 → A0_deref = 0. A1 = 0 + 0x40 = 0x40 (ROM byte).
    // ROM @ 0x2417e + 0 (D3=0) = offset0 long. Setta = 0xfffffffe (= -2 long signed);
    // così A3 = 0x40 + (-2) = 0x3e. ROM[0x3e] = 0x42 (just for example).
    rom.program[0x2417e + 0] = 0xff;
    rom.program[0x2417e + 1] = 0xff;
    rom.program[0x2417e + 2] = 0xff;
    rom.program[0x2417e + 3] = 0xfe;
    rom.program[0x3e] = 0x42; // D0.b candidate
    // offset4 = long @ 0x24182. Setta 0x00000000 → A1 unchanged = 0x40.
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

  it("ritorna sempre 0..0xFFFF (mask di output)", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    // Anche con tutti gli input random, l'output è masked a 16-bit.
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 0x7fff); // big bound
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    for (let arg0 = 0; arg0 < 8; arg0++) {
      const v = stringDispatchTable177F8(state, rom, pfRam, arg0, 0xabcd, 0x1234);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffff);
    }
  });

  it("dispatcher è puro: non scrive in state.workRam, rom.program, pfRam", () => {
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

  it("API a 3 word args: arg0/1/2 sono trattati come 16-bit (mask)", () => {
    const { state, rom, pfRam } = makeFreshFixtures();
    setLong(state.workRam, WR_LEVEL_HEADER_PTR_ABS - WORK_RAM_BASE, 0x401000);
    setWord(state.workRam, 0x1000 + 0x18, 100);
    setLong(state.workRam, WR_STRING_TABLE_PTR_ABS - WORK_RAM_BASE, 0x401200);
    setWord(state.workRam, 0x1200, 0x0040);
    // arg0=5 vs arg0=5 + 0x10000 (high bits) → stesso D0.w.
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
