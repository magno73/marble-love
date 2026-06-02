/**
 * state-sub-5284.test.ts — corner cases of stateSub5284 (FUN_5284).
 *
 * Bit-perfect parity verified vs binary in `test-state-sub-5284-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  stateSub5284,
  fun52A2,
  PRIMARY_FLAGS_ADDR,
  SECONDARY_FLAGS_ADDR,
  DELAY_LOOP_SEED,
} from "../src/state-sub-5284.js";
import { emptyGameState } from "../src/state.js";

describe("fun52A2 (FUN_52A2 helper)", () => {
  it("returns 0 when both long-BE flags are zero", () => {
    const s = emptyGameState();
    expect(fun52A2(s)).toBe(0);
  });

  it("returns 1 when the primary flag (0x401F5E) has a bit set", () => {
    const s = emptyGameState();
    s.workRam[0x1f5e] = 0x00;
    s.workRam[0x1f5f] = 0x00;
    s.workRam[0x1f60] = 0x00;
    s.workRam[0x1f61] = 0x01; // 0x00000001 long-BE
    expect(fun52A2(s)).toBe(1);
  });

  it("returns 1 when the secondary flag (0x401F76) has a bit set (even just the MSB)", () => {
    const s = emptyGameState();
    s.workRam[0x1f76] = 0x80; // 0x80000000 long-BE
    s.workRam[0x1f77] = 0x00;
    s.workRam[0x1f78] = 0x00;
    s.workRam[0x1f79] = 0x00;
    expect(fun52A2(s)).toBe(1);
  });

  it("returns 1 with both longs set on scattered bytes", () => {
    const s = emptyGameState();
    s.workRam[0x1f5e] = 0x12;
    s.workRam[0x1f76] = 0x34;
    expect(fun52A2(s)).toBe(1);
  });

  it("exported ADDR constants consistent", () => {
    expect(PRIMARY_FLAGS_ADDR).toBe(0x00401f5e);
    expect(SECONDARY_FLAGS_ADDR).toBe(0x00401f76);
  });
});

describe("stateSub5284 (FUN_5284)", () => {
  it("flags=0 entry → 1 iter, flagsCleared=true, default fun_4dcc increments 0x401FF8", () => {
    const s = emptyGameState();
    // counter @ 0x401FF8 initialized to 0
    const r = stateSub5284(s);
    expect(r.iterations).toBe(1);
    expect(r.flagsCleared).toBe(true);
    // long-BE @ 0x1FF8 = 1
    const cnt =
      ((s.workRam[0x1ff8] ?? 0) << 24) |
      ((s.workRam[0x1ff9] ?? 0) << 16) |
      ((s.workRam[0x1ffa] ?? 0) << 8) |
      (s.workRam[0x1ffb] ?? 0);
    expect(cnt >>> 0).toBe(1);
  });

  it("default fun_4dcc: counter starts at 0xFFFFFFFE → wrap mod 2^32 to 0xFFFFFFFF", () => {
    const s = emptyGameState();
    // counter pre = 0xFFFFFFFE, +1 = 0xFFFFFFFF (no wrap to 0).
    s.workRam[0x1ff8] = 0xff;
    s.workRam[0x1ff9] = 0xff;
    s.workRam[0x1ffa] = 0xff;
    s.workRam[0x1ffb] = 0xfe;
    const r = stateSub5284(s);
    expect(r.flagsCleared).toBe(true);
    expect(s.workRam[0x1ff8]).toBe(0xff);
    expect(s.workRam[0x1ff9]).toBe(0xff);
    expect(s.workRam[0x1ffa]).toBe(0xff);
    expect(s.workRam[0x1ffb]).toBe(0xff);
  });

  it("fun_4f38 callback called exactly once when flags=0", () => {
    const s = emptyGameState();
    let calls = 0;
    let stateSeen: object | null = null;
    const r = stateSub5284(s, {
      fun_4f38: (st) => {
        calls += 1;
        stateSeen = st;
      },
    });
    expect(r.flagsCleared).toBe(true);
    expect(calls).toBe(1);
    expect(stateSeen).toBe(s);
  });

  it("flags=non-zero entry, no irq, maxIter=1 → flagsCleared=false, fun_4f38 NOT called", () => {
    const s = emptyGameState();
    s.workRam[0x1f5e] = 0x01; // primary flag set
    let f4f38Calls = 0;
    let dccCalls = 0;
    const r = stateSub5284(
      s,
      {
        fun_4dcc: () => {
          dccCalls += 1;
        },
        fun_4f38: () => {
          f4f38Calls += 1;
        },
      },
      1,
    );
    expect(r.iterations).toBe(1); // 1 body iter, then check fails
    expect(r.flagsCleared).toBe(false);
    expect(f4f38Calls).toBe(0);
    expect(dccCalls).toBe(1);
    // Primary flag unchanged; FUN_5284 does not write flags.
    expect(s.workRam[0x1f5e]).toBe(0x01);
  });

  it("irq hook clears the flags after 3 iter → loop exits with flagsCleared=true", () => {
    const s = emptyGameState();
    s.workRam[0x1f76] = 0x55; // secondary flag set entry
    let dccCalls = 0;
    const r = stateSub5284(
      s,
      {
        fun_4dcc: () => {
          dccCalls += 1;
        },
        irq: (st, iter) => {
          // Clears at the 3rd IRQ tick (iter==2, 0-based).
          if (iter === 2) {
            st.workRam[0x1f76] = 0x00;
          }
        },
      },
      10,
    );
    expect(r.iterations).toBe(3);
    expect(r.flagsCleared).toBe(true);
    expect(dccCalls).toBe(3);
  });

  it("maxIter=0 is clamped to 1 (loop body always precedes the check)", () => {
    const s = emptyGameState();
    s.workRam[0x1f5e] = 0xff; // flag set
    const r = stateSub5284(s, undefined, 0);
    expect(r.iterations).toBe(1);
    expect(r.flagsCleared).toBe(false);
  });

  it("DELAY_LOOP_SEED export = 0x1A0A (6666 decimal)", () => {
    expect(DELAY_LOOP_SEED).toBe(0x1a0a);
    expect(DELAY_LOOP_SEED).toBe(6666);
  });

  it("order: fun_4dcc → irq → fun52A2 (verified via callback log)", () => {
    const s = emptyGameState();
    const log: string[] = [];
    stateSub5284(
      s,
      {
        fun_4dcc: () => {
          log.push("4dcc");
        },
        irq: () => {
          log.push("irq");
        },
        fun_4f38: () => {
          log.push("4f38");
        },
      },
      1,
    );
    expect(log).toEqual(["4dcc", "irq", "4f38"]);
  });
});
