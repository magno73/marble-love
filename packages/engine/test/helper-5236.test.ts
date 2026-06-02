/**
 * helper-5236.test.ts — smoke test per helper5236 (FUN_5236).
 *
 * `packages/cli/src/test-helper-5236-parity.ts`.
 * Qui copriamo i path principali: arg < 2, arg >= 2, shift=0 → mask=1,
 * from the long target.
 */

import { describe, it, expect } from "vitest";
import {
  helper5236,
  STATUS_FLAGS_OFF,
  HELPER_5236_ADDR,
} from "../src/helper-5236.js";
import { emptyGameState } from "../src/state.js";

function readLongBE(workRam: Uint8Array, off: number): number {
  return (
    (((workRam[off] ?? 0) << 24) |
      ((workRam[off + 1] ?? 0) << 16) |
      ((workRam[off + 2] ?? 0) << 8) |
      (workRam[off + 3] ?? 0)) >>>
    0
  );
}

function writeLongBE(workRam: Uint8Array, off: number, val: number): void {
  const v = val >>> 0;
  workRam[off] = (v >>> 24) & 0xff;
  workRam[off + 1] = (v >>> 16) & 0xff;
  workRam[off + 2] = (v >>> 8) & 0xff;
  workRam[off + 3] = v & 0xff;
}

describe("helper5236 (FUN_5236) — smoke", () => {
  it("costanti esportate corrette", () => {
    expect(HELPER_5236_ADDR).toBe(0x00005236);
    expect(STATUS_FLAGS_OFF).toBe(0x1f5e);
  });

  it("arg=0: shift=0 → mask=1 → OR bit 0", () => {
    const s = emptyGameState();
    helper5236(s, 0);
    // shift = 0 (arg < 2, no subq). mask = 1 << 0 = 1.
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x00000001);
  });

  it("arg=1: shift=1 → mask=2 → OR bit 1", () => {
    const s = emptyGameState();
    helper5236(s, 1);
    // shift = 1 (arg < 2, no subq). mask = 1 << 1 = 2.
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x00000002);
  });

  it("arg=2: D0 >= 2 → subq → D0=0 → shift=0 → mask=1 → OR bit 0", () => {
    const s = emptyGameState();
    helper5236(s, 2);
    // shift = 2 - 2 = 0. mask = 1 << 0 = 1.
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x00000001);
  });

  it("arg=3: D0 >= 2 → subq → D0=1 → shift=1 → mask=2 → OR bit 1", () => {
    const s = emptyGameState();
    helper5236(s, 3);
    // shift = 3 - 2 = 1. mask = 1 << 1 = 2.
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x00000002);
  });

  it("arg=33: D0 >= 2 → subq → D0=31 → shift=31 → mask=0x80000000", () => {
    const s = emptyGameState();
    helper5236(s, 33);
    // shift = 33 - 2 = 31. mask = 1 << 31 = 0x80000000.
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x80000000);
  });

  it("arg=34: D0 >= 2 → subq → D0=32 → shift=32 >= 32 → mask=0 → no-op", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, STATUS_FLAGS_OFF, 0xdeadbeef);
    helper5236(s, 34);
    // shift = 34 - 2 = 32 >= 32 → D1 = 0 → no-op
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0xdeadbeef);
  });

  it("arg=0xFFFFFFFF: D0 >= 2 → subq → D0=0xFFFFFFFD → shift=0x3D=61 >= 32 → no-op", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, STATUS_FLAGS_OFF, 0x12345678);
    helper5236(s, 0xffffffff);
    // shift = (0xFFFFFFFF - 2) & 0x3F = 0xFFFFFFFD & 0x3F = 0x3D = 61 >= 32 → no-op
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x12345678);
  });

  it("OR cumulativo: chiamate successive OR-ano senza sovrascrivere bit preesistenti", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, STATUS_FLAGS_OFF, 0x00000001); // bit 0 pre-set
    helper5236(s, 3); // arg=3 → shift=1 → mask=2 → OR bit 1
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x00000003); // bits 0+1
    helper5236(s, 4); // arg=4 → shift=2 → mask=4 → OR bit 2
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x00000007); // bits 0+1+2
  });

  it("idempotenza: call twice con same arg dà same risultato of the first", () => {
    const s = emptyGameState();
    helper5236(s, 5);
    const val1 = readLongBE(s.workRam, STATUS_FLAGS_OFF);
    helper5236(s, 5);
    const val2 = readLongBE(s.workRam, STATUS_FLAGS_OFF);
    expect(val2).toBe(val1);
  });

  it("non tocca byte outside from the long @ STATUS_FLAGS_OFF (no side-effect collaterali)", () => {
    const s = emptyGameState();
    s.workRam.fill(0xa5);
    // Zero out only the 4 target bytes.
    for (let i = 0; i < 4; i++) s.workRam[STATUS_FLAGS_OFF + i] = 0;

    helper5236(s, 0); // mask=1

    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x00000001);
    // Byte adiacenti intact
    expect(s.workRam[STATUS_FLAGS_OFF - 1]).toBe(0xa5);
    expect(s.workRam[STATUS_FLAGS_OFF + 4]).toBe(0xa5);
    expect(s.workRam[0x0100]).toBe(0xa5);
  });

  it("arg=2 (boundary esatto): shift=0 → mask=1 (non 2 and non no-op)", () => {
    const s = emptyGameState();
    helper5236(s, 2);
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x00000001);
  });

  it("arg=1 (boundary inferiore): shift=1 → mask=2 (bcs skips, no subq)", () => {
    const s = emptyGameState();
    helper5236(s, 1);
    expect(readLongBE(s.workRam, STATUS_FLAGS_OFF)).toBe(0x00000002);
  });
});
