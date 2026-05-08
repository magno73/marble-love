/**
 * helper-25e7c.test.ts — smoke tests di `helper25E7C` (FUN_00025E7C).
 *
 * Verifica i path principali:
 *   1. Costante `HELPER_25E7C_ADDR`
 *   2. Zero velocità → zero output (tutti i modi)
 *   3. Mode 0/default: scale = max(0, D3 - friction)
 *   4. Mode 2: scale = max(0, D3 - friction*4)
 *   5. Mode 3: vx usa max(0, D3 - friction*5), vy usa max(0, D3 - friction)
 *   6. Mode 4: scale = D3 + friction/4 (può aumentare la velocità)
 *   7. Simmetria segno: neg e pos convergono verso lo stesso abs
 *   8. No-crash con state vuoto e objPtr al limite workRam
 *
 * Parity bit-perfect (500/500 casi random) verificata in
 * `packages/cli/src/test-helper-25e7c-parity.ts` vs Musashi.
 */

import { describe, it, expect } from "vitest";
import { helper25E7C, HELPER_25E7C_ADDR } from "../src/helper-25e7c.js";
import { emptyGameState } from "../src/state.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeLongBE(ram: Uint8Array, off: number, val: number): void {
  const u = val >>> 0;
  ram[off]     = (u >>> 24) & 0xff;
  ram[off + 1] = (u >>> 16) & 0xff;
  ram[off + 2] = (u >>>  8) & 0xff;
  ram[off + 3] =  u         & 0xff;
}

function readLongBE(ram: Uint8Array, off: number): number {
  return (
    (((ram[off]     ?? 0) << 24) |
     ((ram[off + 1] ?? 0) << 16) |
     ((ram[off + 2] ?? 0) << 8)  |
      (ram[off + 3] ?? 0)) >>> 0
  );
}

function readLongSigned(ram: Uint8Array, off: number): number {
  const u = readLongBE(ram, off);
  return u >= 0x80000000 ? u - 0x100000000 : u;
}

