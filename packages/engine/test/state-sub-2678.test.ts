/**
 * state-sub-2678.test.ts — smoke + corner case di FUN_2678.
 */

import { describe, it, expect } from "vitest";
import { stateSub2678 } from "../src/state-sub-2678.js";
import { emptyGameState } from "../src/state.js";

const DATA_BASE = 0x1f04;
const STATE_BASE = 0x1f1c;

function writeLong(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

function readLong(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

describe("stateSub2678 (FUN_2678)", () => {
  it("non solleva eccezioni con state vuoto", () => {
    const s = emptyGameState();
    expect(() => stateSub2678(s, 0)).not.toThrow();
  });

  it("argLong=0 con DATA_PTR tutti zero → azzera tutti STATE (match all-zero)", () => {
    const s = emptyGameState();
    // Tutti gli slot sono 0 (default emptyGameState), ma popolo gli STATE
    for (let i = 0; i < 4; i++) s.workRam[STATE_BASE + i] = i + 1;
    stateSub2678(s, 0);
    // arg=0 e DATA_PTR=0 ⇒ match per tutti gli slot ⇒ STATE azzerato
    for (let i = 0; i < 4; i++) {
      expect(s.workRam[STATE_BASE + i]).toBe(0);
    }
  });

  it("match solo nello slot esatto: deregistra solo quello", () => {
    const s = emptyGameState();
    // Setup: 4 slot con pointer diversi e state non zero
    writeLong(s, DATA_BASE + 0, 0xdeadbeef);
    writeLong(s, DATA_BASE + 4, 0xcafe1234);
    writeLong(s, DATA_BASE + 8, 0x12345678);
    writeLong(s, DATA_BASE + 12, 0x87654321);
    s.workRam[STATE_BASE + 0] = 1;
    s.workRam[STATE_BASE + 1] = 2;
    s.workRam[STATE_BASE + 2] = 3;
    s.workRam[STATE_BASE + 3] = 4;

    stateSub2678(s, 0x12345678);

    // Slot 2 azzerato
    expect(readLong(s, DATA_BASE + 8)).toBe(0);
    expect(s.workRam[STATE_BASE + 2]).toBe(0);
    // Altri slot intatti
    expect(readLong(s, DATA_BASE + 0)).toBe(0xdeadbeef);
    expect(s.workRam[STATE_BASE + 0]).toBe(1);
    expect(readLong(s, DATA_BASE + 4)).toBe(0xcafe1234);
    expect(s.workRam[STATE_BASE + 1]).toBe(2);
    expect(readLong(s, DATA_BASE + 12)).toBe(0x87654321);
    expect(s.workRam[STATE_BASE + 3]).toBe(4);
  });

  it("match in più slot: tutti deregistrati", () => {
    const s = emptyGameState();
    const target = 0xaabbccdd;
    writeLong(s, DATA_BASE + 0, target);
    writeLong(s, DATA_BASE + 4, 0x11223344);
    writeLong(s, DATA_BASE + 8, target);
    writeLong(s, DATA_BASE + 12, target);
    for (let i = 0; i < 4; i++) s.workRam[STATE_BASE + i] = 5;

    stateSub2678(s, target);

    expect(readLong(s, DATA_BASE + 0)).toBe(0);
    expect(s.workRam[STATE_BASE + 0]).toBe(0);
    expect(readLong(s, DATA_BASE + 4)).toBe(0x11223344);
    expect(s.workRam[STATE_BASE + 1]).toBe(5);
    expect(readLong(s, DATA_BASE + 8)).toBe(0);
    expect(s.workRam[STATE_BASE + 2]).toBe(0);
    expect(readLong(s, DATA_BASE + 12)).toBe(0);
    expect(s.workRam[STATE_BASE + 3]).toBe(0);
  });

  it("nessun match: nessun cambiamento (eccetto stub fun_2abc invocato)", () => {
    const s = emptyGameState();
    writeLong(s, DATA_BASE + 0, 0x10000000);
    writeLong(s, DATA_BASE + 4, 0x20000000);
    writeLong(s, DATA_BASE + 8, 0x30000000);
    writeLong(s, DATA_BASE + 12, 0x40000000);
    for (let i = 0; i < 4; i++) s.workRam[STATE_BASE + i] = 7;

    let called = 0;
    let receivedArg = -1;
    stateSub2678(s, 0xffffffff, {
      fun_2abc: (a: number): void => {
        called++;
        receivedArg = a;
      },
    });

    expect(called).toBe(1);
    expect(receivedArg).toBe(0xffffffff);
    // Tabella invariata
    expect(readLong(s, DATA_BASE + 0)).toBe(0x10000000);
    expect(readLong(s, DATA_BASE + 4)).toBe(0x20000000);
    expect(readLong(s, DATA_BASE + 8)).toBe(0x30000000);
    expect(readLong(s, DATA_BASE + 12)).toBe(0x40000000);
    for (let i = 0; i < 4; i++) {
      expect(s.workRam[STATE_BASE + i]).toBe(7);
    }
  });

  it("stub fun_2abc riceve esattamente argLong (anche dopo match)", () => {
    const s = emptyGameState();
    const arg = 0xfeedface;
    writeLong(s, DATA_BASE + 0, arg);

    let received = -1;
    stateSub2678(s, arg, {
      fun_2abc: (a: number): void => {
        received = a;
      },
    });

    expect(received).toBe(arg);
  });
});
