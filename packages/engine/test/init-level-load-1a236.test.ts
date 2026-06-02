/**
 * Test initLevelLoad1A236 (FUN_0001A236) — smoke + side-effect coverage.
 *
 *   - default no-op non solleva
 *
 * `cli/src/test-init-level-load-1a236-parity.ts` (500/500 cases).
 */

import { describe, it, expect } from "vitest";
import {
  initLevelLoad1A236,
  INIT_LEVEL_LOAD_1A236_ADDR,
  INIT_LEVEL_LOAD_1A236_SUB_ADDRS,
  INIT_LEVEL_LOAD_1A236_GAME_MODE_ADDR,
  INIT_LEVEL_LOAD_1A236_SLAPSTIC_INDEX_ADDR,
  INIT_LEVEL_LOAD_1A236_COUNTER_FLAG_ADDR,
  INIT_LEVEL_LOAD_1A236_LEVEL_PTR_DST_ADDR,
  INIT_LEVEL_LOAD_1A236_POINTER_TABLE_ROM_ADDR,
  type InitLevelLoad1A236Subs,
} from "../src/init-level-load-1a236.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;

function readWordWorkRam(s: ReturnType<typeof emptyGameState>, abs: number): number {
  const off = abs - WORK_RAM_BASE;
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}

function readLongWorkRam(s: ReturnType<typeof emptyGameState>, abs: number): number {
  const off = abs - WORK_RAM_BASE;
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>> 0
  );
}

function makeRomWithLevelPointer(ptr: number): ReturnType<typeof emptyRomImage> {
  const rom = emptyRomImage();
  // Entry 0 (Level 1) of the pointer table @ 0x2BE00
  const off = INIT_LEVEL_LOAD_1A236_POINTER_TABLE_ROM_ADDR;
  rom.program[off] = (ptr >>> 24) & 0xff;
  rom.program[off + 1] = (ptr >>> 16) & 0xff;
  rom.program[off + 2] = (ptr >>> 8) & 0xff;
  rom.program[off + 3] = ptr & 0xff;
  return rom;
}

