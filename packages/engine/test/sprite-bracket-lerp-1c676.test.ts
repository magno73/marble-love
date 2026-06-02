/**
 * sprite-bracket-lerp-1c676.test.ts — smoke + corner case of FUN_0001C676.
 */

import { describe, it, expect } from "vitest";
import { spriteBracketLerp1C676 } from "../src/sprite-bracket-lerp-1c676.js";
import { emptyGameState } from "../src/state.js";

// ─── Offsets ──────────────────────────────────────────────────────────────────

const FLAGS_OFF    = 0x066a;
const DIR0_OFF     = 0x066c;
const DIR1_OFF     = 0x066e;
const DIR2_OFF     = 0x0670;
const DIR3_OFF     = 0x0672;
const OUT1_OFF     = 0x0674;
const OUT2_OFF     = 0x0676;
const OUT3_OFF     = 0x0678;
const OUT4_OFF     = 0x067a;
const OUT5_OFF     = 0x067c;
const OUT6_OFF     = 0x067e;
const OUT7_OFF     = 0x0680;
const OUT8_OFF     = 0x0682;
const BASE_OFF     = 0x0694;
const FACTOR_B_OFF = 0x069e;
const FACTOR_A_OFF = 0x06a0;
const S1_OFF = 0x1c28;
const S2_OFF = 0x1c30;
const S3_OFF = 0x1c38;
const S4_OFF = 0x1c40;

function rw(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}

function ww(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off]     = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}

function rb(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (s.workRam[off] ?? 0) & 0xff;
}

/**
 * Populate all four structs + globals, call the function, and return the state.
 */
function run(opts: {
  s1?: number[];
  s2?: number[];
  s3?: number[];
  s4?: number[];
  factorA?: number;
  factorB?: number;
  base?: number;
}): ReturnType<typeof emptyGameState> {
  const s = emptyGameState();
  const fill = (base: number, ws: number[] | undefined): void => {
    if (!ws) return;
    ws.forEach((w, i) => ww(s, base + i * 2, w));
  };
  fill(S1_OFF, opts.s1);
  fill(S2_OFF, opts.s2);
  fill(S3_OFF, opts.s3);
  fill(S4_OFF, opts.s4);
  if (opts.factorA !== undefined) ww(s, FACTOR_A_OFF, opts.factorA);
  if (opts.factorB !== undefined) ww(s, FACTOR_B_OFF, opts.factorB);
  if (opts.base !== undefined) ww(s, BASE_OFF, opts.base);
  spriteBracketLerp1C676(s);
  return s;
}

// ─── Helpers to compute expected lerp ─────────────────────────────────────────

function lerp(a: number, b: number, factor: number): number {
  const da = a & 0x8000 ? a - 0x10000 : a;
  const db = b & 0x8000 ? b - 0x10000 : b;
  const df = factor & 0x8000 ? factor - 0x10000 : factor;
  return ((((da - db) * df + 4) | 0) >> 3) | 0;
}

