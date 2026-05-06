/**
 * state-sub-1960e.test.ts — smoke tests per `FUN_0001960E`.
 *
 * Verifica i 3 branch principali (state==7, long0==0, long0!=0), il
 * clear-block (state==9 && rng(4)==0) e l'invocazione del sub-stub
 * `fun_19692` che deve avvenire **sempre** in coda.
 */

import { describe, it, expect } from "vitest";
import { stateSub1960E } from "../src/state-sub-1960e.js";
import { emptyGameState } from "../src/state.js";
import { as_u32 } from "../src/wrap.js";

const ENTITY_BASE = 0x401e00;
const ENTITY_OFF = ENTITY_BASE - 0x400000;

function setByte(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = v & 0xff;
}

function readByte(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (s.workRam[off] ?? 0) & 0xff;
}

function readLongBE(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    ((s.workRam[off] ?? 0) << 24) |
    ((s.workRam[off + 1] ?? 0) << 16) |
    ((s.workRam[off + 2] ?? 0) << 8) |
    (s.workRam[off + 3] ?? 0)
  ) >>> 0;
}

function setLongBE(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

describe("stateSub1960E (FUN_0001960E)", () => {
  it("branch state==7: jitter ±2 con 4-bit wrap; chiama fun_19692 sempre", () => {
    const s = emptyGameState();
    s.rng.seed = as_u32(0x1234);
    setByte(s, ENTITY_OFF + 0x25, 7);
    setByte(s, ENTITY_OFF + 0x26, 0x05);
    let calls = 0;
    let lastAddr = 0;
    const r = stateSub1960E(s, ENTITY_BASE, {
      fun_19692: (_st, addr) => {
        calls++;
        lastAddr = addr;
      },
    });
    expect(r.branch).toBe("state7");
    expect(r.firstRng).toBeGreaterThanOrEqual(0);
    expect(r.firstRng).toBeLessThan(5);
    expect(r.finalRng).toBeNull(); // state==7 salta il middle
    expect(r.clearBlockExecuted).toBe(false);
    // newCounter = (5 + rng - 2) & 0xF
    expect(r.newCounter).toBe(((5 + r.firstRng - 2) & 0xff) & 0x0f);
    expect(readByte(s, ENTITY_OFF + 0x26)).toBe(r.newCounter);
    expect(calls).toBe(1);
    expect(lastAddr).toBe(ENTITY_BASE);
  });

  it("branch long0==0: entity[0x26] = rng(2) << 3 ∈ {0,8}; finalRng eseguito", () => {
    const s = emptyGameState();
    s.rng.seed = as_u32(0x9abc);
    setByte(s, ENTITY_OFF + 0x25, 1); // != 7, != 9
    setLongBE(s, ENTITY_OFF + 0x00, 0); // long0 == 0
    setByte(s, ENTITY_OFF + 0x26, 0xff);
    const r = stateSub1960E(s, ENTITY_BASE);
    expect(r.branch).toBe("long0_zero");
    expect(r.firstRng).toBeGreaterThanOrEqual(0);
    expect(r.firstRng).toBeLessThan(2);
    expect(r.finalRng).not.toBeNull();
    expect(r.finalRng!).toBeGreaterThanOrEqual(0);
    expect(r.finalRng!).toBeLessThan(4);
    // newCounter ∈ {0, 8}; clear-block NON triggered (state != 9).
    expect(r.clearBlockExecuted).toBe(false);
    expect([0, 8]).toContain(r.newCounter);
  });

  it("branch long0!=0: entity[0x26] = (rng(2) << 3) + 4 ∈ {4,12}", () => {
    const s = emptyGameState();
    s.rng.seed = as_u32(0xdead);
    setByte(s, ENTITY_OFF + 0x25, 3);
    setLongBE(s, ENTITY_OFF + 0x00, 0xdeadbeef); // != 0
    setByte(s, ENTITY_OFF + 0x26, 0x00);
    const r = stateSub1960E(s, ENTITY_BASE);
    expect(r.branch).toBe("long0_nonzero");
    expect(r.firstRng).toBeGreaterThanOrEqual(0);
    expect(r.firstRng).toBeLessThan(2);
    expect([4, 12]).toContain(r.newCounter);
    expect(r.clearBlockExecuted).toBe(false);
  });

  it("clear-block: state==9 && rng(4)==0 → entity[0x26]=0x10, [0..7]=0", () => {
    // Cerca un seed che produca rng(2) qualunque + rng(4) == 0.
    const s = emptyGameState();
    let foundSeed = -1;
    for (let seed = 0; seed < 0x10000; seed++) {
      const probe = emptyGameState();
      probe.rng.seed = as_u32(seed);
      setByte(probe, ENTITY_OFF + 0x25, 9);
      setLongBE(probe, ENTITY_OFF + 0x00, 0xdeadbeef);
      setLongBE(probe, ENTITY_OFF + 0x04, 0xcafebabe);
      const r = stateSub1960E(probe, ENTITY_BASE);
      if (r.clearBlockExecuted) {
        foundSeed = seed;
        break;
      }
    }
    expect(foundSeed).toBeGreaterThanOrEqual(0);

    s.rng.seed = as_u32(foundSeed);
    setByte(s, ENTITY_OFF + 0x25, 9);
    setLongBE(s, ENTITY_OFF + 0x00, 0xdeadbeef);
    setLongBE(s, ENTITY_OFF + 0x04, 0xcafebabe);
    const r = stateSub1960E(s, ENTITY_BASE);
    expect(r.clearBlockExecuted).toBe(true);
    expect(r.newCounter).toBe(0x10);
    expect(readByte(s, ENTITY_OFF + 0x26)).toBe(0x10);
    expect(readLongBE(s, ENTITY_OFF + 0x00)).toBe(0);
    expect(readLongBE(s, ENTITY_OFF + 0x04)).toBe(0);
  });

  it("subs assente → no crash, fun_19692 silenziosamente skippato", () => {
    const s = emptyGameState();
    setByte(s, ENTITY_OFF + 0x25, 0); // long0==0 default
    expect(() => stateSub1960E(s, ENTITY_BASE)).not.toThrow();
  });

  it("state byte non-7-non-9: clear-block mai triggered anche se rng(4)==0", () => {
    const s = emptyGameState();
    // Forza rng(4) = 0 cercando un seed
    let foundSeed = -1;
    for (let seed = 0; seed < 0x10000; seed++) {
      const probe = emptyGameState();
      probe.rng.seed = as_u32(seed);
      setByte(probe, ENTITY_OFF + 0x25, 5); // != 9
      setLongBE(probe, ENTITY_OFF + 0x00, 0);
      const r = stateSub1960E(probe, ENTITY_BASE);
      if (r.finalRng === 0) {
        foundSeed = seed;
        break;
      }
    }
    expect(foundSeed).toBeGreaterThanOrEqual(0);
    s.rng.seed = as_u32(foundSeed);
    setByte(s, ENTITY_OFF + 0x25, 5);
    setLongBE(s, ENTITY_OFF + 0x00, 0);
    const r = stateSub1960E(s, ENTITY_BASE);
    expect(r.finalRng).toBe(0);
    expect(r.clearBlockExecuted).toBe(false);
  });

  it("state==7: la jitter wrap-around 4-bit funziona con counter=0xF, rng=4 → (0xF+4-2)&0xF = 1", () => {
    const s = emptyGameState();
    // Cerca seed che produca rng(5) = 4
    let foundSeed = -1;
    for (let seed = 0; seed < 0x10000; seed++) {
      const probe = emptyGameState();
      probe.rng.seed = as_u32(seed);
      setByte(probe, ENTITY_OFF + 0x25, 7);
      setByte(probe, ENTITY_OFF + 0x26, 0xf);
      const r = stateSub1960E(probe, ENTITY_BASE);
      if (r.firstRng === 4) {
        foundSeed = seed;
        break;
      }
    }
    expect(foundSeed).toBeGreaterThanOrEqual(0);
    s.rng.seed = as_u32(foundSeed);
    setByte(s, ENTITY_OFF + 0x25, 7);
    setByte(s, ENTITY_OFF + 0x26, 0xf);
    const r = stateSub1960E(s, ENTITY_BASE);
    expect(r.firstRng).toBe(4);
    expect(r.newCounter).toBe(1);
  });
});
