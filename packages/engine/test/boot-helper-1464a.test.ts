/**
 * Test bootHelper1464A (FUN_1464A) — smoke tests for side effects on workRam.
 *
 * `cli/src/test-boot-helper-1464a-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  bootHelper1464A,
  bootHelper1464ADefault,
  BOOT_HELPER_1464A_ADDR,
  type BootHelper1464ASubs,
} from "../src/boot-helper-1464a.js";
import { emptyGameState } from "../src/state.js";

const WRAM = 0x00400000;
function off(addr: number): number { return addr - WRAM; }
function rb(s: ReturnType<typeof emptyGameState>, addr: number): number {
  return s.workRam[off(addr)] ?? 0;
}
function rw(s: ReturnType<typeof emptyGameState>, addr: number): number {
  return (((s.workRam[off(addr)] ?? 0) << 8) | (s.workRam[off(addr) + 1] ?? 0)) & 0xffff;
}
function rl(s: ReturnType<typeof emptyGameState>, addr: number): number {
  return (
    (((s.workRam[off(addr)] ?? 0) << 24) |
    ((s.workRam[off(addr) + 1] ?? 0) << 16) |
    ((s.workRam[off(addr) + 2] ?? 0) << 8) |
    (s.workRam[off(addr) + 3] ?? 0)) >>> 0
  );
}

describe("bootHelper1464A (FUN_1464A)", () => {
  it("BOOT_HELPER_1464A_ADDR is correct", () => {
    expect(BOOT_HELPER_1464A_ADDR).toBe(0x0001464a);
  });

  it("clears workRam 0x400000 and 0x400002", () => {
    const s = emptyGameState();
    s.workRam[0] = 0xAB;
    s.workRam[1] = 0xCD;
    s.workRam[2] = 0xEF;
    s.workRam[3] = 0x12;
    bootHelper1464A(s, {});
    expect(rw(s, 0x400000)).toBe(0);
    expect(rw(s, 0x400002)).toBe(0);
  });

  it("initializes 2 player object slots @ 0x400018 and 0x4000FA", () => {
    const s = emptyGameState();
    bootHelper1464A(s, {});

    // Slot 0: base = 0x400018
    expect(rb(s, 0x400018 + 0x18)).toBe(0);
    expect(rb(s, 0x400018 + 0x6e)).toBe(0xff);
    expect(rb(s, 0x400018 + 0x71)).toBe(0xff);
    expect(rb(s, 0x400018 + 0x70)).toBe(0xff);
    expect(rb(s, 0x400018 + 0xc0)).toBe(0x41);
    expect(rb(s, 0x400018 + 0xc1)).toBe(0x41);
    expect(rb(s, 0x400018 + 0xc2)).toBe(0x41);

    // Slot 1: base = 0x400018 + 0xE2 = 0x4000FA
    expect(rb(s, 0x4000fa + 0x18)).toBe(0);
    expect(rb(s, 0x4000fa + 0x6e)).toBe(0xff);
    expect(rb(s, 0x4000fa + 0x71)).toBe(0xff);
    expect(rb(s, 0x4000fa + 0x70)).toBe(0xff);
    expect(rb(s, 0x4000fa + 0xc0)).toBe(0x41);
    expect(rb(s, 0x4000fa + 0xc1)).toBe(0x41);
    expect(rb(s, 0x4000fa + 0xc2)).toBe(0x41);
  });

  it("clears 0x4009A4+0x18 (slot 0) and 0x4009A4+0x7C+0x18 (slot 1)", () => {
    const s = emptyGameState();
    s.workRam[0x4009a4 + 0x18 - WRAM] = 0xAA;
    s.workRam[0x4009a4 + 0x7c + 0x18 - WRAM] = 0xBB;
    bootHelper1464A(s, {});
    expect(rb(s, 0x4009a4 + 0x18)).toBe(0);
    expect(rb(s, 0x4009a4 + 0x7c + 0x18)).toBe(0);
  });

  it("writes the standard workRam globals", () => {
    const s = emptyGameState();
    bootHelper1464A(s, {});

    expect(rb(s, 0x00400008)).toBe(0);
    expect(rb(s, 0x00400006)).toBe(0);
    expect(rb(s, 0x0040000a)).toBe(0);
    expect(rw(s, 0x00400396)).toBe(1);
    expect(rb(s, 0x0040039c)).toBe(0);
    expect(rb(s, 0x004003a8)).toBe(0xff);
    expect(rb(s, 0x004003aa)).toBe(0xff);
    expect(rb(s, 0x004003ac)).toBe(0); // cleared later too
    expect(rw(s, 0x0040045c)).toBe(0);
    expect(rb(s, 0x004003e2)).toBe(0);
    expect(rb(s, 0x0040045e)).toBe(0);
    expect(rb(s, 0x00400460)).toBe(0xff);
    expect(rb(s, 0x004003b4)).toBe(0);
    expect(rb(s, 0x004003b2)).toBe(0);
    expect(rb(s, 0x004003ee)).toBe(0);
    expect(rw(s, 0x004003ea)).toBe(0);
    expect(rb(s, 0x004003e6)).toBe(0);
    expect(rl(s, 0x00400408)).toBe(0x0040040c);
  });

  it("increments 0x4003F0 three times (0x14768, 0x1488E, 0x14920)", () => {
    const s = emptyGameState();
    s.workRam[off(0x004003f0)] = 5;
    bootHelper1464A(s, {});
    // 3 addq.b calls in FUN_1464A body + 0 from vblankAck (no-op when not provided)
    expect(rb(s, 0x004003f0)).toBe(8);
  });

  it("calls slotArrayBulkInit10392 (or the default)", () => {
    const s = emptyGameState();
    let called = false;
    bootHelper1464A(s, {
      slotArrayBulkInit10392: () => { called = true; },
    });
    expect(called).toBe(true);
  });

  it("in service mode (0x40000E<0) skips gameStateBanner and clearPaletteRam pre-common", () => {
    const s = emptyGameState();
    let bannerCalls = 0;
    let palCalls = 0;
    s.workRam[off(0x0040000e)] = 0x80; // bit 7 set → service mode
    bootHelper1464A(s, {
      gameStateBanner26B2A: () => { bannerCalls++; },
      clearPaletteRam121A6: () => { palCalls++; },
    });
    // In service mode, the normal pre-common block is skipped entirely,
    // so banner and clearPalette calls from that block are 0.
    // (They may still be called from the common block path.)
    expect(bannerCalls).toBe(0);
    expect(palCalls).toBe(0);
  });

  it("readSwitches1A8 result < 0xE0: 0x4003DE = result & 3", () => {
    const s = emptyGameState();
    let slot0bVal = 0x05; // < 0xE0
    bootHelper1464A(s, {
      readSwitches1A8: (_state, slot) => {
        if (slot === 0xb) return slot0bVal;
        return 0;
      },
    });
    expect(rw(s, 0x004003de)).toBe(slot0bVal & 3);
  });

  it("readSwitches1A8 result >= 0xE0: 0x4003DE = 0xFFFF, 0x4003EA = 0xFFFF", () => {
    const s = emptyGameState();
    bootHelper1464A(s, {
      readSwitches1A8: (_state, slot) => {
        if (slot === 0xb) return 0xe5; // >= 0xE0
        return 0;
      },
    });
    expect(rw(s, 0x004003de)).toBe(0xffff);
    expect(rw(s, 0x004003ea)).toBe(0xffff);
  });

  it("calls soundCmd158AC(state, 0x61) at the end", () => {
    const s = emptyGameState();
    const calls: number[] = [];
    bootHelper1464A(s, {
      soundCmd158AC: (_state, cmd) => { calls.push(cmd); },
    });
    expect(calls).toContain(0x61);
    // Last sound command should be 0x61
    expect(calls[calls.length - 1]).toBe(0x61);
  });

  it("sets 0x40039E=0x1E, 0x4003A0=0, 0x4003A2=0 on the normal path", () => {
    const s = emptyGameState();
    // Disable vblankAck loop by setting 0x4003AC & 3 != 0
    s.workRam[off(0x004003ac)] = 0x01;
    bootHelper1464A(s, {});
    expect(rw(s, 0x0040039e)).toBe(0x1e);
    expect(rb(s, 0x004003a0)).toBe(0);
    expect(rb(s, 0x004003a2)).toBe(0);
  });

  it("bootHelper1464ADefault works without crashing", () => {
    const s = emptyGameState();
    expect(() => bootHelper1464ADefault(s)).not.toThrow();
    // Should still set the standard globals
    expect(rw(s, 0x00400396)).toBe(1);
  });

  it("path gameDispatch1AE=0 calls dispatchTable11AD8(state,0)", () => {
    const s = emptyGameState();
    const dispCalls: number[] = [];
    bootHelper1464A(s, {
      gameDispatch1AE: () => 0,
      dispatchTable11AD8: (_state, slot) => { dispCalls.push(slot); },
    });
    expect(dispCalls).toContain(0);
  });
});
