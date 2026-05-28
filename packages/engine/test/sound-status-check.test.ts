/**
 * sound-status-check.test.ts — corner cases di soundStatusCheck (FUN_4C3E).
 *
 */

import { describe, it, expect } from "vitest";
import { soundStatusCheck } from "../src/sound-status-check.js";
import { emptyGameState } from "../src/state.js";

describe("soundStatusCheck (FUN_4C3E)", () => {
  it("soundPending=true → ritorna 0 e non tocca nulla", () => {
    const s = emptyGameState();
    const before = new Uint8Array(s.workRam);
    const r = soundStatusCheck(s, 0x10003, 0x401f44, true);
    expect(r).toBe(0);
    expect(s.workRam).toEqual(before);
  });

  it("slot occupato (owner long != 0) → ritorna 0 e non tocca nulla", () => {
    const s = emptyGameState();
    s.workRam[0x1f44 + 0x16] = 0x00;
    s.workRam[0x1f44 + 0x17] = 0x40;
    s.workRam[0x1f44 + 0x18] = 0x12;
    s.workRam[0x1f44 + 0x19] = 0x34; // owner = 0x00401234, !=0
    s.workRam[0x1f44 + 0x14] = 0xaa; // type byte non deve cambiare
    const r = soundStatusCheck(s, 0x10003, 0x401f44, false);
    expect(r).toBe(0);
    expect(s.workRam[0x1f44 + 0x14]).toBe(0xaa); // unchanged
    expect(s.workRam[0x1f44 + 0x16]).toBe(0x00);
    expect(s.workRam[0x1f44 + 0x17]).toBe(0x40);
    expect(s.workRam[0x1f44 + 0x18]).toBe(0x12);
    expect(s.workRam[0x1f44 + 0x19]).toBe(0x34);
  });

  it("slot libero, no pending → ritorna 1, scrive type byte + owner long", () => {
    const s = emptyGameState();
    const r = soundStatusCheck(s, 0x10003, 0x401f44, false);
    expect(r).toBe(1);
    expect(s.workRam[0x1f44 + 0x14]).toBe(0x01); // (0x10003 >> 16) & 0xFF
    // owner = 0x00401F44 big-endian
    expect(s.workRam[0x1f44 + 0x16]).toBe(0x00);
    expect(s.workRam[0x1f44 + 0x17]).toBe(0x40);
    expect(s.workRam[0x1f44 + 0x18]).toBe(0x1f);
    expect(s.workRam[0x1f44 + 0x19]).toBe(0x44);
  });

  it("type byte = (D0 >> 16) & 0xFF — D0 alto fuori dagli 8 bit bassi", () => {
    const s = emptyGameState();
    const r = soundStatusCheck(s, 0xab230055, 0x401f44, false);
    expect(r).toBe(1);
    // (0xab230055 >> 16) & 0xff = 0x23
    expect(s.workRam[0x1f44 + 0x14]).toBe(0x23);
  });

  it("ptr A0 base diversa (workRam offset libero) → owner scritto in big-endian", () => {
    const s = emptyGameState();
    const ptr = 0x401e00;
    const r = soundStatusCheck(s, 0x00070000, ptr, false);
    expect(r).toBe(1);
    expect(s.workRam[(ptr - 0x400000) + 0x14]).toBe(0x07); // type byte
    expect(s.workRam[(ptr - 0x400000) + 0x16]).toBe(0x00);
    expect(s.workRam[(ptr - 0x400000) + 0x17]).toBe(0x40);
    expect(s.workRam[(ptr - 0x400000) + 0x18]).toBe(0x1e);
    expect(s.workRam[(ptr - 0x400000) + 0x19]).toBe(0x00);
  });

  it("default soundPending=false: chip ready", () => {
    const s = emptyGameState();
    const r = soundStatusCheck(s, 0x10003, 0x401f44);
    expect(r).toBe(1);
  });

  it("ordering check: pending DOMINA su slot libero → 0", () => {
    const s = emptyGameState();
    const r = soundStatusCheck(s, 0x10003, 0x401f44, true);
    expect(r).toBe(0);
    expect(s.workRam[0x1f44 + 0x14]).toBe(0);
    expect(s.workRam[0x1f44 + 0x16]).toBe(0);
  });

  it("owner long anche solo 1 byte set != 0 → fail", () => {
    const s = emptyGameState();
    s.workRam[0x1f44 + 0x19] = 0x01;
    const r = soundStatusCheck(s, 0x10003, 0x401f44, false);
    expect(r).toBe(0);
    expect(s.workRam[0x1f44 + 0x14]).toBe(0); // type byte non scritto
  });
});
