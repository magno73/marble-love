/**
 * state-sub-5584.test.ts — smoke test per stateSub5584 (FUN_5584).
 *
 */

import { describe, it, expect } from "vitest";
import { stateSub5584 } from "../src/state-sub-5584.js";
import { emptyGameState } from "../src/state.js";

interface Call540A {
  a2: number;
  d3w: number;
}
interface Call5468 {
  a2: number;
  d3w: number;
  d2w: number;
  arg3w: number;
  arg4w: number;
}

describe("stateSub5584 (FUN_5584) — smoke", () => {
  it("early-exit: 53EA dopo 540A returns 0 → return 0, no chiamata a 5468", () => {
    const s = emptyGameState();
    const calls540A: Call540A[] = [];
    const calls53EA: number[] = [];
    const calls5468: Call5468[] = [];

    const ret = stateSub5584(
      s,
      0x401234, // arg0
      0x0001,   // arg1w
      0x0008,   // arg2w
      0x0001,   // arg3w
      0xabcd,   // arg4w
      (_st, a2, d3w) => {
        calls540A.push({ a2, d3w });
        return 0x401500; // walked ptr
      },
      (_st, ptr) => {
        calls53EA.push(ptr);
        return 0; // pair = 0 → early-exit
      },
      (_st, a2, d3w, d2w, arg3w, arg4w) => {
        calls5468.push({ a2, d3w, d2w, arg3w, arg4w });
        return 0;
      },
    );

    expect(ret).toBe(0);
    expect(calls540A).toEqual([{ a2: 0x401234, d3w: 0x0008 }]);
    expect(calls53EA).toEqual([0x401500]);
    expect(calls5468).toEqual([]);
  });

  it("loop completo (5 iter) senza match: D4 = 3,6,9,12,15; D2 always != D5", () => {
    const s = emptyGameState();
    const calls5468: Call5468[] = [];
    const calls53EA: number[] = [];

    let stepCounter = 0;
    const ret = stateSub5584(
      s,
      0x400100,
      0x0042, // arg1
      0x000a, // arg2
      0x0001, // arg3
      0x0050, // arg4
      // 540A → D5 = 0x402000 (sentinel match-target)
      () => 0x402000,
      (_st, ptr) => {
        calls53EA.push(ptr);
        return 0xff;
      },
      (_st, a2, d3w, d2w, arg3w, arg4w) => {
        calls5468.push({ a2, d3w, d2w, arg3w, arg4w });
        stepCounter++;
        return 0x401000 + stepCounter;
      },
    );

    // Esce from the loop completo. D0 = 0x12 (loop bound constant overwrite).
    expect(ret).toBe(0x12);
    // 5 iter: D4 = 3, 6, 9, 12, 15
    expect(calls5468.length).toBe(5);
    expect(calls5468.map((c) => c.d2w)).toEqual([3, 6, 9, 12, 15]);
    expect(calls5468.every((c) => c.d3w === 0x42)).toBe(true);
    expect(calls5468.every((c) => c.arg3w === 1 && c.arg4w === 0x50)).toBe(
      true,
    );
    expect(calls53EA.length).toBe(6);
  });

  it("cmp-eq exit: D2 == D5 dopo first iter → return 53EA result", () => {
    const s = emptyGameState();
    const calls5468: Call5468[] = [];

    const ret = stateSub5584(
      s,
      0x400100,
      0x00aa,
      0x0005,
      0x0001,
      0x0010,
      // 540A → 0x402000
      () => 0x402000,
      () => 0x42,
      (_st, a2, d3w, d2w, arg3w, arg4w) => {
        calls5468.push({ a2, d3w, d2w, arg3w, arg4w });
        return 0x402000;
      },
    );

    expect(ret).toBe(0x42);
    // Solo 1 iter of loop: D4 = 3.
    expect(calls5468.length).toBe(1);
    expect(calls5468[0]?.d2w).toBe(3);
    expect(calls5468[0]?.a2).toBe(0x402000);
  });

  it("D2 = D6 (restore) when 53EA loop returns 0; cmp con D5 può ancora dare exit", () => {
    const s = emptyGameState();
    const calls5468: Call5468[] = [];
    const calls53EA: number[] = [];

    const ret = stateSub5584(
      s,
      0x401111, // D6 = 0x401111
      0x0001,
      0x0003,
      0x0001,
      0x0020,
      () => 0x402222, // D5 = 0x402222 (!= D6)
      (_st, ptr) => {
        calls53EA.push(ptr);
        return ptr === 0x402222 ? 0x10 : 0;
      },
      (_st, a2, d3w, d2w, arg3w, arg4w) => {
        calls5468.push({ a2, d3w, d2w, arg3w, arg4w });
        return 0x403000 + d2w;
      },
    );

    expect(ret).toBe(0x12);
    expect(calls5468.length).toBe(5);
    expect(calls5468[0]?.a2).toBe(0x402222);
    // a2 of iter 2..5 should be D6 = 0x401111.
    expect(calls5468[1]?.a2).toBe(0x401111);
    expect(calls5468[2]?.a2).toBe(0x401111);
    expect(calls5468[3]?.a2).toBe(0x401111);
    expect(calls5468[4]?.a2).toBe(0x401111);
  });

  it("default callbacks: all a 0 → early-exit immediato, return 0", () => {
    const s = emptyGameState();
    const ret = stateSub5584(s, 0x401234, 1, 2, 1, 0xffff);
    // 540A default = 0; 53EA(0) default = 0 → early-exit.
    expect(ret).toBe(0);
  });

  it("D2 returns a D6 also dopo PRIMA iter; se D6 == D5 → cmp-eq exit", () => {
    const s = emptyGameState();
    const ret = stateSub5584(
      s,
      0x402222, // D6
      0x0001,
      0x0001,
      0x0001,
      0x0001,
      () => 0x402222, // D5 == D6
      (_st, ptr) => (ptr === 0x402222 ? 0x99 : 0), // post-540A: 0x99; post-5468: 0
      () => 0x405555, // 5468 → ptr step (qualsiasi)
    );

    // Iter 1: 5468 -> 0x405555; 53EA(0x405555) = 0 -> D2 = D6 = 0x402222. Cmp with
    // D5 = 0x402222 → eq → exit. D0 = last 53EA = 0.
    expect(ret).toBe(0);
  });

  it("propagation of arg word: all i word args are mascherati a 16 bit", () => {
    const s = emptyGameState();
    const calls540A: Call540A[] = [];
    const calls5468: Call5468[] = [];

    stateSub5584(
      s,
      0x12345678,
      0x12345, // arg1: word low = 0x2345
      0x1abcd, // arg2: word low = 0xabcd
      0x10001, // arg3: word low = 0x0001
      0x1ffff, // arg4: word low = 0xffff
      (_st, a2, d3w) => {
        calls540A.push({ a2, d3w });
        return 0x401000;
      },
      () => 0x77, // continua loop
      (_st, a2, d3w, d2w, arg3w, arg4w) => {
        calls5468.push({ a2, d3w, d2w, arg3w, arg4w });
        return 0x402000;
      },
    );

    expect(calls540A[0]?.a2).toBe(0x12345678);
    expect(calls540A[0]?.d3w).toBe(0xabcd);
    expect(calls5468[0]?.d3w).toBe(0x2345);
    expect(calls5468[0]?.arg3w).toBe(0x0001);
    expect(calls5468[0]?.arg4w).toBe(0xffff);
  });
});
