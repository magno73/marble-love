/**
 * state-sub-2c60.test.ts — smoke + corner case di FUN_2C60.
 */

import { describe, it, expect } from "vitest";
import { stateSub2C60 } from "../src/state-sub-2c60.js";
import { emptyGameState } from "../src/state.js";

const DATA_BASE = 0x1f04;
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

describe("stateSub2C60 (FUN_2C60)", () => {
  it("non solleva eccezioni con state vuoto e claima il primo slot", () => {
    const s = emptyGameState();
    const out = stateSub2C60(s, 0xdeadbeef, 0x1234);
    expect(out.claimed).toBe(1);
    expect(out.slot).toBe(0);
    expect(readLong(s, DATA_BASE + 0)).toBe(0xdeadbeef);
    expect(s.workRam[STATE_BASE + 0]).toBe(4);
    expect(readWord(s, THRESHOLD_BASE + 0)).toBe(0x1234);
    expect(readWord(s, COUNTER_BASE + 0)).toBe(0);
    expect(s.workRam[FLAG34_BASE + 0]).toBe(0);
  });

  it("salta slot busy e claima il primo libero", () => {
    const s = emptyGameState();
    // Slot 0 e 1 occupati
    s.workRam[STATE_BASE + 0] = 3;
    s.workRam[STATE_BASE + 1] = 5;
    // Slot 2 libero
    s.workRam[STATE_BASE + 2] = 0;
    s.workRam[STATE_BASE + 3] = 7;

    const out = stateSub2C60(s, 0xcafe1234, 0xabcd);
    expect(out.claimed).toBe(1);
    expect(out.slot).toBe(2);

    // Slot 2 popolato
    expect(readLong(s, DATA_BASE + 2 * 4)).toBe(0xcafe1234);
    expect(s.workRam[STATE_BASE + 2]).toBe(4);
    expect(readWord(s, THRESHOLD_BASE + 2 * 2)).toBe(0xabcd);
    expect(readWord(s, COUNTER_BASE + 2 * 2)).toBe(0);
    expect(s.workRam[FLAG34_BASE + 2]).toBe(0);

    // Slot 0/1/3 invariati (state)
    expect(s.workRam[STATE_BASE + 0]).toBe(3);
    expect(s.workRam[STATE_BASE + 1]).toBe(5);
    expect(s.workRam[STATE_BASE + 3]).toBe(7);
  });

  it("nessuno slot libero → claimed=0, nessuna modifica", () => {
    const s = emptyGameState();
    for (let i = 0; i < 4; i++) {
      s.workRam[STATE_BASE + i] = i + 1;
      s.workRam[DATA_BASE + i * 4] = 0xa0;
      s.workRam[DATA_BASE + i * 4 + 1] = 0xa1;
      s.workRam[DATA_BASE + i * 4 + 2] = 0xa2;
      s.workRam[DATA_BASE + i * 4 + 3] = 0xa3;
    }
    const dataBefore: number[] = [];
    for (let i = 0; i < 4; i++) dataBefore[i] = readLong(s, DATA_BASE + i * 4);

    const out = stateSub2C60(s, 0x11223344, 0x5566);
    expect(out.claimed).toBe(0);
    expect(out.slot).toBe(-1);

    // Tabella invariata
    for (let i = 0; i < 4; i++) {
      expect(readLong(s, DATA_BASE + i * 4)).toBe(dataBefore[i]);
      expect(s.workRam[STATE_BASE + i]).toBe(i + 1);
    }
  });

  it("solo low word di arg2 viene scritto in THRESHOLD (matching move.w)", () => {
    const s = emptyGameState();
    const out = stateSub2C60(s, 0xdeadbeef, 0x12345678);
    expect(out.claimed).toBe(1);
    expect(readWord(s, THRESHOLD_BASE)).toBe(0x5678);
  });

  it("threshold con bit 15 settato (negativo signed) preservato come word puro", () => {
    const s = emptyGameState();
    // arg2 = -1 (sign-extended 0xFFFFFFFF)
    const out = stateSub2C60(s, 0x10000, 0xffffffff | 0);
    expect(out.claimed).toBe(1);
    expect(readWord(s, THRESHOLD_BASE)).toBe(0xffff);
  });

  it("scelta slot 3 quando slot 0/1/2 sono busy", () => {
    const s = emptyGameState();
    s.workRam[STATE_BASE + 0] = 1;
    s.workRam[STATE_BASE + 1] = 2;
    s.workRam[STATE_BASE + 2] = 3;
    s.workRam[STATE_BASE + 3] = 0;
    const out = stateSub2C60(s, 0xc0ffee01, 0x0042);
    expect(out.slot).toBe(3);
    expect(readLong(s, DATA_BASE + 3 * 4)).toBe(0xc0ffee01);
    expect(s.workRam[STATE_BASE + 3]).toBe(4);
    expect(readWord(s, THRESHOLD_BASE + 3 * 2)).toBe(0x0042);
  });
});
