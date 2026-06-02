/**
 * counter-pool-subtract-4008.test.ts — smoke tests of `counterPoolSubtract4008`
 * (FUN_4008).
 *
 * Verifies the 4 main paths:
 *   1. Helper status >= 0xE0 -> early exit, ret 1, NO changes
 *   2. Pool insufficient (counter+acc < arg1) -> ret 0, NO changes
 *   3. Drain from the counter (counter >= arg1) -> ret 1, counter scaled
 *   4. Drain counter + remainder on the acc -> ret 1, counter=0, acc scaled
 *
 * Bit-perfect parity (500 random cases) verified in
 * `packages/cli/src/test-counter-pool-subtract-4008-parity.ts` vs Musashi.
 */

import { describe, it, expect } from "vitest";
import {
  counterPoolSubtract4008,
  RET_SUCCESS,
  RET_INSUFFICIENT,
} from "../src/counter-pool-subtract-4008.js";
import { emptyGameState } from "../src/state.js";

const PTR_OFF = 0x1ffc;
const ACC_OFF = 0x1ff5;
const CTR_OFF = 0x1ff7;

function writeLongBE(ram: Uint8Array, off: number, val: number): void {
  ram[off] = (val >>> 24) & 0xff;
  ram[off + 1] = (val >>> 16) & 0xff;
  ram[off + 2] = (val >>> 8) & 0xff;
  ram[off + 3] = val & 0xff;
}

/**
 * Helper: set up player struct with valid status byte (status & ~status complement).
 *   - ptr+0xA = status
 *   - ptr+0xB = ~status
 * Thus helper FUN_3F3E returns (status & 3) + 1 (range 1..4) for status < 0xE0,
 * or 0 for status >= 0xE0.
 */
function setupPlayer(
  state: ReturnType<typeof emptyGameState>,
  ptrAbs: number,
  status: number,
): void {
  writeLongBE(state.workRam, PTR_OFF, ptrAbs);
  const off = ptrAbs - 0x400000;
  state.workRam[off + 0xa] = status & 0xff;
  state.workRam[off + 0xb] = ~status & 0xff;
}

