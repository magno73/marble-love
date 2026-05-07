/**
 * Test moScreenInit1A286 (FUN_0001A286) — smoke + side-effect coverage.
 *
 * `FUN_0001A286` (408 byte) è uno screen-init helper che inizializza:
 *   - 2 word globali in workRam @ 0x400008/0x40000A (target degli ISR-write)
 *   - 32 word in MO RAM (sprite RAM banks 0..3, 8 entry each)
 *   - 4 word in PF RAM @ A00A20/A28/A30/A38
 *   - chiama 5 sub-routine (clearAlphaTiles, paletteInitLevel, renderString ×2)
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-mo-screen-init-1a286-parity.ts` (500/500 cases).
 */

import { describe, it, expect } from "vitest";
import {
  moScreenInit1A286,
  MO_SCREEN_INIT_1A286_ADDR,
  MO_SCREEN_INIT_1A286_SUB_ADDRS,
  MO_SCREEN_INIT_1A286_RENDER_STRING_TARGET,
  MO_SCREEN_INIT_1A286_ISR_DST_A_ADDR,
  MO_SCREEN_INIT_1A286_ISR_DST_B_ADDR,
  MO_SCREEN_INIT_1A286_RENDER_STRING_ARGS,
  MO_SCREEN_INIT_1A286_MO_ENTRY_COUNT,
  type MoScreenInit1A286Subs,
} from "../src/mo-screen-init-1a286.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;

function readWordBE(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

describe("moScreenInit1A286 (FUN_0001A286)", () => {
  it("scrive i 2 globali workRam, le 32 word MO RAM, le 4 word PF RAM", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const pfRam = new Uint8Array(0x2000);

    // Sporco i target per verificare l'overwrite completo.
    s.workRam[MO_SCREEN_INIT_1A286_ISR_DST_A_ADDR - WORK_RAM_BASE] = 0xab;
    s.workRam[MO_SCREEN_INIT_1A286_ISR_DST_A_ADDR - WORK_RAM_BASE + 1] = 0xcd;
    s.workRam[MO_SCREEN_INIT_1A286_ISR_DST_B_ADDR - WORK_RAM_BASE] = 0xef;
    s.workRam[MO_SCREEN_INIT_1A286_ISR_DST_B_ADDR - WORK_RAM_BASE + 1] = 0x12;
    s.spriteRam.fill(0xff);
    pfRam.fill(0xff);

    moScreenInit1A286(s, rom, pfRam);

    // 2 globali word workRam → entrambi 0
    expect(readWordBE(s.workRam, MO_SCREEN_INIT_1A286_ISR_DST_A_ADDR - WORK_RAM_BASE)).toBe(0);
    expect(readWordBE(s.workRam, MO_SCREEN_INIT_1A286_ISR_DST_B_ADDR - WORK_RAM_BASE)).toBe(0);

    // MO RAM bank A (0xA02000 + i*2): sempre 0x1401
    for (let i = 0; i < MO_SCREEN_INIT_1A286_MO_ENTRY_COUNT; i++) {
      expect(readWordBE(s.spriteRam, 0x000 + i * 2)).toBe(0x1401);
    }
    // Bank B (+0x080): 0x0001 + i*0x0800
    for (let i = 0; i < MO_SCREEN_INIT_1A286_MO_ENTRY_COUNT; i++) {
      expect(readWordBE(s.spriteRam, 0x080 + i * 2)).toBe((0x0001 + i * 0x0800) & 0xffff);
    }
    // Bank C (+0x100): 0x0400 + i*0x0200
    for (let i = 0; i < MO_SCREEN_INIT_1A286_MO_ENTRY_COUNT; i++) {
      expect(readWordBE(s.spriteRam, 0x100 + i * 2)).toBe((0x0400 + i * 0x0200) & 0xffff);
    }
    // Bank D (+0x180): 1,2,3,4,5,6,7,7  (l'ultima entry NON è 8!)
    const bankDExpected = [1, 2, 3, 4, 5, 6, 7, 7];
    for (let i = 0; i < MO_SCREEN_INIT_1A286_MO_ENTRY_COUNT; i++) {
      expect(readWordBE(s.spriteRam, 0x180 + i * 2)).toBe(bankDExpected[i]);
    }

    // PF RAM: 0xA20+i*8 → 0x0010 + i*0x1000
    for (let i = 0; i < 4; i++) {
      expect(readWordBE(pfRam, 0xa20 + i * 8)).toBe((0x0010 + i * 0x1000) & 0xffff);
    }
  });

  it("chiama tutte le sub nell'ordine binary, renderString 2 volte con args giusti", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const pfRam = new Uint8Array(0x2000);
    const calls: string[] = [];
    const renderArgs: Array<{ strPtr: number; slot: number }> = [];
    const subs: MoScreenInit1A286Subs = {
      clearAlphaTiles: () => calls.push("clearAlphaTiles"),
      paletteInitLevel: () => calls.push("paletteInitLevel"),
      renderString: (_s, strPtr, slot) => {
        calls.push("renderString");
        renderArgs.push({ strPtr, slot });
      },
    };

    moScreenInit1A286(s, rom, pfRam, subs);

    expect(calls).toEqual([
      "clearAlphaTiles",
      "paletteInitLevel",
      "renderString",
      "renderString",
    ]);
    expect(renderArgs).toEqual(MO_SCREEN_INIT_1A286_RENDER_STRING_ARGS);
  });

  it("default no-op: non solleva su subs assenti / pfRam null / subs vuoti", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => moScreenInit1A286(s, rom)).not.toThrow();
    expect(() => moScreenInit1A286(s, rom, null)).not.toThrow();
    expect(() => moScreenInit1A286(s, rom, new Uint8Array(0x2000), {})).not.toThrow();
    // I 2 globali e i 32 MO writes restano comunque applicati
    expect(readWordBE(s.workRam, MO_SCREEN_INIT_1A286_ISR_DST_A_ADDR - WORK_RAM_BASE)).toBe(0);
    expect(readWordBE(s.spriteRam, 0x000)).toBe(0x1401);
  });

  it("pfRam=null salta le 4 PF writes (gli altri side effect avvengono)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    moScreenInit1A286(s, rom, null);
    // MO writes presenti
    expect(readWordBE(s.spriteRam, 0x100)).toBe(0x0400);
    expect(readWordBE(s.spriteRam, 0x18e)).toBe(0x0007);
  });

  it("costanti esposte: ADDR e SUB_ADDRS e args sono bit-exact dal disasm", () => {
    expect(MO_SCREEN_INIT_1A286_ADDR).toBe(0x0001a286);
    expect(MO_SCREEN_INIT_1A286_SUB_ADDRS).toEqual([
      0x00028c7e,
      0x0001a41e,
      0x00000142,
      0x00000142,
    ]);
    expect(MO_SCREEN_INIT_1A286_RENDER_STRING_TARGET).toBe(0x00002572);
    expect(MO_SCREEN_INIT_1A286_ISR_DST_A_ADDR).toBe(0x00400008);
    expect(MO_SCREEN_INIT_1A286_ISR_DST_B_ADDR).toBe(0x0040000a);
    expect(MO_SCREEN_INIT_1A286_RENDER_STRING_ARGS).toEqual([
      { strPtr: 0x00022a9e, slot: 0x00002000 },
      { strPtr: 0x00022906, slot: 0x00002000 },
    ]);
  });
});
