/**
 * state-sub-5608.test.ts — smoke tests of stateSub5608 (FUN_5608).
 *
 *   - branch on ROM byte @ 0x10072 (D2 = 4 vs 8)
 *   - default callback no-op
 */

import { describe, it, expect } from "vitest";
import {
  stateSub5608,
  PTR_LITERAL_1,
  PTR_LITERAL_2,
  ROW_IMM_1,
  ROW_IMM_2,
} from "../src/state-sub-5608.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

describe("stateSub5608 (FUN_5608)", () => {
  it("ROM byte @ 0x10072 == 0 → D2=8 → arg1 = 11 (52DA #1) and 12 (52DA #2)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    type Call52DA = { arg1: number; arg2: number; arg3: number };
    const calls52DA: Call52DA[] = [];
    const calls5334: number[] = [];

    stateSub5608(
      state,
      rom,
      (arg1, arg2, arg3) => {
        calls52DA.push({ arg1, arg2, arg3 });
        return 0;
      },
      (argLong) => {
        calls5334.push(argLong);
        return 0;
      },
    );

    expect(calls52DA).toHaveLength(2);
    expect(calls5334).toHaveLength(1);
    // D2 = 8 → arg1 phase 1 = 11, arg1 phase 3 = 12
    expect(calls52DA[0]).toEqual({
      arg1: 11,
      arg2: ROW_IMM_1,
      arg3: PTR_LITERAL_1,
    });
    expect(calls52DA[1]).toEqual({
      arg1: 12,
      arg2: ROW_IMM_2,
      arg3: PTR_LITERAL_2,
    });
  });

  it("ROM byte @ 0x10072 != 0 → D2=4 → arg1 = 7 (52DA #1) and 8 (52DA #2)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x10072] = 0x01;

    const calls52DA: { arg1: number; arg2: number; arg3: number }[] = [];
    stateSub5608(state, rom, (arg1, arg2, arg3) => {
      calls52DA.push({ arg1, arg2, arg3 });
      return 0;
    });

    expect(calls52DA).toHaveLength(2);
    expect(calls52DA[0]!.arg1).toBe(7); // 4+3
    expect(calls52DA[1]!.arg1).toBe(8); // 4+4
  });

  it("reads long BE from ROM @ 0x10074 and passes it as argLong to 5334", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    // long BE 0xDEADBEEF at ROM[0x10074..0x10077]
    rom.program[0x10074] = 0xde;
    rom.program[0x10075] = 0xad;
    rom.program[0x10076] = 0xbe;
    rom.program[0x10077] = 0xef;

    const calls5334: number[] = [];
    stateSub5608(state, rom, undefined, (argLong) => {
      calls5334.push(argLong);
      return 0;
    });

    expect(calls5334).toEqual([0xdeadbeef >>> 0]);
  });

  it("invocation order: 52DA #1 → 5334 → 52DA #2", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x10074] = 0x01;
    rom.program[0x10075] = 0x02;
    rom.program[0x10076] = 0x03;
    rom.program[0x10077] = 0x04;

    const order: string[] = [];
    stateSub5608(
      state,
      rom,
      (_a1, a2) => {
        // distinguish 52DA #1 (arg2 == 0x1B) from 52DA #2 (arg2 == 0x1C)
        order.push(a2 === ROW_IMM_1 ? "52DA#1" : "52DA#2");
        return 0;
      },
      () => {
        order.push("5334");
        return 0;
      },
    );

    expect(order).toEqual(["52DA#1", "5334", "52DA#2"]);
  });

  it("default callbacks no-op: returns void without mutating workRam or ROM", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x10072] = 0x42;
    const workRamBefore = new Uint8Array(state.workRam);
    const romBefore = new Uint8Array(rom.program);

    const r = stateSub5608(state, rom);

    expect(r).toBeUndefined();
    expect(state.workRam).toEqual(workRamBefore);
    expect(rom.program).toEqual(romBefore);
  });

  it("inner52DA is ONE same function invoked 2 times (no cross-pollution with inner5334)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    let count52DA = 0;
    let count5334 = 0;
    stateSub5608(
      state,
      rom,
      () => {
        count52DA++;
        return 0xaaaaaaaa;
      },
      () => {
        count5334++;
        return 0xbbbbbbbb;
      },
    );

    expect(count52DA).toBe(2);
    expect(count5334).toBe(1);
  });

  it("rom.program[0x10072] boundary values: 0xFF → branch D2=4, 0x80 → branch D2=4, 0x00 → branch D2=8", () => {
    const state = emptyGameState();

    for (const [b, expectedD2] of [
      [0x00, 8],
      [0x01, 4],
      [0x7f, 4],
      [0x80, 4],
      [0xff, 4],
    ] as const) {
      const rom = emptyRomImage();
      rom.program[0x10072] = b;
      let firstArg1 = -1;
      stateSub5608(state, rom, (arg1) => {
        if (firstArg1 === -1) firstArg1 = arg1;
        return 0;
      });
      // D2+3 = expectedD2 + 3
      expect(firstArg1).toBe(expectedD2 + 3);
    }
  });

  it("does not mutate state.workRam with the default callbacks (the inners are not forced no-ops on workRam)", () => {
    const state = emptyGameState();
    state.workRam[0x100] = 0x99;
    state.workRam[0x1f5e] = 0xaa;
    state.workRam[0x1f98] = 0x55;
    const rom = emptyRomImage();
    const before = new Uint8Array(state.workRam);

    stateSub5608(state, rom);

    expect(state.workRam).toEqual(before);
  });
});
