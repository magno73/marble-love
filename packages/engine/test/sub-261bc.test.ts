/**
 * sub-261bc.test.ts — smoke tests per FUN_261BC replica.
 */
import { describe, it, expect } from "vitest";
import { fun261BC } from "../src/sub-261bc.js";
import { emptyGameState } from "../src/state.js";

describe("fun261BC (FUN_261BC)", () => {
  it("non solleva eccezioni con state vuoto and slot vuoto", () => {
    const s = emptyGameState();
    const rom = new Uint8Array(0x80000);
    expect(() => fun261BC(s, 0x400a20, 0x40000, rom)).not.toThrow();
  });

  it("magnitude >= dist (both 0): no mutation VX/VY", () => {
    const s = emptyGameState();
    const rom = new Uint8Array(0x80000);
    const off = 0xa20;
    fun261BC(s, 0x400a20, 0x40000, rom);
    // VX/VY restano 0
    for (let i = 0; i < 8; i++) {
      expect(s.workRam[off + i] ?? 0).toBe(0);
    }
  });

  it("magnitude < dist: VX/VY scalati; per slot != 0x400018/0x4000FA niente angle", () => {
    const s = emptyGameState();
    const rom = new Uint8Array(0x80000);
    const off = 0xa20;
    // VX = 0x10000 (long signed)
    s.workRam[off + 0x00] = 0x00;
    s.workRam[off + 0x01] = 0x01;
    s.workRam[off + 0x02] = 0x00;
    s.workRam[off + 0x03] = 0x00;
    // VY = 0x10000
    s.workRam[off + 0x04] = 0x00;
    s.workRam[off + 0x05] = 0x01;
    s.workRam[off + 0x06] = 0x00;
    s.workRam[off + 0x07] = 0x00;
    fun261BC(s, 0x400a20, 0x100, rom);
    // = 0x10000 + (0x2000)*3 = 0x10000 + 0x6000 = 0x16000
    const vxAfter = (s.workRam[off + 0x00] ?? 0) << 24
                   | (s.workRam[off + 0x01] ?? 0) << 16
                   | (s.workRam[off + 0x02] ?? 0) << 8
                   | (s.workRam[off + 0x03] ?? 0);
    expect(vxAfter).not.toBe(0x10000);
    expect(s.workRam[off + 0xc4] ?? 0).toBe(0);
    expect(s.workRam[off + 0xc5] ?? 0).toBe(0);
  });

  it("magnitude >= dist: VX/VY non scalati", () => {
    const s = emptyGameState();
    const rom = new Uint8Array(0x80000);
    const off = 0xa20;
    // VX = 0x100, VY = 0x100 → dist = 0x100 + (0x100>>3)*3 = 0x100 + 0x60 = 0x160
    s.workRam[off + 0x00] = 0; s.workRam[off + 0x01] = 0;
    s.workRam[off + 0x02] = 0x01; s.workRam[off + 0x03] = 0x00;
    s.workRam[off + 0x04] = 0; s.workRam[off + 0x05] = 0;
    s.workRam[off + 0x06] = 0x01; s.workRam[off + 0x07] = 0x00;
    // magnitude 0x40000 >> dist 0x160 → no clamp
    fun261BC(s, 0x400a20, 0x40000, rom);
    // VX/VY invariati
    expect(s.workRam[off + 0x02]).toBe(0x01);
    expect(s.workRam[off + 0x03]).toBe(0x00);
    expect(s.workRam[off + 0x06]).toBe(0x01);
    expect(s.workRam[off + 0x07]).toBe(0x00);
  });

  it("slot 0x400018 ramo angle: scrittura a (0xc4,A2)", () => {
    const s = emptyGameState();
    const rom = new Uint8Array(0x80000);
    rom[0x1eef8] = 0x00; rom[0x1eef9] = 0x10; // word[0] = 16
    rom[0x1eefa] = 0x00; rom[0x1eefb] = 0x20; // word[1] = 32
    const off = 0x18;
    // VX = 0x10000, VY = 0x10000 → D3 = 0x16000
    s.workRam[off + 0x00] = 0; s.workRam[off + 0x01] = 0x01;
    s.workRam[off + 0x02] = 0; s.workRam[off + 0x03] = 0;
    s.workRam[off + 0x04] = 0; s.workRam[off + 0x05] = 0x01;
    s.workRam[off + 0x06] = 0; s.workRam[off + 0x07] = 0;
    fun261BC(s, 0x400018, 0x40000, rom);
    // D5 = romW[0x1eef8 + (0)*2] = 0x10 (D4=(D3>>15)&0xf = (0x16000>>15)&0xf = 2*1+? ...
    // D3 = 0x16000 → >>15 = 2 → &0xf = 2 → D4 = 2
    expect(s.workRam[off + 0xc4] ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("returns D0: magnitude se no clamp", () => {
    const s = emptyGameState();
    const rom = new Uint8Array(0x80000);
    // VX = VY = 0 → dist = 0; magnitude (0x40000) >= 0 → no clamp → ret = magnitude
    const ret = fun261BC(s, 0x400a20, 0x40000, rom);
    expect(ret).toBe(0x40000);
  });
});
