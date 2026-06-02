/**
 * Test objectEnterState23 (FUN_160D4) - smoke tests for direct writes.
 *
 * FUN_160D4 (34 bytes) sets `obj[0x1A] = 0x23` and
 *
 * `cli/src/test-object-enter-state-23-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  objectEnterState23,
  OBJECT_STATE_BYTE_OFF,
  OBJECT_TIMER_LONG_OFF,
  STATE_VALUE_23,
  TIMER_LONG_VALUE,
} from "../src/object-enter-state-23.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;

describe("objectEnterState23 (FUN_160D4)", () => {
  it("writes 0x23 al byte of state and 0x00070000 al timer long (big-endian)", () => {
    const s = emptyGameState();
    const ptr = 0x00401e00;
    const off = ptr - WORK_RAM_BASE;

    objectEnterState23(s, ptr);

    expect(s.workRam[off + OBJECT_STATE_BYTE_OFF]).toBe(STATE_VALUE_23);
    expect(STATE_VALUE_23).toBe(0x23);

    // long timer @ +0x68 in big-endian: 00 07 00 00
    expect(s.workRam[off + OBJECT_TIMER_LONG_OFF + 0]).toBe(0x00);
    expect(s.workRam[off + OBJECT_TIMER_LONG_OFF + 1]).toBe(0x07);
    expect(s.workRam[off + OBJECT_TIMER_LONG_OFF + 2]).toBe(0x00);
    expect(s.workRam[off + OBJECT_TIMER_LONG_OFF + 3]).toBe(0x00);
    expect(TIMER_LONG_VALUE).toBe(0x00070000);
  });

  it("non tocca byte outside from the due fields (1A and 68..6B)", () => {
    const s = emptyGameState();
    const ptr = 0x00401c00;
    const off = ptr - WORK_RAM_BASE;

    for (let i = 0; i < 0x80; i++) {
      s.workRam[off + i] = 0xaa;
    }

    objectEnterState23(s, ptr);

    expect(s.workRam[off + 0x1a]).toBe(0x23);
    expect(s.workRam[off + 0x68]).toBe(0x00);
    expect(s.workRam[off + 0x69]).toBe(0x07);
    expect(s.workRam[off + 0x6a]).toBe(0x00);
    expect(s.workRam[off + 0x6b]).toBe(0x00);

    for (let i = 0; i < 0x80; i++) {
      if (i === 0x1a) continue;
      if (i >= 0x68 && i <= 0x6b) continue;
      expect(s.workRam[off + i]).toBe(0xaa);
    }
  });

  it("idempotente: chiamate ripetute lasciano la same scrittura", () => {
    const s = emptyGameState();
    const ptr = 0x00401d80;
    const off = ptr - WORK_RAM_BASE;

    objectEnterState23(s, ptr);
    const after1 = new Uint8Array(s.workRam);
    objectEnterState23(s, ptr);
    const after2 = new Uint8Array(s.workRam);
    objectEnterState23(s, ptr);
    const after3 = new Uint8Array(s.workRam);

    expect(after2).toEqual(after1);
    expect(after3).toEqual(after1);

    expect(s.workRam[off + 0x1a]).toBe(0x23);
    expect(s.workRam[off + 0x68]).toBe(0x00);
    expect(s.workRam[off + 0x69]).toBe(0x07);
  });

  it("supporta più oggetti distinti senza overlap", () => {
    const s = emptyGameState();
    const ptrA = 0x00401c00;
    const ptrB = 0x00401d00; // 0x100 = 256 byte, ben beyond i 0x6C used

    objectEnterState23(s, ptrA);
    expect(s.workRam[ptrB - WORK_RAM_BASE + 0x1a]).toBe(0x00);
    expect(s.workRam[ptrB - WORK_RAM_BASE + 0x69]).toBe(0x00);

    objectEnterState23(s, ptrB);
    expect(s.workRam[ptrA - WORK_RAM_BASE + 0x1a]).toBe(0x23);
    expect(s.workRam[ptrA - WORK_RAM_BASE + 0x69]).toBe(0x07);
    expect(s.workRam[ptrB - WORK_RAM_BASE + 0x1a]).toBe(0x23);
    expect(s.workRam[ptrB - WORK_RAM_BASE + 0x69]).toBe(0x07);
  });

  it("sovrascrive byte of state precedente (e.g. 0x21 → 0x23)", () => {
    const s = emptyGameState();
    const ptr = 0x00401e80;
    const off = ptr - WORK_RAM_BASE;

    s.workRam[off + 0x1a] = 0x21;
    s.workRam[off + 0x68] = 0xff;
    s.workRam[off + 0x69] = 0xff;
    s.workRam[off + 0x6a] = 0xff;
    s.workRam[off + 0x6b] = 0xff;

    objectEnterState23(s, ptr);

    expect(s.workRam[off + 0x1a]).toBe(0x23);
    expect(s.workRam[off + 0x68]).toBe(0x00);
    expect(s.workRam[off + 0x69]).toBe(0x07);
    expect(s.workRam[off + 0x6a]).toBe(0x00);
    expect(s.workRam[off + 0x6b]).toBe(0x00);
  });
});