describe("counterPoolSubtract4008 (FUN_4008)", () => {
  it("path #1: helper status >= 0xE0 -> ret 1, no changes", () => {
    const s = emptyGameState();
    // status = 0xE0 -> helper returns 0 -> early exit with ret 1.
    setupPlayer(s, 0x401a00, 0xe0);
    s.workRam[CTR_OFF] = 0x10;
    s.workRam[ACC_OFF] = 0x05;
    const before = new Uint8Array(s.workRam);
    expect(counterPoolSubtract4008(s, 0x100)).toBe(RET_SUCCESS);
    // Verify no side effects.
    expect(s.workRam).toEqual(before);

    // Even with status = 0xFF -> helper = 0.
    setupPlayer(s, 0x401a00, 0xff);
    expect(counterPoolSubtract4008(s, 0x42)).toBe(RET_SUCCESS);
  });

  it("path #2: pool < arg1 -> ret 0, no changes", () => {
    const s = emptyGameState();
    // status = 0x10 -> helper = (0x10 & 3) + 1 = 1 (proceed).
    setupPlayer(s, 0x401a00, 0x10);
    s.workRam[CTR_OFF] = 0x05;
    s.workRam[ACC_OFF] = 0x03;
    // pool = 8. arg1 = 9 -> insufficient.
    const before = new Uint8Array(s.workRam);
    expect(counterPoolSubtract4008(s, 9)).toBe(RET_INSUFFICIENT);
    expect(s.workRam).toEqual(before);

    // Edge: arg1 == pool+1.
    expect(counterPoolSubtract4008(s, 9)).toBe(RET_INSUFFICIENT);

    // Edge: arg1 = 0xFFFFFFFF (sign-ext negative-as-unsigned) -> insufficient.
    expect(counterPoolSubtract4008(s, 0xffffffff)).toBe(RET_INSUFFICIENT);
    expect(s.workRam).toEqual(before);
  });

  it("path #3: drain from the counter (arg1 <= counter) -> counter scaled, acc unchanged", () => {
    const s = emptyGameState();
    setupPlayer(s, 0x401a00, 0x10);
    s.workRam[CTR_OFF] = 0x10;
    s.workRam[ACC_OFF] = 0x05;
    // arg1 = 7. pool = 21 >= 7. counter (16) >= 7 -> drain counter only.
    expect(counterPoolSubtract4008(s, 7)).toBe(RET_SUCCESS);
    expect(s.workRam[CTR_OFF]).toBe(0x10 - 7);
    expect(s.workRam[ACC_OFF]).toBe(0x05); // unchanged

    // arg1 = 0 -> ret 1, nothing changed (D2 <= 0 immediate ble, sub.b 0).
    s.workRam[CTR_OFF] = 0x42;
    s.workRam[ACC_OFF] = 0x07;
    expect(counterPoolSubtract4008(s, 0)).toBe(RET_SUCCESS);
    expect(s.workRam[CTR_OFF]).toBe(0x42);
    expect(s.workRam[ACC_OFF]).toBe(0x07);
  });

  it("path #4: drain counter + remainder on acc (arg1 > counter)", () => {
    const s = emptyGameState();
    setupPlayer(s, 0x401a00, 0x10);
    s.workRam[CTR_OFF] = 0x05;
    s.workRam[ACC_OFF] = 0x10;
    // arg1 = 8. pool = 21 >= 8. counter (5) -> drains all. remainder = 3 -> acc -= 3.
    expect(counterPoolSubtract4008(s, 8)).toBe(RET_SUCCESS);
    expect(s.workRam[CTR_OFF]).toBe(0);
    expect(s.workRam[ACC_OFF]).toBe(0x10 - 3);

    // Edge: arg1 == counter -> exact drain, acc unchanged.
    s.workRam[CTR_OFF] = 0x09;
    s.workRam[ACC_OFF] = 0x20;
    expect(counterPoolSubtract4008(s, 9)).toBe(RET_SUCCESS);
    expect(s.workRam[CTR_OFF]).toBe(0);
    expect(s.workRam[ACC_OFF]).toBe(0x20); // unchanged

    // Edge: arg1 == counter + acc (empties all).
    s.workRam[CTR_OFF] = 0x04;
    s.workRam[ACC_OFF] = 0x07;
    expect(counterPoolSubtract4008(s, 11)).toBe(RET_SUCCESS);
    expect(s.workRam[CTR_OFF]).toBe(0);
    expect(s.workRam[ACC_OFF]).toBe(0);
  });

  it("status complement check: if ptr+0xA != ~ptr+0xB -> status forced to 0 -> helper = 1", () => {
    const s = emptyGameState();
    const ptr = 0x401a00;
    writeLongBE(s.workRam, PTR_OFF, ptr);
    // status = 0x55, but complement byte = 0x42 (NOT ~0x55 = 0xAA). Mismatch.
    // -> helper internally does clr.b D2 -> status = 0 -> < 0xE0 -> (0 & 3)+1 = 1.
    s.workRam[ptr - 0x400000 + 0xa] = 0x55;
    s.workRam[ptr - 0x400000 + 0xb] = 0x42;
    s.workRam[CTR_OFF] = 0x05;
    s.workRam[ACC_OFF] = 0x03;
    // Helper = 1 -> proceed. Pool=8 >= arg1=8 -> success.
    expect(counterPoolSubtract4008(s, 8)).toBe(RET_SUCCESS);
    expect(s.workRam[CTR_OFF]).toBe(0);
    expect(s.workRam[ACC_OFF]).toBe(0);
  });

  it("status >= 0xE0 with valid complement: helper = 0 (no-op even if pool insufficient)", () => {
    const s = emptyGameState();
    // status = 0xE0 (status & ~status check holds).
    setupPlayer(s, 0x401a00, 0xe0);
    // pool = 0, arg1 = 100 -> normally this would be insufficient.
    // But helper = 0 -> early exit with ret 1, no pool check.
    s.workRam[CTR_OFF] = 0;
    s.workRam[ACC_OFF] = 0;
    expect(counterPoolSubtract4008(s, 100)).toBe(RET_SUCCESS);
    expect(s.workRam[CTR_OFF]).toBe(0); // unchanged
    expect(s.workRam[ACC_OFF]).toBe(0); // unchanged
  });

  it("byte boundary: pool counter=0xFF, acc=0xFF, arg1=0x1FE -> empties all", () => {
    const s = emptyGameState();
    setupPlayer(s, 0x401a00, 0x10);
    s.workRam[CTR_OFF] = 0xff;
    s.workRam[ACC_OFF] = 0xff;
    // pool = 0x1FE = 510. arg1 = 510 -> exactly.
    expect(counterPoolSubtract4008(s, 0x1fe)).toBe(RET_SUCCESS);
    expect(s.workRam[CTR_OFF]).toBe(0);
    expect(s.workRam[ACC_OFF]).toBe(0);

    // arg1 = 0x1FF (511) > pool -> insufficient.
    s.workRam[CTR_OFF] = 0xff;
    s.workRam[ACC_OFF] = 0xff;
    const before = new Uint8Array(s.workRam);
    expect(counterPoolSubtract4008(s, 0x1ff)).toBe(RET_INSUFFICIENT);
    expect(s.workRam).toEqual(before);
  });

  it("ptr bound dynamically to *0x401FFC (changing ptr changes the status target)", () => {
    const s = emptyGameState();
    // Setup A: ptr = 0x401200 with status = 0xE5 -> helper = 0 -> early exit.
    setupPlayer(s, 0x401200, 0xe5);
    s.workRam[CTR_OFF] = 0;
    s.workRam[ACC_OFF] = 0;
    expect(counterPoolSubtract4008(s, 50)).toBe(RET_SUCCESS); // early exit

    // Setup B: ptr = 0x401800 with status = 0x05 -> helper = (0x05 & 3)+1 = 2.
    setupPlayer(s, 0x401800, 0x05);
    s.workRam[CTR_OFF] = 10;
    s.workRam[ACC_OFF] = 5;
    expect(counterPoolSubtract4008(s, 12)).toBe(RET_SUCCESS);
    expect(s.workRam[CTR_OFF]).toBe(0);
    expect(s.workRam[ACC_OFF]).toBe(3); // 5 - (12-10) = 3
  });
});
