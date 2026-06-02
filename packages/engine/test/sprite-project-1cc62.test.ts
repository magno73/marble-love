/**
 * sprite-project-1cc62.test.ts — smoke + corner case of FUN_0001CC62.
 */

import { describe, it, expect } from "vitest";
import { spriteProject1CC62 } from "../src/sprite-project-1cc62.js";
import { emptyGameState } from "../src/state.js";

const STRUCT_OFF = 0x1c28; // 0x401C28 - 0x400000
const FRAC_X_OFF = 0x69e;
const FRAC_Y_OFF = 0x6a0;
const BGE_FLAG_OFF = 0x6a2;
const OUT_DX_OFF = 0x6a4;
const OUT_DY_OFF = 0x6a6;

function readWord(s: ReturnType<typeof emptyGameState>, off: number): number {
  return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
}

function writeWord(
  s: ReturnType<typeof emptyGameState>,
  off: number,
  v: number,
): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

describe("spriteProject1CC62 (FUN_0001CC62)", () => {
  it("if-branch (bge-flag != 0): writes *0x6A4 = cx1-cx0, *0x6A6 = cx0-cz", () => {
    const s = emptyGameState();
    // Setup struct: cx0=10, cx1=30, cy0=50, cz=5.
    writeWord(s, STRUCT_OFF + 0x04, 10);
    writeWord(s, STRUCT_OFF + 0x0e, 30);
    writeWord(s, STRUCT_OFF + 0x10, 50);
    writeWord(s, STRUCT_OFF + 0x1a, 5);
    // active bge-flag + frac (for return).
    writeWord(s, BGE_FLAG_OFF, 1);
    writeWord(s, FRAC_X_OFF, 2);
    writeWord(s, FRAC_Y_OFF, 3);

    const r = spriteProject1CC62(s, 0); // argLong = 0 → no redraw call
    expect(readWord(s, OUT_DX_OFF)).toBe(30 - 10); // 20
    expect(readWord(s, OUT_DY_OFF)).toBe(10 - 5); // 5
    // return = (sext(5) << 16) + ((5*3 + 20*2) << 13)
    //       = (5 << 16) + ((15 + 40) << 13)
    //       = 0x50000 + (55 << 13)
    //       = 0x50000 + 0x6E000 = 0xBE000
    expect(r).toBe(0x50000 + (55 << 13));
  });

  it("else-branch (bge-flag == 0): writes *0x6A4 = cy0-cz, *0x6A6 = cx1-cy0", () => {
    const s = emptyGameState();
    writeWord(s, STRUCT_OFF + 0x04, 10);
    writeWord(s, STRUCT_OFF + 0x0e, 30);
    writeWord(s, STRUCT_OFF + 0x10, 50);
    writeWord(s, STRUCT_OFF + 0x1a, 5);
    writeWord(s, BGE_FLAG_OFF, 0); // forza else
    writeWord(s, FRAC_X_OFF, 4);
    writeWord(s, FRAC_Y_OFF, 7);

    const r = spriteProject1CC62(s, 0);
    expect(readWord(s, OUT_DX_OFF)).toBe(50 - 5); // 45
    expect(readWord(s, OUT_DY_OFF)).toBe((30 - 50) & 0xffff); // -20 → 0xFFEC
    // return = (sext(5) << 16) + ((sext16(0xFFEC)*7 + 45*4) << 13)
    //       = (5 << 16) + ((-20*7 + 45*4) << 13)
    //       = 0x50000 + ((-140 + 180) << 13)
    //       = 0x50000 + (40 << 13) = 0x50000 + 0x50000 = 0xA0000
    expect(r).toBe(0x50000 + (40 << 13));
  });

  it("invoca subs.fun_1CABA only if argLong LSB != 0", () => {
    const s = emptyGameState();
    writeWord(s, BGE_FLAG_OFF, 1);
    let calls = 0;
    // argLong = 0 → no redraw
    spriteProject1CC62(s, 0, { fun_1CABA: () => { calls++; } });
    expect(calls).toBe(0);
    // argLong = 1 → redraw
    spriteProject1CC62(s, 1, { fun_1CABA: () => { calls++; } });
    expect(calls).toBe(1);
    // argLong = 0x100 → LSB = 0 → no redraw
    spriteProject1CC62(s, 0x100, { fun_1CABA: () => { calls++; } });
    expect(calls).toBe(1);
    // argLong = 0xFFFF → LSB = 0xFF → redraw
    spriteProject1CC62(s, 0xffff, { fun_1CABA: () => { calls++; } });
    expect(calls).toBe(2);
  });

  it("subs assente non crasha also con argLong != 0 (no-op silenzioso)", () => {
    const s = emptyGameState();
    writeWord(s, BGE_FLAG_OFF, 1);
    expect(() => spriteProject1CC62(s, 1)).not.toThrow();
  });

  it("return packing con cz negativo: high word sext-ext", () => {
    const s = emptyGameState();
    // cz = 0xFFFF (= -1 sext), all others = 0 -> frac = 0 -> product = 0.
    writeWord(s, STRUCT_OFF + 0x04, 0);
    writeWord(s, STRUCT_OFF + 0x0e, 0);
    writeWord(s, STRUCT_OFF + 0x10, 0);
    writeWord(s, STRUCT_OFF + 0x1a, 0xffff);
    writeWord(s, BGE_FLAG_OFF, 1);
    writeWord(s, FRAC_X_OFF, 0);
    writeWord(s, FRAC_Y_OFF, 0);
    const r = spriteProject1CC62(s, 0);
    // (sext16(0xFFFF) << 16) = -1 << 16 = 0xFFFF0000 (i32 = -65536)
    // +1*0... → outDy = 0-0xFFFF = 1, outDx = 0-0 = 0; products = 0.
    // outDy = (0 - 0xFFFF) & 0xFFFF = 1 (modulo 2^16)
    expect(readWord(s, OUT_DY_OFF)).toBe(1);
    expect(readWord(s, OUT_DX_OFF)).toBe(0);
    expect(r).toBe(-65536); // i32 signed
  });

  it("wrap-around modulo 2^16 sui delta (cx1=0, cx0=1 → -1 = 0xFFFF)", () => {
    const s = emptyGameState();
    writeWord(s, STRUCT_OFF + 0x04, 1); // cx0
    writeWord(s, STRUCT_OFF + 0x0e, 0); // cx1
    writeWord(s, STRUCT_OFF + 0x10, 0);
    writeWord(s, STRUCT_OFF + 0x1a, 0);
    writeWord(s, BGE_FLAG_OFF, 1);
    writeWord(s, FRAC_X_OFF, 0);
    writeWord(s, FRAC_Y_OFF, 0);
    spriteProject1CC62(s, 0);
    expect(readWord(s, OUT_DX_OFF)).toBe(0xffff); // 0 - 1 = -1 = 0xFFFF
    expect(readWord(s, OUT_DY_OFF)).toBe(1); // cx0 - cz = 1 - 0 = 1
  });
});
