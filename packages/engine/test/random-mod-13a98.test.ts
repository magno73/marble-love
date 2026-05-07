/**
 * random-mod-13a98.test.ts — unit test per `randomMod13A98` (FUN_00013A98).
 *
 * Verifica:
 *   1. Output range [0, maxExclusive)
 *   2. Determinismo dato lo stesso seed iniziale
 *   3. Caso limite: maxExclusive == 0
 *   4. Coerenza con rngNext (randomMod13A98 è un wrapper)
 *   5. Aggiornamento corretto del seed in state.rng
 */

import { describe, it, expect } from "vitest";
import { as_u16 } from "../src/wrap.js";
import { randomMod13A98, RANDOM_MOD_13A98_ADDR } from "../src/random-mod-13a98.js";
import { rngInit, rngNext } from "../src/rng.js";
import { emptyGameState } from "../src/state.js";

function makeState(seed: number) {
  const s = emptyGameState();
  s.rng = rngInit(as_u16(seed));
  return s;
}

describe("randomMod13A98 — FUN_00013A98", () => {
  it("exports address constant", () => {
    expect(RANDOM_MOD_13A98_ADDR).toBe(0x00013a98);
  });

  it("output is in [0, maxExclusive) for typical limits", () => {
    for (const limit of [1, 2, 5, 10, 100, 0xff, 0x100, 256]) {
      const state = makeState(0x1234);
      const v = randomMod13A98(state, limit);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(limit);
    }
  });

  it("deterministic given same initial seed", () => {
    const s1 = makeState(0xabcd);
    const s2 = makeState(0xabcd);
    const v1 = randomMod13A98(s1, 0x100);
    const v2 = randomMod13A98(s2, 0x100);
    expect(v1).toBe(v2);
  });

  it("sequence is deterministic across multiple calls", () => {
    const s1 = makeState(0x5678);
    const s2 = makeState(0x5678);
    const seq1 = [
      randomMod13A98(s1, 0x100),
      randomMod13A98(s1, 0xff),
      randomMod13A98(s1, 7),
      randomMod13A98(s1, 100),
    ];
    const seq2 = [
      randomMod13A98(s2, 0x100),
      randomMod13A98(s2, 0xff),
      randomMod13A98(s2, 7),
      randomMod13A98(s2, 100),
    ];
    expect(seq1).toEqual(seq2);
  });

  it("maxExclusive=0 returns current seed without advancing (binary behavior)", () => {
    const state = makeState(0xabcd);
    const v = randomMod13A98(state, 0);
    // D0 = current seed (unchanged), beq done skips mask+reduction
    expect(v).toBe(0xabcd);
    // Seed should remain unchanged
    expect((state.rng.seed as unknown as number) & 0xffff).toBe(0xabcd);
  });

  it("matches rngNext directly (wrapper equivalence)", () => {
    const seed = 0x1111;
    const limits = [0x100, 0xff, 7, 100, 1];

    // Using randomMod13A98
    const stateA = makeState(seed);
    const outA = limits.map((l) => randomMod13A98(stateA, l));

    // Using rngNext directly
    const rstate = rngInit(as_u16(seed));
    const outB = limits.map((l) => rngNext(rstate, as_u16(l)) as unknown as number);

    expect(outA).toEqual(outB);
  });

  it("advances rng.seed on each call", () => {
    const state = makeState(0x9999);
    const seed0 = (state.rng.seed as unknown as number) & 0xffff;
    randomMod13A98(state, 0x100);
    const seed1 = (state.rng.seed as unknown as number) & 0xffff;
    randomMod13A98(state, 0x100);
    const seed2 = (state.rng.seed as unknown as number) & 0xffff;
    // Seed should change each call
    expect(seed1).not.toBe(seed0);
    expect(seed2).not.toBe(seed1);
  });

  it("maxExclusive=1 always returns 0 (only valid value in [0,1))", () => {
    for (let seed = 0; seed < 64; seed++) {
      const state = makeState(seed);
      expect(randomMod13A98(state, 1)).toBe(0);
    }
  });

  it("bit-perfect snapshot — known output from seed 0, limit 0x100", () => {
    // These values are verified against the binary in the parity test.
    // Snapshot locked here so regressions surface immediately.
    const state = makeState(0);
    const out = [
      randomMod13A98(state, 100),
      randomMod13A98(state, 100),
      randomMod13A98(state, 0xff),
      randomMod13A98(state, 7),
      randomMod13A98(state, 0x1000),
    ];
    expect(out).toEqual([64, 64, 193, 0, 901]);
  });
});
