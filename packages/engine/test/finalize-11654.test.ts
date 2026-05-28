/**
 * finalize-11654.test.ts — unit test for `finalize11654`.
 *
 * Verifies workRam side effects and sub invocation order.
 */

import { describe, expect, it } from "vitest";
import { finalize11654 } from "../src/finalize-11654.js";
import { emptyGameState } from "../src/state.js";

const WRAM = 0x00400000;

function setW(state: ReturnType<typeof emptyGameState>, addr: number, value: number): void {
  state.workRam[addr - WRAM] = (value >>> 8) & 0xff;
  state.workRam[addr - WRAM + 1] = value & 0xff;
}

function rw(state: ReturnType<typeof emptyGameState>, addr: number): number {
  return (((state.workRam[addr - WRAM] ?? 0) << 8) | (state.workRam[addr - WRAM + 1] ?? 0)) & 0xffff;
}

function rb(state: ReturnType<typeof emptyGameState>, addr: number): number {
  return (state.workRam[addr - WRAM] ?? 0) & 0xff;
}

// ─── helper ─────────────────────────────────────────────────────────────────

interface Call {
  fn: string;
  args: readonly (number | undefined)[];
}

function makeLoggedSubs(calls: Call[]) {
  return {
    renderString0142: (_s: ReturnType<typeof emptyGameState>, textPtr: number, tileBase: number) =>
      calls.push({ fn: "r0142", args: [textPtr, tileBase] }),
    textRender100: (_s: ReturnType<typeof emptyGameState>, textPtr: number, tileBase: number, flags: number) =>
      calls.push({ fn: "tr100", args: [textPtr, tileBase, flags] }),
    waitVblankStateGated: (_s: ReturnType<typeof emptyGameState>, frames: number) =>
      calls.push({ fn: "wait", args: [frames] }),
  };
}

// ─── mode 3 early-return ─────────────────────────────────────────────────────

describe("finalize11654 — mode 3 early return", () => {
  it("mode=3: renders both initial strings then exits without path A/B", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 3);
    setW(s, 0x004003ea, 0);
    const calls: Call[] = [];
    finalize11654(s, undefined, makeLoggedSubs(calls));

    // D2 = 0 (mode != 2), so renderString0142(0x22a26, 0x1800) is called
    expect(calls[0]).toEqual({ fn: "r0142", args: [0x00022a26, 0x1800] });
    // renderString0142(0x22a32, 0x3000 - 0) = 0x3000
    expect(calls[1]).toEqual({ fn: "r0142", args: [0x00022a32, 0x3000] });
    // early return — nothing else
    expect(calls.length).toBe(2);
    // 0x4003EE untouched
    expect(rb(s, 0x004003ee)).toBe(0);
  });
});

// ─── mode 2 palette selector ──────────────────────────────────────────────────

describe("finalize11654 — mode 2 palette selector (D2=0x2000)", () => {
  it("mode=2: skips first renderString, adjusts tileBase by 0x2000", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 2);
    // counter = 0xFFFF → path A
    setW(s, 0x004003ea, 0xffff);
    const calls: Call[] = [];
    finalize11654(s, undefined, makeLoggedSubs(calls));

    // D2 = 0x2000 → first renderString0142 skipped
    expect(calls.find((c) => c.fn === "r0142" && c.args[0] === 0x00022a26)).toBeUndefined();
    // renderString0142(0x22a32, 0x3000 - 0x2000 = 0x1000)
    expect(calls[0]).toEqual({ fn: "r0142", args: [0x00022a32, 0x1000] });
    // Path A: tileBase = 0x3800 - 0x2000 = 0x1800
    expect(calls[1]).toEqual({ fn: "tr100", args: [0x00022a7a, 0x1800, 0x1e] });
  });
});

// ─── path A: counter == 0xFFFF ────────────────────────────────────────────────

describe("finalize11654 — path A (counter == 0xFFFF)", () => {
  it("renders attract-A strings and sets 0x4003EE = 2", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 0); // mode = 0
    setW(s, 0x004003ea, 0xffff);
    const calls: Call[] = [];
    finalize11654(s, undefined, makeLoggedSubs(calls));

    // Initial strings
    expect(calls[0]).toEqual({ fn: "r0142", args: [0x00022a26, 0x1800] });
    expect(calls[1]).toEqual({ fn: "r0142", args: [0x00022a32, 0x3000] });
    // Path A render sequence
    expect(calls[2]).toEqual({ fn: "tr100", args: [0x00022a7a, 0x3800, 0x1e] });
    expect(calls[3]).toEqual({ fn: "wait", args: [0xa] });
    expect(calls[4]).toEqual({ fn: "tr100", args: [0x00022a86, 0x3000, 0x1e] });
    expect(calls[5]).toEqual({ fn: "wait", args: [0xa] });
    expect(calls[6]).toEqual({ fn: "tr100", args: [0x00022a92, 0x3c00, 0x1e] });
    expect(calls.length).toBe(7);
    // 0x4003EE = 2
    expect(rb(s, 0x004003ee)).toBe(2);
  });
});

// ─── path A: counter >= 24 ───────────────────────────────────────────────────

