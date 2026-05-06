/**
 * state-sub-2bda.test.ts — smoke + corner case di FUN_2BDA.
 */

import { describe, it, expect } from "vitest";
import { stateSub2BDA } from "../src/state-sub-2bda.js";
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

describe("stateSub2BDA (FUN_2BDA)", () => {
  it("non solleva eccezioni con state vuoto e ritorna 1 (slot 0 libero)", () => {
    const s = emptyGameState();
    const ret = stateSub2BDA(s, 0, 0, 0);
    expect(ret).toBe(1);
    // Slot 0 occupato in stato 3
    expect(s.workRam[STATE_BASE + 0]).toBe(3);
  });

  it("registra nel primo slot vuoto saltando quelli occupati", () => {
    const s = emptyGameState();
    // Slot 0 e 1 occupati (state != 0); slot 2 e 3 vuoti.
    s.workRam[STATE_BASE + 0] = 1;
    s.workRam[STATE_BASE + 1] = 5;

    const arg1 = 0xdeadbeef;
    const arg2 = 0x1234abcd; // low word: 0xabcd
    const arg3 = 0xffff0042; // low word: 0x0042

    const ret = stateSub2BDA(s, arg1, arg2, arg3);
    expect(ret).toBe(1);

    // Slot 2 deve essere quello allocato
    expect(readLong(s, DATA_BASE + 2 * 4)).toBe(arg1);
    expect(s.workRam[STATE_BASE + 2]).toBe(3);
    expect(readWord(s, THRESHOLD_BASE + 2 * 2)).toBe(0x0042);
    expect(readWord(s, WORD16_BASE + 2 * 2)).toBe(0xabcd);
    expect(readWord(s, COUNTER_BASE + 2 * 2)).toBe(0);
    expect(s.workRam[FLAG34_BASE + 2]).toBe(0);

    // Altri slot intatti
    expect(s.workRam[STATE_BASE + 0]).toBe(1);
    expect(s.workRam[STATE_BASE + 1]).toBe(5);
    expect(s.workRam[STATE_BASE + 3]).toBe(0);
  });

  it("ritorna 0 senza modifiche se tutti gli slot sono occupati", () => {
    const s = emptyGameState();
    for (let i = 0; i < 4; i++) s.workRam[STATE_BASE + i] = 1;
    // Pre-popolazione struct per verificare invarianza
    s.workRam[DATA_BASE + 0] = 0xaa;
    s.workRam[THRESHOLD_BASE + 0] = 0xbb;
    s.workRam[WORD16_BASE + 0] = 0xcc;
    s.workRam[COUNTER_BASE + 0] = 0xdd;
    s.workRam[FLAG34_BASE + 0] = 0xee;

    const ret = stateSub2BDA(s, 0x12345678, 0x9abc, 0xdef0);
    expect(ret).toBe(0);

    // Tutto invariato
    for (let i = 0; i < 4; i++) expect(s.workRam[STATE_BASE + i]).toBe(1);
    expect(s.workRam[DATA_BASE + 0]).toBe(0xaa);
    expect(s.workRam[THRESHOLD_BASE + 0]).toBe(0xbb);
    expect(s.workRam[WORD16_BASE + 0]).toBe(0xcc);
    expect(s.workRam[COUNTER_BASE + 0]).toBe(0xdd);
    expect(s.workRam[FLAG34_BASE + 0]).toBe(0xee);
  });

  it("usa solo la low-word di arg2 e arg3 (mask 0xFFFF)", () => {
    const s = emptyGameState();
    // arg2 e arg3 sono "long" passati sullo stack ma il binario li legge
    // come word: i top 16 bit sono ignorati.
    const ret = stateSub2BDA(s, 0xcafe1234, 0xdead5678, 0xbeef9abc);
    expect(ret).toBe(1);
    expect(readWord(s, WORD16_BASE + 0)).toBe(0x5678);
    expect(readWord(s, THRESHOLD_BASE + 0)).toBe(0x9abc);
    expect(readLong(s, DATA_BASE + 0)).toBe(0xcafe1234);
  });

  it("azzera COUNTER e FLAG34 dello slot allocato anche se erano sporchi", () => {
    const s = emptyGameState();
    // Slot 0 vuoto ma con COUNTER e FLAG34 sporchi (residui)
    s.workRam[COUNTER_BASE + 0] = 0xff;
    s.workRam[COUNTER_BASE + 1] = 0xff;
    s.workRam[FLAG34_BASE + 0] = 0x42;

    const ret = stateSub2BDA(s, 0x11111111, 0x2222, 0x3333);
    expect(ret).toBe(1);
    expect(readWord(s, COUNTER_BASE + 0)).toBe(0);
    expect(s.workRam[FLAG34_BASE + 0]).toBe(0);
  });
});
