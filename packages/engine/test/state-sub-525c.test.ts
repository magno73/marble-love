/**
 * state-sub-525c.test.ts — corner cases di stateSub525C (FUN_525C).
 *
 * Qui copriamo i path principali (count tipici) e gli edge case di forma
 * della status-flags bitmap.
 */

import { describe, it, expect } from "vitest";
import {
  stateSub525C,
  fun523A,
  STATUS_FLAGS_OFF,
  BUFFER_OFFSET_FROM_A2,
} from "../src/state-sub-525c.js";
import { emptyGameState } from "../src/state.js";

function readStatusFlags(workRam: Uint8Array): number {
  return (
    (((workRam[STATUS_FLAGS_OFF] ?? 0) << 24) |
      ((workRam[STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
      ((workRam[STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
      (workRam[STATUS_FLAGS_OFF + 3] ?? 0)) >>>
    0
  );
}

describe("fun523A (FUN_523A) — internal bit-set helper", () => {
  it("D0=0 → bit 0 (D0<2 path, no subq)", () => {
    const s = emptyGameState();
    fun523A(s, 0);
    expect(readStatusFlags(s.workRam)).toBe(0x00000001);
  });

  it("D0=1 → bit 1 (boundary, no subq)", () => {
    const s = emptyGameState();
    fun523A(s, 1);
    expect(readStatusFlags(s.workRam)).toBe(0x00000002);
  });

  it("D0=2 → bit 0 (subq path: 2-2=0)", () => {
    const s = emptyGameState();
    fun523A(s, 2);
    expect(readStatusFlags(s.workRam)).toBe(0x00000001);
  });

  it("D0=6 → bit 4", () => {
    const s = emptyGameState();
    fun523A(s, 6);
    expect(readStatusFlags(s.workRam)).toBe(0x00000010);
  });

  it("D0=33 → shift 31, bit 31 (top bit)", () => {
    const s = emptyGameState();
    fun523A(s, 33);
    expect(readStatusFlags(s.workRam)).toBe(0x80000000);
  });

  it("D0=34 → shift 32, asl.l ≥32 produce 0 → no-op", () => {
    const s = emptyGameState();
    s.workRam[STATUS_FLAGS_OFF] = 0xab;
    s.workRam[STATUS_FLAGS_OFF + 1] = 0xcd;
    s.workRam[STATUS_FLAGS_OFF + 2] = 0xef;
    s.workRam[STATUS_FLAGS_OFF + 3] = 0x12;
    fun523A(s, 34);
    expect(readStatusFlags(s.workRam)).toBe(0xabcdef12);
  });

  it("OR è cumulativo (non sovrascrive)", () => {
    const s = emptyGameState();
    s.workRam[STATUS_FLAGS_OFF + 3] = 0x80; // bit 7 pre-set
    fun523A(s, 6); // bit 4
    expect(readStatusFlags(s.workRam)).toBe(0x00000090);
  });
});

describe("stateSub525C (FUN_525C) — buffer clear + bits OR", () => {
  it("D0=1: clear 20 byte e set bit 4 (1 chiamata 523A) -- pre-fill verifica", () => {
    const s = emptyGameState();
    const a2 = 0x401000;
    const off = a2 - 0x400000 + BUFFER_OFFSET_FROM_A2;

    s.workRam[off - 1] = 0xee; // sentinel pre
    for (let i = 0; i < 20; i++) s.workRam[off + i] = 0xaa;
    s.workRam[off + 20] = 0xff; // sentinel post

    stateSub525C(s, 1, a2);

    // D0=1 → 20 byte clearati [off..off+19]
    for (let i = 0; i < 20; i++) {
      expect(s.workRam[off + i]).toBe(0);
    }
    // sentinels intatti
    expect(s.workRam[off - 1]).toBe(0xee);
    expect(s.workRam[off + 20]).toBe(0xff);

    expect(readStatusFlags(s.workRam)).toBe(0x00000030);
  });

  it("D0=2: clear 40 byte e set bit 4..7 (4 chiamate 523A)", () => {
    const s = emptyGameState();
    const a2 = 0x401200;
    const off = a2 - 0x400000 + BUFFER_OFFSET_FROM_A2;

    for (let i = 0; i < 40; i++) s.workRam[off + i] = 0xcc;
    stateSub525C(s, 2, a2);

    for (let i = 0; i < 40; i++) {
      expect(s.workRam[off + i]).toBe(0);
    }
    // bits 4,5,6,7 = 0xF0
    expect(readStatusFlags(s.workRam)).toBe(0x000000f0);
  });

  it("D0=4: clear 80 byte, bits 4..11 (8 bits)", () => {
    const s = emptyGameState();
    const a2 = 0x401400;
    const off = a2 - 0x400000 + BUFFER_OFFSET_FROM_A2;

    for (let i = 0; i < 80; i++) s.workRam[off + i] = 0x77;
    stateSub525C(s, 4, a2);

    for (let i = 0; i < 80; i++) expect(s.workRam[off + i]).toBe(0);
    // bits 4..11 = 0xFF0
    expect(readStatusFlags(s.workRam)).toBe(0x00000ff0);
  });

  it("status flags pre-esistenti vengono OR-ed (non sovrascritti)", () => {
    const s = emptyGameState();
    // Pre-set bit 0 e bit 31
    s.workRam[STATUS_FLAGS_OFF] = 0x80;
    s.workRam[STATUS_FLAGS_OFF + 3] = 0x01;

    stateSub525C(s, 1, 0x401000);
    // bit 0 + bit 31 + bit 4, 5
    expect(readStatusFlags(s.workRam)).toBe(0x80000031);
  });

  it("buffer clear è strettamente locale ad A2+0x50, non tocca workRam altrove", () => {
    const s = emptyGameState();
    s.workRam.fill(0x5a);
    s.workRam[STATUS_FLAGS_OFF] = 0;
    s.workRam[STATUS_FLAGS_OFF + 1] = 0;
    s.workRam[STATUS_FLAGS_OFF + 2] = 0;
    s.workRam[STATUS_FLAGS_OFF + 3] = 0;

    const a2 = 0x401000;
    const off = a2 - 0x400000 + BUFFER_OFFSET_FROM_A2;

    stateSub525C(s, 1, a2);

    // 20 byte clearati
    for (let i = 0; i < 20; i++) expect(s.workRam[off + i]).toBe(0);
    expect(s.workRam[off - 1]).toBe(0x5a);
    expect(s.workRam[off + 20]).toBe(0x5a);
    // Sample distante intatto
    expect(s.workRam[0x100]).toBe(0x5a);
    // Status flags = bit 4|5
    expect(readStatusFlags(s.workRam)).toBe(0x00000030);
  });

  it("D0=14: bits 4..31 (border alto), 28 bit settati", () => {
    const s = emptyGameState();
    const a2 = 0x401000;
    stateSub525C(s, 14, a2);
    // bits 4..31 = 0xFFFFFFF0
    expect(readStatusFlags(s.workRam)).toBe(0xfffffff0);
  });

  it("D0=15: copre bits 4..33 ma 32+33 sono no-op (asl.l ≥32 → 0)", () => {
    const s = emptyGameState();
    const a2 = 0x401000;
    stateSub525C(s, 15, a2);
    // bits 4..31 set; tentativo di settare bit 32, 33 → no-op
    expect(readStatusFlags(s.workRam)).toBe(0xfffffff0);
  });

  it("A2 alternativo (offset basso) — buffer clear segue il pointer", () => {
    const s = emptyGameState();
    const a2 = 0x4007a0;
    const off = a2 - 0x400000 + BUFFER_OFFSET_FROM_A2;
    for (let i = 0; i < 60; i++) s.workRam[off + i] = 0x99;

    stateSub525C(s, 3, a2);
    for (let i = 0; i < 60; i++) expect(s.workRam[off + i]).toBe(0);
    // bits 4..9 = 0x3F0
    expect(readStatusFlags(s.workRam)).toBe(0x000003f0);
  });
});
