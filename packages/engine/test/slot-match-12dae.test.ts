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

/** Scrive un long big-endian in work RAM all'offset (relativo a 0x400000). */
function writeU32(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

/** Setup arg in work RAM: scrive il long target a *(argPtr+2). */
function setArgTarget(s: ReturnType<typeof emptyGameState>, argPtr: number, target: number): void {
  writeU32(s, (argPtr - WORK_RAM_BASE) + 2, target);
}

describe("slotMatch12DAE (FUN_00012DAE)", () => {
  it("nessuno slot occupato → D0 = 0 (no-match, default)", () => {
    const s = emptyGameState();
    const argPtr = 0x401d00;
    setArgTarget(s, argPtr, 0xdeadbeef);
    // Tutti gli slot hanno byte+0x18 = 0 (default zero-init).
    expect(slotMatch12DAE(s, argPtr)).toBe(0);
  });

  it("slot 5 occupato e *(slot+0x3A) == *(arg+2) → D0 = 1 (match key)", () => {
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

  it("target = 0 e *(slot+0x1F) == 0xC → D0 = 1 (match alt path)", () => {
    const s = emptyGameState();
    const argPtr = 0x401d00;
    setArgTarget(s, argPtr, 0); // *(arg+2) = 0 → attiva alt-path
    const slotAddr = SLOT_TABLE_BASE + 7 * SLOT_STRIDE;
    const slotOff = slotAddr - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 1;
    // slot+0x3A != 0 (deve fallire la prima check, va alla alt)
    writeU32(s, slotOff + 0x3a, 0xcafef00d);
    s.workRam[slotOff + 0x1f] = 0x0c;

    expect(slotMatch12DAE(s, argPtr)).toBe(1);
  });

  it("target = 0 ma *(slot+0x1F) != 0xC → D0 = 0 (no match)", () => {
    const s = emptyGameState();
    const argPtr = 0x401d00;
    setArgTarget(s, argPtr, 0);
    // Tutti gli slot occupati ma con type byte != 0xC e key != 0.
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slotOff = (SLOT_TABLE_BASE + i * SLOT_STRIDE) - WORK_RAM_BASE;
      s.workRam[slotOff + 0x18] = 1;
      writeU32(s, slotOff + 0x3a, 0xdeadbeef); // != 0
      s.workRam[slotOff + 0x1f] = 0x0a; // != 0xC
    }

    expect(slotMatch12DAE(s, argPtr)).toBe(0);
  });

  it("slot occupato ma byte+0x18 != 1 (es. 2) → NON conta come occupato (cmpi.b #1 stretto)", () => {
    const s = emptyGameState();
    const argPtr = 0x401d00;
    const target = 0xaabbccdd;
    setArgTarget(s, argPtr, target);
    const slotAddr = SLOT_TABLE_BASE + 3 * SLOT_STRIDE;
    const slotOff = slotAddr - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 2; // NOT 1 → cmpi.b #1 fallisce → skip
    writeU32(s, slotOff + 0x3a, target); // anche se key match, il check di occupied salta la entry

    expect(slotMatch12DAE(s, argPtr)).toBe(0);
  });

  it("early-exit al primo match: il binario non scansiona oltre", () => {
    // Primo slot occupato con type 0xC (target=0 attiva alt-path), tutti i
    // successivi pure → ritorna 1 indipendentemente. Verifichiamo che nessun
    // side effect ci sia (read-only).
    const s = emptyGameState();
    const argPtr = 0x401d00;
    setArgTarget(s, argPtr, 0);
    const slotOff = SLOT_TABLE_BASE - WORK_RAM_BASE;
    s.workRam[slotOff + 0x18] = 1;
    s.workRam[slotOff + 0x1f] = 0x0c;

    const before = new Uint8Array(s.workRam);
    expect(slotMatch12DAE(s, argPtr)).toBe(1);
    expect(s.workRam).toEqual(before); // nessun side effect
  });

  it("ultimo slot (idx 24) match key → D0 = 1 (boundary)", () => {
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