/** workRam offset for an object at absolute address 0x401000. */
const OBJ_ABS = 0x00401000;
const OBJ_OFF = OBJ_ABS - 0x400000; // 0x1000

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("helper25E7C (FUN_00025E7C)", () => {
  it("HELPER_25E7C_ADDR is correct", () => {
    expect(HELPER_25E7C_ADDR).toBe(0x25e7c);
  });

  it("no-crash with empty state", () => {
    const state = emptyGameState();
    expect(() => helper25E7C(state, OBJ_ABS, 0)).not.toThrow();
  });

  it("no-crash with objPtr at edge of workRam", () => {
    const state = emptyGameState();
    expect(() => helper25E7C(state, 0x401ff8, 1)).not.toThrow();
  });

  it("zero vx and vy → zero output (mode 0)", () => {
    const state = emptyGameState();
    writeLongBE(state.workRam, OBJ_OFF + 0, 0);
    writeLongBE(state.workRam, OBJ_OFF + 4, 0);
    helper25E7C(state, OBJ_ABS, 0);
    expect(readLongBE(state.workRam, OBJ_OFF + 0)).toBe(0);
    expect(readLongBE(state.workRam, OBJ_OFF + 4)).toBe(0);
  });

  it("zero velocities → zero output (mode 3)", () => {
    const state = emptyGameState();
    writeLongBE(state.workRam, OBJ_OFF + 0, 0);
    writeLongBE(state.workRam, OBJ_OFF + 4, 0);
    helper25E7C(state, OBJ_ABS, 3);
    expect(readLongBE(state.workRam, OBJ_OFF + 0)).toBe(0);
    expect(readLongBE(state.workRam, OBJ_OFF + 4)).toBe(0);
  });

  it("mode 0: non-zero velocity decays toward zero", () => {
    const state = emptyGameState();
    const vx = 0x00100000; // large positive
    const vy = 0x00080000;
    writeLongBE(state.workRam, OBJ_OFF + 0, vx);
    writeLongBE(state.workRam, OBJ_OFF + 4, vy);
    helper25E7C(state, OBJ_ABS, 0);
    const vxOut = readLongSigned(state.workRam, OBJ_OFF + 0);
    const vyOut = readLongSigned(state.workRam, OBJ_OFF + 4);
    // Mode 0 applies damping, so |vxOut| <= |vx|
    expect(Math.abs(vxOut)).toBeLessThanOrEqual(vx);
    expect(Math.abs(vyOut)).toBeLessThanOrEqual(vy);
  });

  it("mode 2: stronger damping than mode 0", () => {
    const state0 = emptyGameState();
    const state2 = emptyGameState();
    const vx = 0x00100000;
    const vy = 0x00080000;
    for (const s of [state0, state2]) {
      writeLongBE(s.workRam, OBJ_OFF + 0, vx);
      writeLongBE(s.workRam, OBJ_OFF + 4, vy);
    }
    helper25E7C(state0, OBJ_ABS, 0);
    helper25E7C(state2, OBJ_ABS, 2);
    const vx0 = readLongSigned(state0.workRam, OBJ_OFF + 0);
    const vx2 = readLongSigned(state2.workRam, OBJ_OFF + 0);
    // Mode 2 uses friction*4, so more aggressive → smaller result
    expect(Math.abs(vx2)).toBeLessThanOrEqual(Math.abs(vx0));
  });

  it("mode 3: vx and vy get different ratios", () => {
    const state = emptyGameState();
    // Use a velocity where both components are non-zero
    const vx = 0x00100000;
    const vy = 0x00100000; // equal
    writeLongBE(state.workRam, OBJ_OFF + 0, vx);
    writeLongBE(state.workRam, OBJ_OFF + 4, vy);
    helper25E7C(state, OBJ_ABS, 3);
    const vxOut = readLongSigned(state.workRam, OBJ_OFF + 0);
    const vyOut = readLongSigned(state.workRam, OBJ_OFF + 4);
    // Mode 3: vx uses friction*5 (stronger), vy uses friction*1 (weaker)
    // So vxOut should be <= vyOut in magnitude (since more damped)
    expect(Math.abs(vxOut)).toBeLessThanOrEqual(Math.abs(vyOut));
  });

  it("negative vx decays toward zero (mode 0)", () => {
    const state = emptyGameState();
    const vxNeg = ((-0x00100000) >>> 0); // signed negative as u32
    writeLongBE(state.workRam, OBJ_OFF + 0, vxNeg);
    writeLongBE(state.workRam, OBJ_OFF + 4, 0);
    helper25E7C(state, OBJ_ABS, 0);
    const vxOut = readLongSigned(state.workRam, OBJ_OFF + 0);
    // Negative input → negative output (sign preserved), magnitude reduced
    expect(vxOut).toBeLessThan(0);
    expect(Math.abs(vxOut)).toBeLessThanOrEqual(0x00100000);
  });

  it("sign symmetry: ±vx yield same magnitude output", () => {
    const statePos = emptyGameState();
    const stateNeg = emptyGameState();
    const vx = 0x00080000;
    const vy = 0x00040000;
    writeLongBE(statePos.workRam, OBJ_OFF + 0, vx);
    writeLongBE(statePos.workRam, OBJ_OFF + 4, vy);
    writeLongBE(stateNeg.workRam, OBJ_OFF + 0, (-vx) >>> 0);
    writeLongBE(stateNeg.workRam, OBJ_OFF + 4, (-vy) >>> 0);
    helper25E7C(statePos, OBJ_ABS, 0);
    helper25E7C(stateNeg, OBJ_ABS, 0);
    const vxPos = readLongSigned(statePos.workRam, OBJ_OFF + 0);
    const vxNeg = readLongSigned(stateNeg.workRam, OBJ_OFF + 0);
    const vyPos = readLongSigned(statePos.workRam, OBJ_OFF + 4);
    const vyNeg = readLongSigned(stateNeg.workRam, OBJ_OFF + 4);
    expect(Math.abs(vxPos)).toBe(Math.abs(vxNeg));
    expect(Math.abs(vyPos)).toBe(Math.abs(vyNeg));
  });

  it("mode 4: scale can be larger than D3 (adds friction/4)", () => {
    const state4 = emptyGameState();
    const state0 = emptyGameState();
    const vx = 0x00100000;
    const vy = 0x00080000;
    for (const s of [state4, state0]) {
      writeLongBE(s.workRam, OBJ_OFF + 0, vx);
      writeLongBE(s.workRam, OBJ_OFF + 4, vy);
    }
    helper25E7C(state4, OBJ_ABS, 4);
    helper25E7C(state0, OBJ_ABS, 0);
    const vx4 = readLongSigned(state4.workRam, OBJ_OFF + 0);
    const vx0 = readLongSigned(state0.workRam, OBJ_OFF + 0);
    // Mode 4 adds friction/4 to D3, so scale_primary > default
    // → output magnitude ≥ mode-0 output
    expect(Math.abs(vx4)).toBeGreaterThanOrEqual(Math.abs(vx0));
  });

  it("only offsets +0 and +4 are modified (no other workRam side effects)", () => {
    const state = emptyGameState();
    const vx = 0x00100000;
    const vy = 0x00080000;
    writeLongBE(state.workRam, OBJ_OFF + 0, vx);
    writeLongBE(state.workRam, OBJ_OFF + 4, vy);
    // Set sentinel bytes before and after the two longs
    state.workRam[OBJ_OFF - 1] = 0xAB;
    state.workRam[OBJ_OFF + 8] = 0xCD;
    helper25E7C(state, OBJ_ABS, 0);
    expect(state.workRam[OBJ_OFF - 1]).toBe(0xAB);
    expect(state.workRam[OBJ_OFF + 8]).toBe(0xCD);
  });

  it("mode 1 (default path) same result as mode 0", () => {
    const state0 = emptyGameState();
    const state1 = emptyGameState();
    const vx = 0x00100000;
    const vy = 0x00080000;
    for (const s of [state0, state1]) {
      writeLongBE(s.workRam, OBJ_OFF + 0, vx);
      writeLongBE(s.workRam, OBJ_OFF + 4, vy);
    }
    helper25E7C(state0, OBJ_ABS, 0);
    helper25E7C(state1, OBJ_ABS, 1);
    expect(readLongBE(state0.workRam, OBJ_OFF + 0)).toBe(
      readLongBE(state1.workRam, OBJ_OFF + 0)
    );
    expect(readLongBE(state0.workRam, OBJ_OFF + 4)).toBe(
      readLongBE(state1.workRam, OBJ_OFF + 4)
    );
  });
});
