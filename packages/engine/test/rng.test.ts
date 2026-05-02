/**
 * Test RNG. Algoritmo identificato in Phase 2 (`docs/static-overview.md`):
 * `FUN_00013A98` legge/scrive `0x4003A6` con LFSR Galois 16-bit + range limit.
 *
 * **Status del test**: questi test FREEZANO la nostra implementazione corrente
 * (best-guess dal disassembly). Phase 6 (hill-climbing) verificherà bit-perfect
 * parity contro un trace MAME reale e calibrerà se necessario. Quando il diff
 * diverge sul campo `rng.seed`, questo test andrà aggiornato con i valori
 * corretti dall'oracolo.
 *
 * Il PRD §6 Phase 4 acceptance richiede "10000 chiamate match con oracolo MAME".
 * Per arrivarci serve uno "RNG trace" tipo: ogni chiamata a FUN_13A98 logga
 * (limit_arg, prev_seed, new_seed). Questo richiede un Lua hook con write
 * watchpoint su 0x4003A6 — TBD inizio Phase 6.
 */

import { describe, it, expect } from "vitest";
import { as_u16 } from "../src/wrap.js";
import { rngInit, rngNext, rngStepOnce, rngAdvanceForLimit } from "../src/rng.js";

describe("RNG step (Galois LFSR 16-bit)", () => {
  it("seed 0 produces deterministic step", () => {
    const a = rngStepOnce(as_u16(0));
    expect(a).toBe(rngStepOnce(as_u16(0)));
  });

  it("anti-zero attractor: state 0 does NOT stay 0", () => {
    // L'algoritmo originale ha `if (D0.h ^ D0.l) == 0: feedback = 0x40`,
    // proprio per evitare che state = 0 sia un attrattore stabile.
    const next = rngStepOnce(as_u16(0));
    expect(next).not.toBe(0);
  });

  it("step is a permutation (collision-free over 1024 distinct seeds)", () => {
    // LFSR è una bijezione: stati distinti → output distinti
    const seen = new Set<number>();
    for (let i = 0; i < 1024; i++) {
      const out = rngStepOnce(as_u16(i)) as unknown as number;
      seen.add(out);
    }
    expect(seen.size).toBe(1024);
  });

  it("rngAdvanceForLimit advances state by bit_length(limit) steps", () => {
    // limit = 1 → 1 step, limit = 0xFF → 8 step, limit = 0xFFFF → 16 step
    const s0 = as_u16(0x1234);
    const s1step = rngStepOnce(s0);
    expect(rngAdvanceForLimit(s0, as_u16(1))).toBe(s1step);
  });
});

describe("RNG next() with range limit", () => {
  it("bounded result for various limits", () => {
    const state = rngInit(as_u16(0x4321));
    for (const limit of [10, 100, 0xff, 0x100, 0x1000, 0x7fff]) {
      const v = rngNext(state, as_u16(limit)) as unknown as number;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(limit);
    }
  });

  it("limit=0 returns current seed (matches binary behavior)", () => {
    const state = rngInit(as_u16(0xabcd));
    const v = rngNext(state, as_u16(0));
    expect(v as unknown as number).toBe(0xabcd);
  });

  it("frame counter increments on each call", () => {
    const state = rngInit(as_u16(0));
    const before = state.callsThisFrame as unknown as number;
    rngNext(state, as_u16(100));
    rngNext(state, as_u16(50));
    rngNext(state, as_u16(200));
    expect((state.callsThisFrame as unknown as number) - before).toBe(3);
  });

  it("seed evolves across calls (deterministic but non-trivial)", () => {
    const state = rngInit(as_u16(0));
    const seeds: number[] = [];
    for (let i = 0; i < 20; i++) {
      rngNext(state, as_u16(0xff));
      seeds.push(state.seed as unknown as number);
    }
    // Tutti i seed diversi (no period < 20)
    expect(new Set(seeds).size).toBe(20);
  });

  it("snapshot test (freezes current implementation)", () => {
    // Quando Phase 6 calibra il RNG, aggiornare questi valori dal trace MAME.
    const state = rngInit(as_u16(0));
    const out = [
      rngNext(state, as_u16(100)),
      rngNext(state, as_u16(100)),
      rngNext(state, as_u16(0xff)),
      rngNext(state, as_u16(7)),
      rngNext(state, as_u16(0x1000)),
    ].map((x) => x as unknown as number);
    // Snapshot of OUR implementation. May change once we calibrate vs MAME.
    expect(out).toEqual([64, 64, 193, 0, 901]);
  });
});
