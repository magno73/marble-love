/**
 *
 */

import { describe, it, expect } from "vitest";
import {
  array9ClearAndDispatch,
  ARRAY_BASE,
  ARRAY_STRIDE,
  ARRAY_COUNT,
  FLAG_OFFSET,
  FIELD_19_OFFSET,
  FIELD_25_OFFSET,
} from "../src/array-9-clear-and-dispatch.js";
import { emptyGameState } from "../src/state.js";

describe("array9ClearAndDispatch (FUN_190EE)", () => {
  it("invoca la callback 9 times coi pointer entry deterministici and azzera il flag 0x18 of ognuno", () => {
    const s = emptyGameState();
    for (let i = 0; i < ARRAY_COUNT; i++) {
      const off = (ARRAY_BASE - 0x400000) + i * ARRAY_STRIDE;
      s.workRam[off + FLAG_OFFSET] = 0xff;
      s.workRam[off + FIELD_19_OFFSET] = 0x10 + i; // 0x10..0x18
      s.workRam[off + FIELD_25_OFFSET] = 0x20 + i; // 0x20..0x28
    }
    const calls: Array<{ a1: number; a2: number }> = [];
    array9ClearAndDispatch(s, {
      fun_18f46: (a1, a2) => {
        calls.push({ a1, a2 });
      },
    });

    expect(calls).toHaveLength(ARRAY_COUNT);
    // arg1 = sign-ext of entry[0x25], arg2 = sign-ext of entry[0x19]
    for (let i = 0; i < ARRAY_COUNT; i++) {
      expect(calls[i]!.a1).toBe(0x20 + i);
      expect(calls[i]!.a2).toBe(0x10 + i);
    }
    for (let i = 0; i < ARRAY_COUNT; i++) {
      const off = (ARRAY_BASE - 0x400000) + i * ARRAY_STRIDE;
      expect(s.workRam[off + FLAG_OFFSET]).toBe(0);
      expect(s.workRam[off + FIELD_19_OFFSET]).toBe(0x10 + i);
      expect(s.workRam[off + FIELD_25_OFFSET]).toBe(0x20 + i);
    }
    expect(ARRAY_BASE).toBe(0x00401890);
    expect(ARRAY_STRIDE).toBe(0x28);
    expect(ARRAY_COUNT).toBe(9);
  });

  it("senza subs azzera comunque all i flag 0x18 (clear is incondizionato)", () => {
    const s = emptyGameState();
    for (let i = 0; i < ARRAY_COUNT; i++) {
      const off = (ARRAY_BASE - 0x400000) + i * ARRAY_STRIDE;
      s.workRam[off + FLAG_OFFSET] = 0xab;
      // Marker that must not change.
      s.workRam[off + 0x00] = 0x55 ^ i;
      s.workRam[off + 0x27] = 0xcc ^ i;
    }
    expect(() => array9ClearAndDispatch(s)).not.toThrow();
    expect(() => array9ClearAndDispatch(s, {})).not.toThrow();
    expect(() => array9ClearAndDispatch(s, { fun_18f46: undefined })).not.toThrow();
    for (let i = 0; i < ARRAY_COUNT; i++) {
      const off = (ARRAY_BASE - 0x400000) + i * ARRAY_STRIDE;
      expect(s.workRam[off + FLAG_OFFSET]).toBe(0);
      expect(s.workRam[off + 0x00]).toBe(0x55 ^ i);
      expect(s.workRam[off + 0x27]).toBe(0xcc ^ i);
    }
  });

  it("sign-extend of the byte 0x19/0x25 is applicato (0xFF → 0xFFFFFFFF, 0x80 → 0xFFFFFF80, 0x7F → 0x7F)", () => {
    const s = emptyGameState();
    // Setup mirato:
    //   entry 0: 0x19=0xFF, 0x25=0x80   → arg2=0xFFFFFFFF, arg1=0xFFFFFF80
    //   entry 1: 0x19=0x7F, 0x25=0x00   → arg2=0x7F, arg1=0x00
    //   entry 2: 0x19=0x01, 0x25=0xFE   → arg2=0x01, arg1=0xFFFFFFFE
    const tests: Array<{ b19: number; b25: number; e2: number; e1: number }> = [
      { b19: 0xff, b25: 0x80, e2: 0xffffffff, e1: 0xffffff80 },
      { b19: 0x7f, b25: 0x00, e2: 0x7f, e1: 0x00 },
      { b19: 0x01, b25: 0xfe, e2: 0x01, e1: 0xfffffffe },
    ];
    for (let i = 0; i < tests.length; i++) {
      const off = (ARRAY_BASE - 0x400000) + i * ARRAY_STRIDE;
      s.workRam[off + FIELD_19_OFFSET] = tests[i]!.b19;
      s.workRam[off + FIELD_25_OFFSET] = tests[i]!.b25;
    }
    const got: Array<{ a1: number; a2: number }> = [];
    array9ClearAndDispatch(s, {
      fun_18f46: (a1, a2) => {
        got.push({ a1, a2 });
      },
    });
    for (let i = 0; i < tests.length; i++) {
      expect(got[i]!.a2 >>> 0).toBe(tests[i]!.e2 >>> 0);
      expect(got[i]!.a1 >>> 0).toBe(tests[i]!.e1 >>> 0);
    }
  });

  it("ordine of chiamata strictly sequenziale (entry 0 → 8, no shuffle)", () => {
    const s = emptyGameState();
    for (let i = 0; i < ARRAY_COUNT; i++) {
      const off = (ARRAY_BASE - 0x400000) + i * ARRAY_STRIDE;
      // Unique marker in byte 0x19 (positive to avoid sign-extension).
      s.workRam[off + FIELD_19_OFFSET] = i + 1;
    }
    const seen: number[] = [];
    array9ClearAndDispatch(s, {
      fun_18f46: (_a1, a2) => {
        seen.push(a2);
      },
    });
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("forwarda la state instance al callback (same reference)", () => {
    const s = emptyGameState();
    let seen: ReturnType<typeof emptyGameState> | null = null;
    let count = 0;
    array9ClearAndDispatch(s, {
      fun_18f46: (_a1, _a2, state) => {
        seen = state;
        count++;
      },
    });
    expect(count).toBe(ARRAY_COUNT);
    expect(seen).toBe(s);
  });

  it("le mutazioni of the callback alle entry persistono between chiamate (clear non sovrascrive write of the callback PRECEDENTE su altre entry)", () => {
    const s = emptyGameState();
    array9ClearAndDispatch(s, {
      fun_18f46: (_a1, _a2, state) => {
        for (let i = 0; i < ARRAY_COUNT; i++) {
          const off = (ARRAY_BASE - 0x400000) + i * ARRAY_STRIDE;
          state.workRam[off + 0x05] = 0xab;
        }
      },
    });
    for (let i = 0; i < ARRAY_COUNT; i++) {
      const off = (ARRAY_BASE - 0x400000) + i * ARRAY_STRIDE;
      expect(s.workRam[off + 0x05]).toBe(0xab);
      expect(s.workRam[off + FLAG_OFFSET]).toBe(0);
    }
  });
});
