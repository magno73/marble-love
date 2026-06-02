/**
 * state-sub-186ac.test.ts — smoke tests for `FUN_000186AC`.
 *
 * && hasArmed), teardown (sentinel!=0 && !hasArmed), noop (the other two).
 * `packages/cli/src/test-state-sub-186ac-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  stateSub186AC,
  GAME_MODE_ADDR,
  OBJ_COUNT_ADDR,
  OBJ_BASE_ADDR,
  OBJ_STRIDE,
  SENTINEL_ADDR,
  SELECTOR_PTR_ADDR,
  SLOT_TABLE_ADDR,
  SLOT_ENTRY_STRIDE,
  SLOT_ENTRY_COUNT,
  SECONDARY_PATH_CUTOFF,
  ROM_TABLE_PRIMARY_W16,
  ROM_TABLE_BYTE_4,
  ROM_TABLE_BYTE_5,
  ROM_TABLE_W16_67,
  ROM_SELECTOR_INIT,
  ROM_SELECTOR_POST,
  TEARDOWN_TRIGGER_WORD,
  WORK_RAM_BASE,
} from "../src/state-sub-186ac.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import { as_u32 } from "../src/wrap.js";

function setWordBE(arr: Uint8Array, off: number, v: number): void {
  arr[off] = (v >>> 8) & 0xff;
  arr[off + 1] = v & 0xff;
}

function setLongBE(arr: Uint8Array, off: number, v: number): void {
  arr[off] = (v >>> 24) & 0xff;
  arr[off + 1] = (v >>> 16) & 0xff;
  arr[off + 2] = (v >>> 8) & 0xff;
  arr[off + 3] = v & 0xff;
}

function readByte(arr: Uint8Array, off: number): number {
  return (arr[off] ?? 0) & 0xff;
}

function readWordBE(arr: Uint8Array, off: number): number {
  return (((arr[off] ?? 0) << 8) | (arr[off + 1] ?? 0)) & 0xffff;
}

function readLongBE(arr: Uint8Array, off: number): number {
  return (
    ((arr[off] ?? 0) << 24) |
    ((arr[off + 1] ?? 0) << 16) |
    ((arr[off + 2] ?? 0) << 8) |
    (arr[off + 3] ?? 0)
  ) >>> 0;
}

describe("stateSub186AC (FUN_000186AC)", () => {
  it("early_exit: game_mode != 3 → no write, branch=early_exit", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setWordBE(state.workRam, GAME_MODE_ADDR - WORK_RAM_BASE, 4); // mode != 3
    state.workRam[SENTINEL_ADDR - WORK_RAM_BASE] = 0xab; // arbitrary sentinel

    const r = stateSub186AC(state, rom);
    expect(r.branch).toBe("early_exit");
    expect(r.modeMatched).toBe(false);
    // sentinel not touched.
    expect(state.workRam[SENTINEL_ADDR - WORK_RAM_BASE]).toBe(0xab);
    expect(r.fun1BB28Calls).toBe(0);
    expect(r.fun18F46Calls).toBe(0);
  });

  it("noop: mode==3 but sentinel==0 && !hasArmed → branch=noop, sentinel stays 0", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setWordBE(state.workRam, GAME_MODE_ADDR - WORK_RAM_BASE, 3);
    setWordBE(state.workRam, OBJ_COUNT_ADDR - WORK_RAM_BASE, 2);
    for (let i = 0; i < 2; i++) {
      const objOff = (OBJ_BASE_ADDR - WORK_RAM_BASE) + i * OBJ_STRIDE;
      state.workRam[objOff + 0x18] = 2; // state != 1
      state.workRam[objOff + 0x1b] = 4;
    }
    state.workRam[SENTINEL_ADDR - WORK_RAM_BASE] = 0;

    const r = stateSub186AC(state, rom);
    expect(r.modeMatched).toBe(true);
    expect(r.hasArmed).toBe(false);
    expect(r.branch).toBe("noop");
    expect(r.fun1BB28Calls).toBe(0);
    expect(r.fun18F46Calls).toBe(0);
    expect(state.workRam[SENTINEL_ADDR - WORK_RAM_BASE]).toBe(0);
  });

  it("noop: mode==3, sentinel!=0 && hasArmed → branch=noop, sentinel not touched", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setWordBE(state.workRam, GAME_MODE_ADDR - WORK_RAM_BASE, 3);
    setWordBE(state.workRam, OBJ_COUNT_ADDR - WORK_RAM_BASE, 1);
    const objOff = OBJ_BASE_ADDR - WORK_RAM_BASE;
    state.workRam[objOff + 0x18] = 1;
    state.workRam[objOff + 0x1b] = 5;
    state.workRam[SENTINEL_ADDR - WORK_RAM_BASE] = 0xff;

    const r = stateSub186AC(state, rom);
    expect(r.hasArmed).toBe(true);
    expect(r.branch).toBe("noop");
    expect(state.workRam[SENTINEL_ADDR - WORK_RAM_BASE]).toBe(0xff);
  });

  it("init: sentinel==0 && hasArmed → populates 0x24 entries, sentinel→1, fun_1bb28 called 0x24 times", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setWordBE(state.workRam, GAME_MODE_ADDR - WORK_RAM_BASE, 3);
    setWordBE(state.workRam, OBJ_COUNT_ADDR - WORK_RAM_BASE, 1);
    // entity[0]: state==1, sub==4 → hasArmed
    const objOff = OBJ_BASE_ADDR - WORK_RAM_BASE;
    state.workRam[objOff + 0x18] = 1;
    state.workRam[objOff + 0x1b] = 4;
    state.workRam[SENTINEL_ADDR - WORK_RAM_BASE] = 0;

    for (let d2 = 0; d2 < SECONDARY_PATH_CUTOFF; d2++) {
      // primary u16 BE per entry[2..3]
      rom.program[ROM_TABLE_PRIMARY_W16 + d2 * 2 + 0] = 0xa0;
      rom.program[ROM_TABLE_PRIMARY_W16 + d2 * 2 + 1] = d2;
    }
    for (let d2 = 0; d2 < SLOT_ENTRY_COUNT; d2++) {
      rom.program[ROM_TABLE_BYTE_4 + d2] = (0x40 + d2) & 0xff;
      rom.program[ROM_TABLE_BYTE_5 + d2] = (0x80 + d2) & 0xff;
      rom.program[ROM_TABLE_W16_67 + d2 * 2 + 0] = 0xc0;
      rom.program[ROM_TABLE_W16_67 + d2 * 2 + 1] = d2;
    }
    // ROM_SELECTOR_INIT[0] and ROM_SELECTOR_POST[0]: long BE distinct
    setLongBE(rom.program, ROM_SELECTOR_INIT + 0, 0x00012000);
    setLongBE(rom.program, ROM_SELECTOR_POST + 0, 0x00013000);
    // Prepopulate the 4 variants too to avoid panic if rng != 0.
    for (let v = 1; v < 4; v++) {
      setLongBE(rom.program, ROM_SELECTOR_INIT + v * 4, 0x00012000 + v * 0x100);
      setLongBE(rom.program, ROM_SELECTOR_POST + v * 4, 0x00013000 + v * 0x100);
    }
    // variant); place ROM data in all 4 variants starting from
    // selector init.
    for (let v = 0; v < 4; v++) {
      const base = 0x00012000 + v * 0x100;
      for (let k = 0; k < (SLOT_ENTRY_COUNT - SECONDARY_PATH_CUTOFF); k++) {
        rom.program[base + k * 2 + 0] = 0xb0 + v;
        rom.program[base + k * 2 + 1] = k & 0xff;
      }
    }

    state.rng.seed = as_u32(0x1234) as unknown as typeof state.rng.seed;

    const calledFor: number[] = [];
    const r = stateSub186AC(state, rom, {
      fun_1bb28: addr => calledFor.push(addr),
      fun_18f46: () => {
        throw new Error("fun_18f46 must NOT be called in init path");
      },
    });

    expect(r.branch).toBe("init");
    expect(r.hasArmed).toBe(true);
    expect(r.variant).toBeGreaterThanOrEqual(0);
    expect(r.variant).toBeLessThan(4);
    expect(r.fun1BB28Calls).toBe(SLOT_ENTRY_COUNT);
    expect(r.fun18F46Calls).toBe(0);
    // sentinel became 1
    expect(state.workRam[SENTINEL_ADDR - WORK_RAM_BASE]).toBe(1);
    expect(calledFor).toHaveLength(SLOT_ENTRY_COUNT);
    for (let i = 0; i < SLOT_ENTRY_COUNT; i++) {
      expect(calledFor[i]).toBe(SLOT_TABLE_ADDR + i * SLOT_ENTRY_STRIDE);
    }
    // entry[0..0x17] entry[0]==i, entry[2..3]==primary[i*2]
    for (let i = 0; i < SECONDARY_PATH_CUTOFF; i++) {
      const entryOff = (SLOT_TABLE_ADDR - WORK_RAM_BASE) + i * SLOT_ENTRY_STRIDE;
      expect(readByte(state.workRam, entryOff + 0)).toBe(i);
      expect(readWordBE(state.workRam, entryOff + 2)).toBe(0xa000 | i);
      expect(readByte(state.workRam, entryOff + 4)).toBe((0x40 + i) & 0xff);
      expect(readByte(state.workRam, entryOff + 5)).toBe((0x80 + i) & 0xff);
      expect(readWordBE(state.workRam, entryOff + 6)).toBe(0xc000 | i);
    }
    // selector ptr post-init
    const selectorPtr = readLongBE(state.workRam, SELECTOR_PTR_ADDR - WORK_RAM_BASE);
    expect(selectorPtr).toBe(0x00013000 + r.variant * 0x100);
  });

  it("teardown: sentinel!=0 && !hasArmed → clear 0x24 entries, sentinel→0; fun_18f46 called for entry[2..3]==0xFFFF", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setWordBE(state.workRam, GAME_MODE_ADDR - WORK_RAM_BASE, 3);
    setWordBE(state.workRam, OBJ_COUNT_ADDR - WORK_RAM_BASE, 0); // count=0 → no scan body
    state.workRam[SENTINEL_ADDR - WORK_RAM_BASE] = 1;

    // Prepopulate the slot table: entries 0 and 5 have entry[2..3]==0xFFFF (trigger),
    const tableOff = SLOT_TABLE_ADDR - WORK_RAM_BASE;
    for (let i = 0; i < SLOT_ENTRY_COUNT; i++) {
      const entryOff = tableOff + i * SLOT_ENTRY_STRIDE;
      state.workRam[entryOff + 0] = i & 0xff;
      const trigger = i === 0 || i === 5;
      setWordBE(state.workRam, entryOff + 2, trigger ? TEARDOWN_TRIGGER_WORD : 0x1234);
      state.workRam[entryOff + 4] = 0x77;
      state.workRam[entryOff + 5] = 0x88;
      setWordBE(state.workRam, entryOff + 6, 0x9abc);
    }

    const calls: { arg1: number; arg2: number }[] = [];
    const r = stateSub186AC(state, rom, {
      fun_18f46: (a1, a2) => calls.push({ arg1: a1, arg2: a2 }),
      fun_1bb28: () => {
        throw new Error("fun_1bb28 must NOT be called in teardown path");
      },
    });

    expect(r.branch).toBe("teardown");
    expect(r.hasArmed).toBe(false);
    expect(r.fun1BB28Calls).toBe(0);
    expect(r.fun18F46Calls).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ arg1: 0x29, arg2: 0 }); // sext_l(0) = 0
    expect(calls[1]).toEqual({ arg1: 0x29, arg2: 5 }); // sext_l(5) = 5

    expect(state.workRam[SENTINEL_ADDR - WORK_RAM_BASE]).toBe(0);

    // All entries have entry[2..3]=0, entry[4]=0, entry[5]=0, entry[6..7]=0
    for (let i = 0; i < SLOT_ENTRY_COUNT; i++) {
      const entryOff = tableOff + i * SLOT_ENTRY_STRIDE;
      expect(readWordBE(state.workRam, entryOff + 2)).toBe(0);
      expect(state.workRam[entryOff + 4]).toBe(0);
      expect(state.workRam[entryOff + 5]).toBe(0);
      expect(readWordBE(state.workRam, entryOff + 6)).toBe(0);
      expect(state.workRam[entryOff + 0]).toBe(i & 0xff);
    }
  });

  it("teardown sext_l: byte 0xFF → arg2 = 0xFFFFFFFF (sign-extended)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    setWordBE(state.workRam, GAME_MODE_ADDR - WORK_RAM_BASE, 3);
    setWordBE(state.workRam, OBJ_COUNT_ADDR - WORK_RAM_BASE, 0);
    state.workRam[SENTINEL_ADDR - WORK_RAM_BASE] = 1;

    // Only entry 0: entry[0]=0xFF, entry[2..3]=0xFFFF (trigger)
    const tableOff = SLOT_TABLE_ADDR - WORK_RAM_BASE;
    state.workRam[tableOff + 0] = 0xff;
    setWordBE(state.workRam, tableOff + 2, TEARDOWN_TRIGGER_WORD);

    const calls: { arg1: number; arg2: number }[] = [];
    const r = stateSub186AC(state, rom, {
      fun_18f46: (a1, a2) => calls.push({ arg1: a1, arg2: a2 }),
    });
    expect(r.branch).toBe("teardown");
    expect(calls[0]?.arg2).toBe(0xffffffff);
  });
});
