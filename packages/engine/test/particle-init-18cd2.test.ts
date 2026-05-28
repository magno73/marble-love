/**
 * particle-init-18cd2.test.ts — smoke tests per `FUN_00018CD2`.
 *
 * Verifica:
 *   - count = 0 -> no slot, byte count still written
 *   - mode in [0..0x7F] → entry[8..9] determinato (no RNG step extra)
 *   - mode == 0xFF -> palette refresh callback invoked + rng(8) per slot
 *   - count > 0 -> fun_18e6c callback invoked `count` times with (0x2C, i)
 *   - byte @ 0x4003E2 written with count
 */

import { describe, it, expect } from "vitest";
import { particleInit18CD2 } from "../src/particle-init-18cd2.js";
import { emptyGameState } from "../src/state.js";
import { as_u32 } from "../src/wrap.js";

const PARTICLE_BASE_OFF = 0xa9c;
const COUNT_BYTE_OFF = 0x3e2;

function readWordBE(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff
  );
}

describe("particleInit18CD2 (FUN_00018CD2)", () => {
  it("count=0 → no slot, byte 0x3E2 = 0, no callback invocata", () => {
    const s = emptyGameState();
    s.rng.seed = as_u32(0x1234);
    let cfaCalls = 0;
    let e6cCalls = 0;
    const r = particleInit18CD2(s, 0, 0x10, {
      fun_26cfa: () => { cfaCalls++; },
      fun_18e6c: () => { e6cCalls++; },
    });
    expect(r.count).toBe(0);
    expect(r.mode).toBe(0x10);
    expect(r.paletteRefreshed).toBe(false);
    expect(r.slots.length).toBe(0);
    expect(cfaCalls).toBe(0);
    expect(e6cCalls).toBe(0);
    expect(s.workRam[COUNT_BYTE_OFF]).toBe(0);
  });

  it("mode=0xFF + count=3 → fun_26cfa invocata 1 volta + fun_18e6c 3 volte", () => {
    const s = emptyGameState();
    s.rng.seed = as_u32(0xbeef);
    let cfaCalls = 0;
    const e6cArgs: Array<[number, number]> = [];
    const r = particleInit18CD2(s, 3, 0xff, {
      fun_26cfa: () => { cfaCalls++; },
      fun_18e6c: (_st, t, i) => { e6cArgs.push([t, i]); },
    });
    expect(r.count).toBe(3);
    expect(r.mode).toBe(0xff);
    expect(r.paletteRefreshed).toBe(true);
    expect(cfaCalls).toBe(1);
    expect(e6cArgs).toEqual([[0x2c, 0], [0x2c, 1], [0x2c, 2]]);
    expect(s.workRam[COUNT_BYTE_OFF]).toBe(3);
    expect(r.slots.length).toBe(3);
    // Every slot must have modeWord in {0..7} << 11.
    for (const slot of r.slots) {
      const top = (slot.modeWord >>> 11) & 0xffff;
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThan(8);
      expect((slot.modeWord & 0x07ff)).toBe(0);
    }
  });

  it("mode=0x05 (positivo, no RNG extra) → entry[8..9] = (5 << 11) = 0x2800", () => {
    const s = emptyGameState();
    s.rng.seed = as_u32(0x4242);
    const r = particleInit18CD2(s, 1, 0x05);
    expect(r.slots.length).toBe(1);
    expect(r.slots[0]!.modeWord).toBe(0x2800);
    expect(readWordBE(s, PARTICLE_BASE_OFF + 8)).toBe(0x2800);
    expect(r.paletteRefreshed).toBe(false);
    expect(s.workRam[COUNT_BYTE_OFF]).toBe(1);
  });

  it("mode in [0x80..0xFE]: entry[8..9] = (rng(2) << 11) ∈ {0, 0x800}", () => {
    const s = emptyGameState();
    s.rng.seed = as_u32(0xa5a5);
    const r = particleInit18CD2(s, 5, 0x80);
    expect(r.paletteRefreshed).toBe(false);
    for (const slot of r.slots) {
      expect([0, 0x800]).toContain(slot.modeWord);
    }
  });

  it("subs assenti → no crash, default no-op", () => {
    const s = emptyGameState();
    s.rng.seed = as_u32(0xdead);
    expect(() => particleInit18CD2(s, 4, 0xff)).not.toThrow();
    expect(s.workRam[COUNT_BYTE_OFF]).toBe(4);
  });

  it("xvel/yvel: entry[4..5] e [6..7] sempre adjusted ±0x10 (no zero center)", () => {
    // Output always has a +/-0x10 offset from center. For `count=10` slots
    // dovremmo avere ALL i 4 byte (xvel + yvel) ben definiti.
    const s = emptyGameState();
    s.rng.seed = as_u32(0xabcd);
    const r = particleInit18CD2(s, 10, 0x00);
    for (const slot of r.slots) {
      // xvel, yvel sono u16; convertiamo in signed per check.
      const xs = slot.xvel >= 0x8000 ? slot.xvel - 0x10000 : slot.xvel;
      const ys = slot.yvel >= 0x8000 ? slot.yvel - 0x10000 : slot.yvel;
      // xvel: r2 in [0..0x5F] => raw in [-0x30..0x2F]; adj +-0x10 => exits by
      // ±0x10 dal range raw. Range finale: [-0x40..-0x11] ∪ [0x10..0x3F].
      // Therefore |xvel| is always >= 0x10.
      expect(Math.abs(xs)).toBeGreaterThanOrEqual(0x10);
      expect(Math.abs(ys)).toBeGreaterThanOrEqual(0x10);
    }
  });
});
