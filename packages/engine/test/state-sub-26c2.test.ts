/**
 * state-sub-26c2.test.ts — smoke + corner case of FUN_26C2.
 *
 * FUN_26C2 runs: (1) renderStringChain(arg1, sext(arg2.w)) via stub;
 * (2) registers first empty slot in state 5/6 with threshold = abs(arg3.w).
 */

import { describe, it, expect } from "vitest";
import { stateSub26C2 } from "../src/state-sub-26c2.js";
import { emptyGameState } from "../src/state.js";

const DATA_BASE = 0x1f04;
const WORD16_BASE = 0x1f14;
const STATE_BASE = 0x1f1c;
const THRESHOLD_BASE = 0x1f20;
const COUNTER_BASE = 0x1f28;
const FLAG34_BASE = 0x1f34;

function readLong(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function readWord(s: ReturnType<typeof emptyGameState>, off: number): number {
  return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
}

describe("stateSub26C2 (FUN_26C2)", () => {
  it("registra slot 0 in state=5 con arg3.w >= 0 (threshold positiva)", () => {
    const s = emptyGameState();
    const calls: Array<[number, number]> = [];
    const ret = stateSub26C2(s, 0xdeadbeef, 0x0000abcd, 0x00000042, {
      fun_2572: (a, b) => calls.push([a >>> 0, b | 0]),
    });
    expect(ret).toBe(1);
    // renderStringChain called with (arg1, sext(arg2.w)).
    expect(calls).toEqual([[0xdeadbeef, 0xffffabcd | 0]]);
    // Slot 0
    expect(readLong(s, DATA_BASE + 0)).toBe(0xdeadbeef);
    expect(s.workRam[STATE_BASE + 0]).toBe(5);
    expect(readWord(s, THRESHOLD_BASE + 0)).toBe(0x0042);
    expect(readWord(s, WORD16_BASE + 0)).toBe(0xabcd);
    expect(readWord(s, COUNTER_BASE + 0)).toBe(0);
  });

  it("registra in state=6 con arg3.w < 0 and uses abs as threshold", () => {
    const s = emptyGameState();
    // arg3.w = 0xFF80 → -128 signed. abs = 128 = 0x0080.
    const ret = stateSub26C2(s, 0x11112222, 0x00003333, 0x0000ff80);
    expect(ret).toBe(1);
    expect(s.workRam[STATE_BASE + 0]).toBe(6);
    expect(readWord(s, THRESHOLD_BASE + 0)).toBe(0x0080);
    expect(readWord(s, WORD16_BASE + 0)).toBe(0x3333);
    expect(readLong(s, DATA_BASE + 0)).toBe(0x11112222);
  });

  it("skips slot occupied and takes il first free", () => {
    const s = emptyGameState();
    s.workRam[STATE_BASE + 0] = 1;
    s.workRam[STATE_BASE + 1] = 4;
    // Slot 2 vuoto
    const ret = stateSub26C2(s, 0xcafebabe, 0x00001234, 0x00000005);
    expect(ret).toBe(1);
    expect(s.workRam[STATE_BASE + 2]).toBe(5);
    expect(readLong(s, DATA_BASE + 2 * 4)).toBe(0xcafebabe);
    expect(readWord(s, THRESHOLD_BASE + 2 * 2)).toBe(0x0005);
    expect(readWord(s, WORD16_BASE + 2 * 2)).toBe(0x1234);
    // Altri slot intact
    expect(s.workRam[STATE_BASE + 0]).toBe(1);
    expect(s.workRam[STATE_BASE + 1]).toBe(4);
    expect(s.workRam[STATE_BASE + 3]).toBe(0);
  });

  it("returns 0 but calls comunque renderStringChain se all slot busy", () => {
    const s = emptyGameState();
    for (let i = 0; i < 4; i++) s.workRam[STATE_BASE + i] = 1;
    const calls: Array<[number, number]> = [];
    const ret = stateSub26C2(s, 0x12345678, 0xffff9abc, 0xffffdef0, {
      fun_2572: (a, b) => calls.push([a >>> 0, b | 0]),
    });
    expect(ret).toBe(0);
    // renderStringChain called with (arg1, sext(0x9abc) = 0xffff9abc signed).
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe(0x12345678);
    expect(calls[0][1] | 0).toBe(0xffff9abc | 0);
    // Tutti the slot intact
    for (let i = 0; i < 4; i++) expect(s.workRam[STATE_BASE + i]).toBe(1);
  });

  it("uses solo low word of arg2 and arg3 (mask 0xFFFF)", () => {
    const s = emptyGameState();
    // arg2 and arg3 high bits ignorati per WORD16/THRESHOLD.
    const ret = stateSub26C2(s, 0xaaaabbbb, 0xdead5678, 0xbeef0001);
    expect(ret).toBe(1);
    expect(readWord(s, WORD16_BASE + 0)).toBe(0x5678);
    expect(readWord(s, THRESHOLD_BASE + 0)).toBe(0x0001);
    expect(s.workRam[STATE_BASE + 0]).toBe(5); // 0x0001 >= 0
  });

  it("non azzera FLAG34 (a differenza of FUN_2BDA/FUN_2C60)", () => {
    const s = emptyGameState();
    s.workRam[FLAG34_BASE + 0] = 0x77;
    const ret = stateSub26C2(s, 0x11111111, 0x2222, 0x3333);
    expect(ret).toBe(1);
    expect(s.workRam[STATE_BASE + 0]).toBe(5);
    // FLAG34 unchanged.
    expect(s.workRam[FLAG34_BASE + 0]).toBe(0x77);
  });

  it("threshold = 0x8000 when arg3.w == 0x8000 (-32768): -(-32768) low word", () => {
    const s = emptyGameState();
    // arg3.w = 0x8000 → -32768 signed → STATE = 6, threshold low word = 0x8000.
    const ret = stateSub26C2(s, 0, 0, 0x00008000);
    expect(ret).toBe(1);
    expect(s.workRam[STATE_BASE + 0]).toBe(6);
    expect(readWord(s, THRESHOLD_BASE + 0)).toBe(0x8000);
  });
});