describe("initLevelLoad1A236 (FUN_0001A236)", () => {
  it("setta the 3 globali and carica il level pointer dto the entry 0 of the table", () => {
    const s = emptyGameState();
    s.workRam[INIT_LEVEL_LOAD_1A236_GAME_MODE_ADDR - WORK_RAM_BASE] = 0x12;
    s.workRam[INIT_LEVEL_LOAD_1A236_GAME_MODE_ADDR - WORK_RAM_BASE + 1] = 0x34;
    s.workRam[INIT_LEVEL_LOAD_1A236_SLAPSTIC_INDEX_ADDR - WORK_RAM_BASE] = 0xab;
    s.workRam[INIT_LEVEL_LOAD_1A236_SLAPSTIC_INDEX_ADDR - WORK_RAM_BASE + 1] = 0xcd;
    s.workRam[INIT_LEVEL_LOAD_1A236_COUNTER_FLAG_ADDR - WORK_RAM_BASE] = 0xff;
    s.workRam[INIT_LEVEL_LOAD_1A236_COUNTER_FLAG_ADDR - WORK_RAM_BASE + 1] = 0xff;

    const rom = makeRomWithLevelPointer(0x0002bee2);

    initLevelLoad1A236(s, rom);

    expect(readWordWorkRam(s, INIT_LEVEL_LOAD_1A236_GAME_MODE_ADDR)).toBe(0x0000);
    expect(readWordWorkRam(s, INIT_LEVEL_LOAD_1A236_SLAPSTIC_INDEX_ADDR)).toBe(0x0000);
    expect(readWordWorkRam(s, INIT_LEVEL_LOAD_1A236_COUNTER_FLAG_ADDR)).toBe(0x0001);
    expect(readLongWorkRam(s, INIT_LEVEL_LOAD_1A236_LEVEL_PTR_DST_ADDR)).toBe(0x0002bee2);
  });

  it("calls all and 4 le subs in the ordine binary", () => {
    const s = emptyGameState();
    const rom = makeRomWithLevelPointer(0x12345678);
    const calls: string[] = [];
    const subs: InitLevelLoad1A236Subs = {
      clearAlphaTiles: () => calls.push("clearAlphaTiles"),
      clearMoAlphaRam: () => calls.push("clearMoAlphaRam"),
      fun16F6C: () => calls.push("fun16F6C"),
      paletteInitLevel: () => calls.push("paletteInitLevel"),
    };

    initLevelLoad1A236(s, rom, subs);

    expect(calls).toEqual([
      "clearAlphaTiles",
      "clearMoAlphaRam",
      "fun16F6C",
      "paletteInitLevel",
    ]);
  });

  it("default no-op: non solleva su subs assenti o subs={}", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => initLevelLoad1A236(s, rom)).not.toThrow();
    expect(() => initLevelLoad1A236(s, rom, {})).not.toThrow();
  });

  it("subs parziali: invoca solo quelle definite, skips the undefined", () => {
    const s = emptyGameState();
    const rom = makeRomWithLevelPointer(0xdeadbeef);
    const calls: string[] = [];
    const subs: InitLevelLoad1A236Subs = {
      clearAlphaTiles: () => calls.push("clearAlphaTiles"),
      // clearMoAlphaRam: undefined
      fun16F6C: () => calls.push("fun16F6C"),
      // paletteInitLevel: undefined
    };

    initLevelLoad1A236(s, rom, subs);

    expect(calls).toEqual(["clearAlphaTiles", "fun16F6C"]);
    expect(readLongWorkRam(s, INIT_LEVEL_LOAD_1A236_LEVEL_PTR_DST_ADDR)).toBe(0xdeadbeef);
  });

  it("le sub vedono i globali GIÀ settati and il level ptr GIÀ scritto", () => {
    const s = emptyGameState();
    const rom = makeRomWithLevelPointer(0x00abcdef);
    const snapshots: Record<string, { gameMode: number; counter: number; ptr: number }> = {};
    const cap = (k: string): void => {
      snapshots[k] = {
        gameMode: readWordWorkRam(s, INIT_LEVEL_LOAD_1A236_GAME_MODE_ADDR),
        counter: readWordWorkRam(s, INIT_LEVEL_LOAD_1A236_COUNTER_FLAG_ADDR),
        ptr: readLongWorkRam(s, INIT_LEVEL_LOAD_1A236_LEVEL_PTR_DST_ADDR),
      };
    };
    initLevelLoad1A236(s, rom, {
      clearAlphaTiles: () => cap("clearAlphaTiles"),
      paletteInitLevel: () => cap("paletteInitLevel"),
    });

    for (const k of ["clearAlphaTiles", "paletteInitLevel"] as const) {
      expect(snapshots[k]?.gameMode).toBe(0);
      expect(snapshots[k]?.counter).toBe(1);
      expect(snapshots[k]?.ptr).toBe(0x00abcdef);
    }
  });

  it("costanti esposte: ADDR and SUB_ADDRS are bit-exact from the disasm", () => {
    expect(INIT_LEVEL_LOAD_1A236_ADDR).toBe(0x0001a236);
    expect(INIT_LEVEL_LOAD_1A236_SUB_ADDRS).toEqual([
      0x00028c7e,
      0x00012174,
      0x00016f6c,
      0x0001a41e,
    ]);
    expect(INIT_LEVEL_LOAD_1A236_GAME_MODE_ADDR).toBe(0x00400394);
    expect(INIT_LEVEL_LOAD_1A236_SLAPSTIC_INDEX_ADDR).toBe(0x00400662);
    expect(INIT_LEVEL_LOAD_1A236_COUNTER_FLAG_ADDR).toBe(0x00400664);
    expect(INIT_LEVEL_LOAD_1A236_LEVEL_PTR_DST_ADDR).toBe(0x00400474);
    expect(INIT_LEVEL_LOAD_1A236_POINTER_TABLE_ROM_ADDR).toBe(0x0002be00);
  });
});