describe("finalize11654 — path A (counter >= 24)", () => {
  it("counter=24: renders attract-A strings and sets 0x4003EE = 2", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 0);
    setW(s, 0x004003ea, 24);
    const calls: Call[] = [];
    finalize11654(s, undefined, makeLoggedSubs(calls));

    expect(calls[2]).toEqual({ fn: "tr100", args: [0x00022a7a, 0x3800, 0x1e] });
    expect(calls[6]).toEqual({ fn: "tr100", args: [0x00022a92, 0x3c00, 0x1e] });
    expect(rb(s, 0x004003ee)).toBe(2);
  });

  it("counter=100: also path A", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 0);
    setW(s, 0x004003ea, 100);
    const calls: Call[] = [];
    finalize11654(s, undefined, makeLoggedSubs(calls));
    expect(rb(s, 0x004003ee)).toBe(2);
    expect(calls.some((c) => c.fn === "tr100" && c.args[0] === 0x00022a7a)).toBe(true);
  });
});

// ─── path B: 12 <= counter <= 23 ─────────────────────────────────────────────

describe("finalize11654 — path B (12 ≤ counter ≤ 23)", () => {
  it("counter=12: renders attract-B strings and sets 0x4003EE = 1", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 0);
    setW(s, 0x004003ea, 12);
    const calls: Call[] = [];
    finalize11654(s, undefined, makeLoggedSubs(calls));

    expect(calls[2]).toEqual({ fn: "tr100", args: [0x00022a56, 0x3800, 0x1e] });
    expect(calls[3]).toEqual({ fn: "wait", args: [0xa] });
    expect(calls[4]).toEqual({ fn: "tr100", args: [0x00022a62, 0x3000, 0x1e] });
    expect(calls[5]).toEqual({ fn: "wait", args: [0xa] });
    expect(calls[6]).toEqual({ fn: "tr100", args: [0x00022a6e, 0x3c00, 0x1e] });
    expect(calls.length).toBe(7);
    expect(rb(s, 0x004003ee)).toBe(1);
  });

  it("counter=23: path B", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 0);
    setW(s, 0x004003ea, 23);
    const calls: Call[] = [];
    finalize11654(s, undefined, makeLoggedSubs(calls));
    expect(rb(s, 0x004003ee)).toBe(1);
    expect(calls.some((c) => c.fn === "tr100" && c.args[0] === 0x00022a56)).toBe(true);
  });
});

// ─── epilogue only: counter <= 11 ────────────────────────────────────────────

describe("finalize11654 — epilogue only (counter <= 11, not -1)", () => {
  it("counter=0: no path A/B, 0x4003EE unchanged", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 0);
    setW(s, 0x004003ea, 0);
    const calls: Call[] = [];
    finalize11654(s, undefined, makeLoggedSubs(calls));

    // Only the 2 initial renderString0142 calls
    expect(calls.length).toBe(2);
    expect(rb(s, 0x004003ee)).toBe(0);
  });

  it("counter=11: also epilogue only", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 0);
    setW(s, 0x004003ea, 11);
    const calls: Call[] = [];
    finalize11654(s, undefined, makeLoggedSubs(calls));
    expect(calls.length).toBe(2);
    expect(rb(s, 0x004003ee)).toBe(0);
  });
});

// ─── workRam address coverage ────────────────────────────────────────────────

describe("finalize11654 — workRam region coverage", () => {
  it("only modifies 0x4003EE (and nothing else) in path A", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 0);
    setW(s, 0x004003ea, 0xffff);
    const before = s.workRam.slice();
    finalize11654(s, undefined, {
      renderString0142: () => undefined,
      textRender100: () => undefined,
      waitVblankStateGated: () => undefined,
    });
    // Only byte at 0x4003EE should differ
    let diffCount = 0;
    let diffOffset = -1;
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== s.workRam[i]) {
        diffCount++;
        diffOffset = i;
      }
    }
    expect(diffCount).toBe(1);
    expect(diffOffset).toBe(0x4003ee - WRAM);
    expect(s.workRam[0x4003ee - WRAM]).toBe(2);
  });
});

// ─── FINALIZE_11654_ADDR constant ─────────────────────────────────────────────

describe("finalize11654 — constants", () => {
  it("exports correct address constant", async () => {
    const mod = await import("../src/finalize-11654.js");
    expect(mod.FINALIZE_11654_ADDR).toBe(0x00011654);
  });
});

// ─── rw helper for 16-bit read (non-negative) ─────────────────────────────────

describe("finalize11654 — counter boundary: value at word 0x4003EA", () => {
  it("counter=0x4003ea word is read as unsigned 16-bit (0xFFFF treated as -1)", () => {
    const s = emptyGameState();
    setW(s, 0x00400392, 0);
    setW(s, 0x004003ea, 0xffff);
    expect(rw(s, 0x004003ea)).toBe(0xffff);
    const calls: Call[] = [];
    finalize11654(s, undefined, makeLoggedSubs(calls));
    // path A (counter == 0xffff)
    expect(rb(s, 0x004003ee)).toBe(2);
  });
});
