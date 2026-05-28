/**
 * state-sub-5284.test.ts — corner cases di stateSub5284 (FUN_5284).
 *
 * Bit-perfect parity verificata vs binary in `test-state-sub-5284-parity.ts`.
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
  it("ritorna 0 quando entrambi i long-BE flags sono zero", () => {
    const s = emptyGameState();
    expect(fun52A2(s)).toBe(0);
  });

  it("ritorna 1 quando il primary flag (0x401F5E) ha un bit set", () => {
    const s = emptyGameState();
    s.workRam[0x1f5e] = 0x00;
    s.workRam[0x1f5f] = 0x00;
    s.workRam[0x1f60] = 0x00;
    s.workRam[0x1f61] = 0x01; // 0x00000001 long-BE
    expect(fun52A2(s)).toBe(1);
  });

  it("ritorna 1 quando il secondary flag (0x401F76) ha un bit set (anche solo MSB)", () => {
    const s = emptyGameState();
    s.workRam[0x1f76] = 0x80; // 0x80000000 long-BE
    s.workRam[0x1f77] = 0x00;
    s.workRam[0x1f78] = 0x00;
    s.workRam[0x1f79] = 0x00;
    expect(fun52A2(s)).toBe(1);
  });

  it("ritorna 1 con tutti e due i long set su byte sparsi", () => {
    const s = emptyGameState();
    s.workRam[0x1f5e] = 0x12;
    s.workRam[0x1f76] = 0x34;
    expect(fun52A2(s)).toBe(1);
  });

  it("export ADDR costanti coerenti", () => {
    expect(PRIMARY_FLAGS_ADDR).toBe(0x00401f5e);
    expect(SECONDARY_FLAGS_ADDR).toBe(0x00401f76);
  });
});

describe("stateSub5284 (FUN_5284)", () => {
  it("flags=0 entry → 1 iter, flagsCleared=true, default fun_4dcc incrementa 0x401FF8", () => {
    const s = emptyGameState();
    // counter @ 0x401FF8 inizializzato a 0
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

  it("default fun_4dcc: counter parte da 0xFFFFFFFE → wrap mod 2^32 a 0xFFFFFFFF", () => {
    const s = emptyGameState();
    // counter pre = 0xFFFFFFFE, +1 = 0xFFFFFFFF (no wrap a 0).
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

  it("fun_4f38 callback chiamato esattamente una volta quando flags=0", () => {
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

  it("flags=non-zero entry, no irq, maxIter=1 → flagsCleared=false, fun_4f38 NON chiamato", () => {
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
    expect(r.iterations).toBe(1); // 1 body iter, poi check fallisce
    expect(r.flagsCleared).toBe(false);
    expect(f4f38Calls).toBe(0);
    expect(dccCalls).toBe(1);
    // Primary flag unchanged; FUN_5284 does not write flags.
    expect(s.workRam[0x1f5e]).toBe(0x01);
  });

  it("irq hook azzera i flags dopo 3 iter → loop esce con flagsCleared=true", () => {
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

  it("maxIter=0 viene clampato a 1 (loop body precede sempre il check)", () => {
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

  it("ordine: fun_4dcc → irq → fun52A2 (verificato via callback log)", () => {
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
