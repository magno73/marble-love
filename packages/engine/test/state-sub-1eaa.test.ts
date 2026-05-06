/**
 * state-sub-1eaa.test.ts — smoke + corner case di FUN_1EAA.
 */

import { describe, it, expect } from "vitest";
import { stateSub1EAA } from "../src/state-sub-1eaa.js";
import type { StateSub1EAASubs } from "../src/state-sub-1eaa.js";
import { emptyGameState } from "../src/state.js";

interface CallArgs {
  ptr: number;
  word: number;
  zero: number;
}

function recordingSubs(log: CallArgs[]): StateSub1EAASubs {
  return {
    fun_33f4: (ptr: number, word: number, zero: number): void => {
      log.push({ ptr, word, zero });
    },
  };
}

describe("stateSub1EAA (FUN_1EAA)", () => {
  it("count <= 0: nessuna chiamata e nessuna eccezione", () => {
    const s = emptyGameState();
    const log: CallArgs[] = [];
    expect(() => stateSub1EAA(s, 0xa03100, 5, 0, recordingSubs(log))).not.toThrow();
    expect(log).toHaveLength(0);

    log.length = 0;
    stateSub1EAA(s, 0xa03100, 5, -3, recordingSubs(log));
    expect(log).toHaveLength(0);

    // 0x80000000 è MIN_INT32 (signed) → tst.l → ble → exit immediato
    log.length = 0;
    stateSub1EAA(s, 0xa03100, 5, 0x80000000, recordingSubs(log));
    expect(log).toHaveLength(0);
  });

  it("count = 1: una chiamata con args base", () => {
    const s = emptyGameState();
    const log: CallArgs[] = [];
    stateSub1EAA(s, 0xa03100, 0x000a, 1, recordingSubs(log));
    expect(log).toEqual([{ ptr: 0xa03100, word: 10, zero: 0 }]);
  });

  it("count = 4: ptr +=4, tile id +=1 ad ogni iter", () => {
    const s = emptyGameState();
    const log: CallArgs[] = [];
    stateSub1EAA(s, 0xa03200, 0x0020, 4, recordingSubs(log));
    expect(log).toEqual([
      { ptr: 0xa03200, word: 0x20, zero: 0 },
      { ptr: 0xa03204, word: 0x21, zero: 0 },
      { ptr: 0xa03208, word: 0x22, zero: 0 },
      { ptr: 0xa0320c, word: 0x23, zero: 0 },
    ]);
  });

  it("usa solo la low word di arg2 (mask 0xFFFF) e la sign-extend per la call", () => {
    const s = emptyGameState();
    const log: CallArgs[] = [];
    // arg2 = 0xCAFE8000 → low word 0x8000 (= -32768 signed) → sext → -32768.
    stateSub1EAA(s, 0x400000, 0xcafe8000, 2, recordingSubs(log));
    expect(log).toEqual([
      { ptr: 0x400000, word: -32768, zero: 0 },
      { ptr: 0x400004, word: -32767, zero: 0 },
    ]);
  });

  it("D3w wraps a 16 bit: 0xFFFE +1 → 0xFFFF (sext -1) +1 → 0x0000 (sext 0)", () => {
    const s = emptyGameState();
    const log: CallArgs[] = [];
    stateSub1EAA(s, 0x400000, 0xfffe, 3, recordingSubs(log));
    expect(log[0]?.word).toBe(-2); // sext(0xFFFE)
    expect(log[1]?.word).toBe(-1); // sext(0xFFFF)
    expect(log[2]?.word).toBe(0); // sext(0x0000) — wrapped
  });

  it("ptr (D4) wrap a 32 bit", () => {
    const s = emptyGameState();
    const log: CallArgs[] = [];
    stateSub1EAA(s, 0xfffffffc, 0, 2, recordingSubs(log));
    expect(log[0]?.ptr).toBe(0xfffffffc);
    expect(log[1]?.ptr).toBe(0); // 0xfffffffc + 4 = 0x100000000 → wrap 0
  });

  it("subs undefined → no throw, count > 0 ok", () => {
    const s = emptyGameState();
    expect(() => stateSub1EAA(s, 0x400000, 0, 5)).not.toThrow();
  });

  it("zero arg sempre passato come 0 (clr.l -(SP))", () => {
    const s = emptyGameState();
    const log: CallArgs[] = [];
    stateSub1EAA(s, 0x400000, 0xffff, 1, recordingSubs(log));
    expect(log[0]?.zero).toBe(0);
  });
});
