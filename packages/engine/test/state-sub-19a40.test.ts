/**
 * state-sub-19a40.test.ts — smoke tests for `FUN_00019A40`.
 *
 *     match)
 */

import { describe, it, expect } from "vitest";
import {
  stateSub19A40,
  ENTITY_TABLE_BASE,
  ENTITY_STRIDE,
  ENTITY_COUNT,
  ROM_PAIR_TABLE,
  ROM_ENTITY_PTR_TABLE,
  ROM_EVENT_TABLE,
  INIT_POS_Z,
  INIT_AI_PTR,
  INIT_VEL,
  INIT_STATE,
  POS_BIAS,
} from "../src/state-sub-19a40.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

function readByte(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (s.workRam[off] ?? 0) & 0xff;
}

function readLongBE(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

/**
 *
 * - ROM_PAIR_TABLE @ 0x244F6: 5 pairs (X,Y) signed byte.
 *   We use: (0x10, 0x20), (0x11, 0x20), (0x12, 0x20), (0x13, 0x20), (0x14, 0x20).
 * - ROM_ENTITY_PTR_TABLE @ 0x1F0BA: 10 long ptrs to 0x4019F8 + i*0x38.
 */
function buildRom(): ReturnType<typeof emptyRomImage> {
  const rom = emptyRomImage();
  // Pair table.
  const pairs = [
    [0x10, 0x20],
    [0x11, 0x20],
    [0x12, 0x20],
    [0x13, 0x20],
    [0x14, 0x20],
  ];
  for (let i = 0; i < pairs.length; i++) {
    rom.program[ROM_PAIR_TABLE + i * 2 + 0] = pairs[i]![0]!;
    rom.program[ROM_PAIR_TABLE + i * 2 + 1] = pairs[i]![1]!;
  }
  // Entity ptr table (10 long BE).
  for (let i = 0; i < ENTITY_COUNT; i++) {
    const ptr = (ENTITY_TABLE_BASE + i * ENTITY_STRIDE) >>> 0;
    rom.program[ROM_ENTITY_PTR_TABLE + i * 4 + 0] = (ptr >>> 24) & 0xff;
    rom.program[ROM_ENTITY_PTR_TABLE + i * 4 + 1] = (ptr >>> 16) & 0xff;
    rom.program[ROM_ENTITY_PTR_TABLE + i * 4 + 2] = (ptr >>> 8) & 0xff;
    rom.program[ROM_ENTITY_PTR_TABLE + i * 4 + 3] = ptr & 0xff;
  }
  // Event table (5 long BE).
  const events = [0x100, 0x101, 0x102, 0x103, 0x104];
  for (let i = 0; i < events.length; i++) {
    const v = events[i]! >>> 0;
    rom.program[ROM_EVENT_TABLE + i * 4 + 0] = (v >>> 24) & 0xff;
    rom.program[ROM_EVENT_TABLE + i * 4 + 1] = (v >>> 16) & 0xff;
    rom.program[ROM_EVENT_TABLE + i * 4 + 2] = (v >>> 8) & 0xff;
    rom.program[ROM_EVENT_TABLE + i * 4 + 3] = v & 0xff;
  }
  return rom;
}

const ENTITY_OFF_BASE = ENTITY_TABLE_BASE - 0x400000;

describe("stateSub19A40 (FUN_00019A40)", () => {
  it("table all free → max 2 spawns (1 per outer pass), no match", () => {
    const s = emptyGameState();
    const rom = buildRom();
    const r = stateSub19A40(s, rom);
    // D4=0: D3==0, D3>D4 false → spawn slot 0.
    //   inner scan: entity[0].x word raw = (sext(0x10) << 0x13 + 0x40000)
    //     = 0x10 << 0x13 = 0x800000, + 0x40000 = 0x840000.
    //     X word low = 0x4000. >> 3 = 0x800.
    //   compare with sext_w(0x10) = 0x0010. Not match.
    expect(r.spawnCount).toBe(2);
    expect(r.spawns[0]!.entitySlot).toBe(0);
    expect(r.spawns[1]!.entitySlot).toBe(1);
    expect(r.earlyExit).toBe(false);
    const off0 = ENTITY_OFF_BASE + 0 * ENTITY_STRIDE;
    expect(readByte(s, off0 + 0x18)).toBe(1);
    expect(readByte(s, off0 + 0x1a)).toBe(1);
    expect(readByte(s, off0 + 0x25)).toBe(INIT_STATE);
    expect(readLongBE(s, off0 + 0x14)).toBe(INIT_POS_Z);
    expect(readLongBE(s, off0 + 0x1c)).toBe(INIT_AI_PTR);
    expect(readLongBE(s, off0 + 0x04)).toBe(INIT_VEL);
    // pos X = sext(0x10) << 0x13 + 0x40000 = 0x10 << 0x13 = 0x800000 + 0x40000 = 0x840000.
    expect(readLongBE(s, off0 + 0x0c)).toBe(((0x10 << 0x13) + POS_BIAS) >>> 0);
    expect(readLongBE(s, off0 + 0x10)).toBe(((0x20 << 0x13) + POS_BIAS) >>> 0);
  });

  it("all 10 slots occupied → earlyExit true, 0 spawns", () => {
    const s = emptyGameState();
    const rom = buildRom();
    for (let i = 0; i < ENTITY_COUNT; i++) {
      const off = ENTITY_OFF_BASE + i * ENTITY_STRIDE;
      s.workRam[off + 0x18] = 1; // occupied
      // Set X so that (X.w >> 3) does not match pair-X (0x10..0x14):
      // X.w = 0x0000 → >> 3 = 0 → no match.
      s.workRam[off + 0x0c] = 0x00;
      s.workRam[off + 0x0d] = 0x00;
    }
    const r = stateSub19A40(s, rom);
    expect(r.earlyExit).toBe(true);
    expect(r.spawnCount).toBe(0);
  });

  it("3 sub-injections called in correct order for each spawn", () => {
    const s = emptyGameState();
    const rom = buildRom();
    const calls: string[] = [];
    stateSub19A40(s, rom, {
      fun_19e42: () => {
        calls.push("19e42");
      },
      fun_18e6c: () => {
        calls.push("18e6c");
      },
      fun_158ac: () => {
        calls.push("158ac");
      },
    });
    expect(calls).toEqual([
      "19e42",
      "18e6c",
      "158ac",
      "19e42",
      "18e6c",
      "158ac",
    ]);
  });

  it("subs absent → no crash, spawn executed regardless", () => {
    const s = emptyGameState();
    const rom = buildRom();
    expect(() => stateSub19A40(s, rom)).not.toThrow();
  });

  it("9/10 occupied with X non-match → spawn in the free slot, then early-exit", () => {
    const s = emptyGameState();
    const rom = buildRom();
    // Occupy slots 0..8, leave slot 9 free.
    for (let i = 0; i < 9; i++) {
      const off = ENTITY_OFF_BASE + i * ENTITY_STRIDE;
      s.workRam[off + 0x18] = 1;
      // X = 0 -> no match with pair-X.
      s.workRam[off + 0x0c] = 0;
      s.workRam[off + 0x0d] = 0;
    }
    const r = stateSub19A40(s, rom);
    expect(r.spawnCount).toBe(1);
    expect(r.spawns[0]!.entitySlot).toBe(9);
    expect(r.earlyExit).toBe(true);
  });

  it("eventArg passed to fun_158ac comes from ROM_EVENT_TABLE indexed by D5", () => {
    const s = emptyGameState();
    const rom = buildRom();
    const eventArgs: number[] = [];
    stateSub19A40(s, rom, {
      fun_158ac: (_st, arg) => {
        eventArgs.push(arg);
      },
    });
    // First spawn (D4=0, D5=0): pair0 = (0x10,0x20), no match → spawn slot 0,
    //   eventArg = events[0] = 0x100.
    // Second outer (D4=1): D5=0 → pair0 = (0x10,0x20), entity[0].x = 0x840000.
    //   Prox-check Y: entity[0].y = 0x1040000, word = 0x0104, asr.l #3 = 0x20.
    //   diff = 0x20 - 0x20 = 0; 4 > 0 → skip mid-iter, D5=1.
    //   D5=1 → pair1 = (0x11,0x20). asr.w #3 of 0x0084 = 0x0010 ≠ 0x11 → no match.
    //   D3=0 ≤ D4=1 → spawn slot 1, eventArg = events[1] = 0x101.
    expect(eventArgs).toEqual([0x100, 0x101]);
  });

  it("posX/posY are sign-extended from the byte (test with a negative value in the pair)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Setup: only the first pair is valid, negative byte (0xF0 = -16).
    rom.program[ROM_PAIR_TABLE + 0] = 0xf0; // X = -16
    rom.program[ROM_PAIR_TABLE + 1] = 0xe0; // Y = -32
    // Remaining pairs: distinct even with negative bytes, to avoid matches.
    for (let i = 1; i < 5; i++) {
      rom.program[ROM_PAIR_TABLE + i * 2] = 0x70 + i; // distinct positive
      rom.program[ROM_PAIR_TABLE + i * 2 + 1] = 0x10;
    }
    // Entity ptr table.
    for (let i = 0; i < ENTITY_COUNT; i++) {
      const ptr = (ENTITY_TABLE_BASE + i * ENTITY_STRIDE) >>> 0;
      rom.program[ROM_ENTITY_PTR_TABLE + i * 4 + 0] = (ptr >>> 24) & 0xff;
      rom.program[ROM_ENTITY_PTR_TABLE + i * 4 + 1] = (ptr >>> 16) & 0xff;
      rom.program[ROM_ENTITY_PTR_TABLE + i * 4 + 2] = (ptr >>> 8) & 0xff;
      rom.program[ROM_ENTITY_PTR_TABLE + i * 4 + 3] = ptr & 0xff;
    }
    // Event table.
    for (let i = 0; i < 5; i++) {
      rom.program[ROM_EVENT_TABLE + i * 4 + 3] = 0x10 + i;
    }
    const r = stateSub19A40(s, rom);
    expect(r.spawnCount).toBeGreaterThan(0);
    // entity[0]: pos X = sext(-16) << 0x13 + 0x40000 = -16*0x80000 + 0x40000.
    const off0 = ENTITY_OFF_BASE + 0 * ENTITY_STRIDE;
    const expectedX = ((-16 << 0x13) + POS_BIAS) >>> 0;
    const expectedY = ((-32 << 0x13) + POS_BIAS) >>> 0;
    expect(readLongBE(s, off0 + 0x0c)).toBe(expectedX);
    expect(readLongBE(s, off0 + 0x10)).toBe(expectedY);
  });
});
