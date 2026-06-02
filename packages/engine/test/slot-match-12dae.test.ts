/**
 * slot-match-12dae.test.ts — smoke per `slotMatch12DAE` (FUN_00012DAE).
 *
 * Bit-perfect parity validata vs binary in
 * `packages/cli/src/test-slot-match-12dae-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { slotMatch12DAE } from "../src/slot-match-12dae.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;
const SLOT_TABLE_BASE = 0x400a9c;
const SLOT_STRIDE = 0x56;
const SLOT_COUNT = 25;

/** Scrive un long big-endian in work RAM to the offset (relativo a 0x400000). */
function writeU32(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

/** Set up arg in work RAM: writes the long target to *(argPtr+2). */
function setArgTarget(s: ReturnType<typeof emptyGameState>, argPtr: number, target: number): void {
  writeU32(s, (argPtr - WORK_RAM_BASE) + 2, target);
}

describe("slotMatch12DAE (FUN_00012DAE)", () => {
  it("nessuno slot occupied → D0 = 0 (no-match, default)", () => {
    const s = emptyGameState();
    const argPtr = 0x401d00;
    setArgTarget(s, argPtr, 0xdeadbeef);
    // Tutti the slot hanno byte+0x18 = 0 (default zero-init).
    expect(slotMatch12DAE(s, argPtr)).toBe(0);
  });

  it("slot 5 occupied and *(slot+0x3A) == *(arg+2) → D0 = 1 (match key)", () => {
    const s = emptyGameState();
    const argPtr = 0x401d00;
    const target = 0x12345678;
    setArgTarget(s, argPtr, target);
    const slotAddr = SLOT_TABLE_BASE + 5 * SLOT_STRIDE;
    const slotOff = slotAddr - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 1;
    writeU32(s, slotOff + 0x3a, target);

    expect(slotMatch12DAE(s, argPtr)).toBe(1);
  });

  it("target = 0 and *(slot+0x1F) == 0xC → D0 = 1 (match alt path)", () => {
    const s = emptyGameState();
    const argPtr = 0x401d00;
    setArgTarget(s, argPtr, 0); // *(arg+2) = 0 → attiva alt-path
    const slotAddr = SLOT_TABLE_BASE + 7 * SLOT_STRIDE;
    const slotOff = slotAddr - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 1;
    // slot+0x3A != 0, so it must fail the first check and go to alt.
    writeU32(s, slotOff + 0x3a, 0xcafef00d);
    s.workRam[slotOff + 0x1f] = 0x0c;

    expect(slotMatch12DAE(s, argPtr)).toBe(1);
  });

  it("target = 0 but *(slot+0x1F) != 0xC → D0 = 0 (no match)", () => {
    const s = emptyGameState();
    const argPtr = 0x401d00;
    setArgTarget(s, argPtr, 0);
    // All slots occupied but with type byte != 0xC and key != 0.
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slotOff = (SLOT_TABLE_BASE + i * SLOT_STRIDE) - WORK_RAM_BASE;
      s.workRam[slotOff + 0x18] = 1;
      writeU32(s, slotOff + 0x3a, 0xdeadbeef); // != 0
      s.workRam[slotOff + 0x1f] = 0x0a; // != 0xC
    }

    expect(slotMatch12DAE(s, argPtr)).toBe(0);
  });

  it("slot occupied but byte+0x18 != 1 (e.g. 2) → NOT counts as occupied (cmpi.b #1 stretto)", () => {
    const s = emptyGameState();
    const argPtr = 0x401d00;
    const target = 0xaabbccdd;
    setArgTarget(s, argPtr, target);
    const slotAddr = SLOT_TABLE_BASE + 3 * SLOT_STRIDE;
    const slotOff = slotAddr - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 2; // NOT 1 → cmpi.b #1 fails → skip
    writeU32(s, slotOff + 0x3a, target); // even if key match, il check of occupied skips la entry

    expect(slotMatch12DAE(s, argPtr)).toBe(0);
  });

  it("early-exit al first match: il binario non scansiona beyond", () => {
    // First slot occupied with type 0xC (target=0 activates alt-path), all
    // later slots too -> returns 1 regardless. Verify that no
    // side effect ci both (read-only).
    const s = emptyGameState();
    const argPtr = 0x401d00;
    setArgTarget(s, argPtr, 0);
    const slotOff = SLOT_TABLE_BASE - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 1;
    s.workRam[slotOff + 0x1f] = 0x0c;

    const before = new Uint8Array(s.workRam);
    expect(slotMatch12DAE(s, argPtr)).toBe(1);
    expect(s.workRam).toEqual(before); // no side effect
  });

  it("last slot (idx 24) match key → D0 = 1 (boundary)", () => {
    const s = emptyGameState();
    const argPtr = 0x401d00;
    const target = 0x0000abcd;
    setArgTarget(s, argPtr, target);
    const slotOff = (SLOT_TABLE_BASE + 24 * SLOT_STRIDE) - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 1;
    writeU32(s, slotOff + 0x3a, target);

    expect(slotMatch12DAE(s, argPtr)).toBe(1);
  });
});