describe("spriteBracketLerp1C676 (FUN_0001C676)", () => {
  it("azzera all the bytes of controllo to the inizio", () => {
    const s = emptyGameState();
    // Pre-set dirty values
    s.workRam[FLAGS_OFF] = 0xff;
    s.workRam[DIR0_OFF]  = 0xaa;
    s.workRam[DIR1_OFF]  = 0xbb;
    s.workRam[DIR2_OFF]  = 0xcc;
    s.workRam[DIR3_OFF]  = 0xdd;
    spriteBracketLerp1C676(s);
    // All cleared initially; flags may be re-set by min-checks, dirs by brackets
    // Verify: since all structs/factors are 0, no min-checks fire, dirs stay 0
    expect(rb(s, FLAGS_OFF)).toBe(0);
    expect(rb(s, DIR0_OFF)).toBe(0);
    expect(rb(s, DIR1_OFF)).toBe(0);
    expect(rb(s, DIR2_OFF)).toBe(0);
    expect(rb(s, DIR3_OFF)).toBe(0);
  });

  it("bracket-1 dir=1: s1[4]<s1[6] → dir=1, OUT1=s4[0]+lerp, no bump", () => {
    // s1[4]=10 < s1[6]=20 → dir=1, out=s4[0]=5
    // bumpPivot=s4[0]=5 != hi=s1[6]=20 → no bump
    // lerp1 = (s1[6]-s4[0])*factorA = (20-5)*4 = 60; (+4)>>3 = (60+4)>>3 = 8
    // OUT1 = 5 + 8 = 13; after subtract base=0 → 13
    const s = run({
      s1: [0, 0, 10, 20],
      s4: [5, 0, 0, 0],
      factorA: 4,
      factorB: 0,
      base: 0,
    });
    expect(rw(s, OUT1_OFF)).toBe(13);
    expect(rb(s, DIR0_OFF)).toBe(1);
  });

  it("bracket-1 dir=3: s1[4]>=s1[6] AND s4[2]>=s4[0] → dir=3, OUT1=s4[2]+lerp", () => {
    // s1[4]=30 >= s1[6]=20 AND s4[2]=10 >= s4[0]=5 → dir=3, out=s4[2]=10
    // bumpPivot=s4[0]=5 != hi=s1[6]=20 → no bump
    // lerp3 = (s1[4]-s4[2])*factorA = (30-10)*2 = 40; (+4)>>3 = 5
    // OUT1 = 10 + 5 = 15; base=0 → 15
    const s = run({
      s1: [0, 0, 30, 20],
      s4: [5, 10, 0, 0],
      factorA: 2,
      factorB: 0,
      base: 0,
    });
    expect(rw(s, OUT1_OFF)).toBe(15);
    expect(rb(s, DIR0_OFF)).toBe(3);
  });

  it("bracket-1 equality skip: s1[4]==s1[6] AND s4[2]==s4[0] → OUT1 unchanged (0)", () => {
    // Equality skip: both equal → bracket skipped entirely
    const s = run({
      s1: [0, 0, 7, 7],
      s4: [3, 3, 0, 0],
      factorA: 100,
    });
    // OUT1 not written → stays 0 (after subtract base=0)
    expect(rw(s, OUT1_OFF)).toBe(0);
    expect(rb(s, DIR0_OFF)).toBe(0);
  });

  it("bracket-1 bump: s4[0]==s1[6] → dir=1+1=2 (no lerp applied)", () => {
    // s1[4]=5 < s1[6]=10 → dir=1 initially
    // bumpPivot=s4[0]=10 == hi=s1[6]=10 → dir becomes 2 → no lerp
    // OUT1 = s4[0] = 10, no lerp applied
    const s = run({
      s1: [0, 0, 5, 10],
      s4: [10, 0, 0, 0],
      factorA: 100,
      base: 0,
    });
    expect(rw(s, OUT1_OFF)).toBe(10); // no lerp
    expect(rb(s, DIR0_OFF)).toBe(2);
  });

  it("min-check block A: s1[4]<s1[0] && s1[6]<s1[0] && s1[2]<s1[0] → flag|=1, OUT5=s1[0]", () => {
    // All three probes smaller than pivot s1[0]=100
    const s = run({
      s1: [100, 50, 30, 70],
      base: 0,
    });
    expect(rb(s, FLAGS_OFF) & 0x01).toBe(1);
    expect(rw(s, OUT5_OFF)).toBe(100);
  });

  it("min-check block B: s2[6]<s2[2] && s2[0]<s2[2] && s2[4]<s2[2] → flag|=2, OUT6=s2[2]", () => {
    const s = run({
      s2: [10, 200, 30, 40],
      base: 0,
    });
    expect(rb(s, FLAGS_OFF) & 0x02).toBe(2);
    expect(rw(s, OUT6_OFF)).toBe(200);
  });

  it("min-check blocks E: s1[0]<s1[4] ... → flag|=0x10, OUT5=s1[4] (overrides A if both fire)", () => {
    // Block E fires: s1[0]<s1[4] && s1[6]<s1[4] && s1[2]<s1[4]
    // s1 = [10, 20, 30, 50] → s1[0]=10, s1[2]=30, s1[4]=50, s1[6]=20?
    // Wait, need to check which index maps where: array is [+0,+2,+4,+6]
    // Block E: s1[0]<s1[4]=50 (10<50✓), s1[6]<s1[4]=50 (20<50✓), s1[2]<s1[4]=50 (30<50✓) → fires
    // Block A: s1[4]<s1[0]=10? → 50<10? no → does not fire
    const s = run({
      s1: [10, 30, 50, 20],
      base: 0,
    });
    expect(rb(s, FLAGS_OFF) & 0x10).toBe(0x10);
    expect(rw(s, OUT5_OFF)).toBe(50);
  });

  it("phase-3 subtract: base subtracted from all 8 OUTs", () => {
    // Set up so OUT1 gets written to 20, then subtract base=5 → expect 15
    // s1[4]=10 < s1[6]=20 → dir=1, out=s4[0]=20
    // bumpPivot=s4[0]=20 == hi=s1[6]=20 → dir=2, no lerp → OUT1 stays 20
    // base=5 → OUT1 = 20-5=15
    const s = run({
      s1: [0, 0, 10, 20],
      s4: [20, 0, 0, 0],
      factorA: 0,
      base: 5,
    });
    expect(rw(s, OUT1_OFF)).toBe(15);
  });

  it("zeros in, zeros out: all-zero state → all OUTs 0, no flags", () => {
    // With all zeros: all structs zero, factors zero, base zero.
    // All brackets: s1[4]==s1[6](=0) AND s4[2]==s4[0](=0) → equality skip.
    // All min-checks: all probes == pivot → NOT strictly < → no flags fire.
    const s = run({});
    expect(rb(s, FLAGS_OFF)).toBe(0);
    for (const off of [OUT1_OFF, OUT2_OFF, OUT3_OFF, OUT4_OFF,
                       OUT5_OFF, OUT6_OFF, OUT7_OFF, OUT8_OFF]) {
      expect(rw(s, off)).toBe(0);
    }
  });
});
