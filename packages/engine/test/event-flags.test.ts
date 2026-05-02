/**
 * Test consumeEventFlag (FUN_2548).
 *
 * Bit-perfect verificato vs binary (1000/1000) tramite
 * `cli/src/test-event-flags-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  consumeEventFlag,
  setFlagBit,
  addToObjectAccumAndFlag,
  detectRisingEdgesAndPass,
  EVENT_FLAGS_OFF,
  STATUS_FLAGS_OFF,
  OBJECT_TRIGGER_FLAGS_OFF,
  EDGE_DETECTOR_PREV_OFF,
  OBJ_FIELD_TYPE,
  OBJ_FIELD_ACCUM,
} from "../src/event-flags.js";
import { emptyGameState } from "../src/state.js";

describe("consumeEventFlag (FUN_2548)", () => {
  function setFlags(value: number) {
    const s = emptyGameState();
    s.workRam[EVENT_FLAGS_OFF] = (value >>> 8) & 0xff;
    s.workRam[EVENT_FLAGS_OFF + 1] = value & 0xff;
    return s;
  }
  function readFlags(s: ReturnType<typeof setFlags>): number {
    return ((s.workRam[EVENT_FLAGS_OFF] ?? 0) << 8) | (s.workRam[EVENT_FLAGS_OFF + 1] ?? 0);
  }

  it("flag word == 0: returns 0, stays 0", () => {
    const s = setFlags(0);
    expect(consumeEventFlag(s)).toBe(0);
    expect(readFlags(s)).toBe(0);
  });

  it("flag word == 1: returns 1, becomes 0", () => {
    const s = setFlags(1);
    expect(consumeEventFlag(s)).toBe(1);
    expect(readFlags(s)).toBe(0);
  });

  it("flag word == 0xFFFF: returns 1 (16 times to drain)", () => {
    const s = setFlags(0xffff);
    for (let i = 0; i < 16; i++) {
      expect(consumeEventFlag(s)).toBe(1);
    }
    expect(readFlags(s)).toBe(0);
    expect(consumeEventFlag(s)).toBe(0);
  });

  it("alternating bits 0xAAAA: 0,1,0,1,...", () => {
    // 0xAAAA = 1010101010101010 (LSB-first: 0,1,0,1,...)
    const s = setFlags(0xaaaa);
    const seq: number[] = [];
    for (let i = 0; i < 16; i++) seq.push(consumeEventFlag(s));
    expect(seq).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  });

  it("0x5555: 1,0,1,0,...", () => {
    const s = setFlags(0x5555);
    const seq: number[] = [];
    for (let i = 0; i < 16; i++) seq.push(consumeEventFlag(s));
    expect(seq).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]);
  });
});

describe("setFlagBit (FUN_5236)", () => {
  function readU32(s: ReturnType<typeof emptyGameState>): number {
    return (
      ((s.workRam[STATUS_FLAGS_OFF] ?? 0) << 24) |
      ((s.workRam[STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
      ((s.workRam[STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
      (s.workRam[STATUS_FLAGS_OFF + 3] ?? 0)
    ) >>> 0;
  }

  it("arg=0 → bit 0", () => {
    const s = emptyGameState();
    setFlagBit(s, 0);
    expect(readU32(s)).toBe(0x1);
  });

  it("arg=1 → bit 1", () => {
    const s = emptyGameState();
    setFlagBit(s, 1);
    expect(readU32(s)).toBe(0x2);
  });

  it("arg=2 → bit 0 (riusato)", () => {
    const s = emptyGameState();
    setFlagBit(s, 2);
    expect(readU32(s)).toBe(0x1);
  });

  it("arg=3 → bit 1", () => {
    const s = emptyGameState();
    setFlagBit(s, 3);
    expect(readU32(s)).toBe(0x2);
  });

  it("arg=10 → bit 8", () => {
    const s = emptyGameState();
    setFlagBit(s, 10);
    expect(readU32(s)).toBe(0x100);
  });

  it("OR con stato esistente (non clear)", () => {
    const s = emptyGameState();
    s.workRam[STATUS_FLAGS_OFF] = 0xAB;
    s.workRam[STATUS_FLAGS_OFF + 1] = 0xCD;
    s.workRam[STATUS_FLAGS_OFF + 2] = 0xEF;
    s.workRam[STATUS_FLAGS_OFF + 3] = 0x10;
    setFlagBit(s, 0);
    expect(readU32(s)).toBe(0xABCDEF11);
  });
});

describe("addToObjectAccumAndFlag (FUN_28608)", () => {
  function setObj(s: ReturnType<typeof emptyGameState>, objAddr: number, accum: number, type: number) {
    const off = objAddr - 0x400000;
    s.workRam[off + OBJ_FIELD_ACCUM] = (accum >>> 24) & 0xff;
    s.workRam[off + OBJ_FIELD_ACCUM + 1] = (accum >>> 16) & 0xff;
    s.workRam[off + OBJ_FIELD_ACCUM + 2] = (accum >>> 8) & 0xff;
    s.workRam[off + OBJ_FIELD_ACCUM + 3] = accum & 0xff;
    s.workRam[off + OBJ_FIELD_TYPE] = type;
  }
  function readAccum(s: ReturnType<typeof emptyGameState>, objAddr: number): number {
    const off = (objAddr - 0x400000) + OBJ_FIELD_ACCUM;
    return (
      ((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)
    ) >>> 0;
  }

  it("incrementa accumulator e setta bit `type`", () => {
    const s = emptyGameState();
    setObj(s, 0x401D00, 100, 3);
    addToObjectAccumAndFlag(s, 0x401D00, 50);
    expect(readAccum(s, 0x401D00)).toBe(150);
    expect(s.workRam[OBJECT_TRIGGER_FLAGS_OFF]).toBe(1 << 3);
  });

  it("type=0 setta bit 0", () => {
    const s = emptyGameState();
    setObj(s, 0x401D00, 0, 0);
    addToObjectAccumAndFlag(s, 0x401D00, 0);
    expect(s.workRam[OBJECT_TRIGGER_FLAGS_OFF]).toBe(1);
  });

  it("OR su flag esistente", () => {
    const s = emptyGameState();
    setObj(s, 0x401D00, 0, 5);
    s.workRam[OBJECT_TRIGGER_FLAGS_OFF] = 0xAA;
    addToObjectAccumAndFlag(s, 0x401D00, 0);
    expect(s.workRam[OBJECT_TRIGGER_FLAGS_OFF]).toBe(0xAA | (1 << 5));
  });

  it("type >= 8: OR a 8 bit (mask cap a 0xFF)", () => {
    // type=10: 1<<10 = 0x400, but byte OR uses only low 8 bits = 0
    const s = emptyGameState();
    setObj(s, 0x401D00, 0, 10);
    s.workRam[OBJECT_TRIGGER_FLAGS_OFF] = 0;
    addToObjectAccumAndFlag(s, 0x401D00, 0);
    expect(s.workRam[OBJECT_TRIGGER_FLAGS_OFF]).toBe(0); // bit shifted out of byte
  });

  it("accumulator wrap a 32-bit", () => {
    const s = emptyGameState();
    setObj(s, 0x401D00, 0xFFFFFFFE, 0);
    addToObjectAccumAndFlag(s, 0x401D00, 5);
    // 0xFFFFFFFE + 5 = 0x100000003 → wraps to 0x3
    expect(readAccum(s, 0x401D00)).toBe(0x3);
  });
});

describe("detectRisingEdgesAndPass (FUN_F6A)", () => {
  function setup(flag: number, prev: number) {
    const s = emptyGameState();
    s.workRam[0] = (flag >>> 8) & 0xff;
    s.workRam[1] = flag & 0xff;
    s.workRam[EDGE_DETECTOR_PREV_OFF] = (prev >>> 8) & 0xff;
    s.workRam[EDGE_DETECTOR_PREV_OFF + 1] = prev & 0xff;
    return s;
  }

  it("nessun cambiamento: no rising edges, ritorna solo high nibble", () => {
    // flag = 0x3000 (high nibble + low 0), prev = 0
    const s = setup(0x3000, 0);
    expect(detectRisingEdgesAndPass(s)).toBe(0x3000);
  });

  it("rising edge bit 0", () => {
    // flag = 0x0001 (low bit 0 set), prev = 0 → rising edge bit 0
    const s = setup(0x0001, 0);
    // high nibble = 0, rising = 1, return = 1
    expect(detectRisingEdgesAndPass(s)).toBe(1);
  });

  it("falling edge bit 0 (NO ritorno)", () => {
    // flag = 0 (current low bits = 0), prev = 1 → bit 0 fell, NOT rising
    const s = setup(0, 1);
    expect(detectRisingEdgesAndPass(s)).toBe(0);
  });

  it("salva nuovo prev (low 2 bits di flag)", () => {
    const s = setup(0xABC3, 0); // low 2 bits = 3
    detectRisingEdgesAndPass(s);
    const newPrev = ((s.workRam[EDGE_DETECTOR_PREV_OFF] ?? 0) << 8) |
                    (s.workRam[EDGE_DETECTOR_PREV_OFF + 1] ?? 0);
    expect(newPrev).toBe(3);
  });

  it("high nibble 0xF000: sext_l → 0xFFFFF000 nel return", () => {
    const s = setup(0xF002, 0); // high = 0xF, low2 = 2
    // rising edge bit 1 = 2. Result = 0xFFFFF000 | 2 = 0xFFFFF002
    expect(detectRisingEdgesAndPass(s) >>> 0).toBe(0xFFFFF002);
  });
});
