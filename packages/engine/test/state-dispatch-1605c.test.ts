/**
 * state-dispatch-1605c.test.ts — smoke per FUN_1605C.
 *
 * Bit-perfect verified against the binary through
 * `cli/src/test-state-dispatch-1605c-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  stateDispatch1605C,
  KIND_BYTE_OFF,
  KIND_CASE_20,
  KIND_CASE_21,
  KIND_CASE_22,
} from "../src/state-dispatch-1605c.js";
import type { StateDispatch1605CSubs } from "../src/state-dispatch-1605c.js";
import { emptyGameState } from "../src/state.js";

describe("stateDispatch1605C (FUN_1605C)", () => {
  it("kind == 0x20 → chiama fun_160ae(structPtr, 0); fun_15c46 NON chiamato", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;
    s.workRam[(structPtr - 0x400000) + KIND_BYTE_OFF] = KIND_CASE_20;

    let f160ae: { ptr: number; idx: number } | null = null;
    let f15c46Calls = 0;
    const subs: StateDispatch1605CSubs = {
      fun_15c46: (ptr) => {
        f15c46Calls++;
        return ptr; // valore arbitrario (non deve essere usato in questo branch)
      },
      fun_160ae: (ptr, idx) => {
        f160ae = { ptr, idx };
      },
    };

    stateDispatch1605C(s, structPtr, subs);

    expect(f160ae).not.toBeNull();
    expect(f160ae!.ptr).toBe(structPtr);
    expect(f160ae!.idx).toBe(0);
    expect(f15c46Calls).toBe(0);
  });

  it("kind == 0x22 → chiama fun_15c46 poi fun_160ae con il suo return", () => {
    const s = emptyGameState();
    const structPtr = 0x00400600;
    s.workRam[(structPtr - 0x400000) + KIND_BYTE_OFF] = KIND_CASE_22;

    const seq: string[] = [];
    let f160aeArgs: { ptr: number; idx: number } | null = null;
    const subs: StateDispatch1605CSubs = {
      fun_15c46: (ptr) => {
        seq.push("15c46");
        expect(ptr).toBe(structPtr);
        return 0xdeadbeef;
      },
      fun_160ae: (ptr, idx) => {
        seq.push("160ae");
        f160aeArgs = { ptr, idx };
      },
    };

    stateDispatch1605C(s, structPtr, subs);

    expect(seq).toEqual(["15c46", "160ae"]);
    expect(f160aeArgs).not.toBeNull();
    expect(f160aeArgs!.ptr).toBe(structPtr);
    // ret di fun_15c46 (long) propagato direttamente a fun_160ae.
    expect(f160aeArgs!.idx).toBe(0xdeadbeef);
  });

  it("kind == 0x21 → no-op esplicito (nessuna sub chiamata)", () => {
    const s = emptyGameState();
    const structPtr = 0x00400700;
    s.workRam[(structPtr - 0x400000) + KIND_BYTE_OFF] = KIND_CASE_21;

    let f15c46Calls = 0;
    let f160aeCalls = 0;
    stateDispatch1605C(s, structPtr, {
      fun_15c46: () => {
        f15c46Calls++;
        return 0;
      },
      fun_160ae: () => {
        f160aeCalls++;
      },
    });

    expect(f15c46Calls).toBe(0);
    expect(f160aeCalls).toBe(0);
  });

  it("kind in [0x00..0x1F] (signed >= 0 ma < 0x20) → no-op", () => {
    const s = emptyGameState();
    const structPtr = 0x00400800;

    for (const kind of [0x00, 0x01, 0x10, 0x1f]) {
      s.workRam[(structPtr - 0x400000) + KIND_BYTE_OFF] = kind;
      let calls = 0;
      stateDispatch1605C(s, structPtr, {
        fun_15c46: () => { calls++; return 0; },
        fun_160ae: () => { calls++; },
      });
      expect(calls, `kind=0x${kind.toString(16)}`).toBe(0);
    }
  });

  it("kind in [0x80..0xFF] (signed negativo via ext.l) → no-op (blt branch)", () => {
    const s = emptyGameState();
    const structPtr = 0x00400900;

    for (const kind of [0x80, 0x9a, 0xff]) {
      s.workRam[(structPtr - 0x400000) + KIND_BYTE_OFF] = kind;
      let calls = 0;
      stateDispatch1605C(s, structPtr, {
        fun_15c46: () => { calls++; return 0; },
        fun_160ae: () => { calls++; },
      });
      expect(calls, `kind=0x${kind.toString(16)}`).toBe(0);
    }
  });

  it("kind in [0x23..0x7F] → no-op (cmpa fall-through)", () => {
    const s = emptyGameState();
    const structPtr = 0x00400a00;

    for (const kind of [0x23, 0x40, 0x7f]) {
      s.workRam[(structPtr - 0x400000) + KIND_BYTE_OFF] = kind;
      let calls = 0;
      stateDispatch1605C(s, structPtr, {
        fun_15c46: () => { calls++; return 0; },
        fun_160ae: () => { calls++; },
      });
      expect(calls, `kind=0x${kind.toString(16)}`).toBe(0);
    }
  });

  it("subs undefined → non-throw e no side effects", () => {
    const s = emptyGameState();
    const structPtr = 0x00400b00;
    s.workRam[(structPtr - 0x400000) + KIND_BYTE_OFF] = KIND_CASE_22;
    expect(() => stateDispatch1605C(s, structPtr)).not.toThrow();
  });

  it("subs.fun_15c46 undefined ma kind == 0x22 → fun_160ae chiamato con 0", () => {
    const s = emptyGameState();
    const structPtr = 0x00400c00;
    s.workRam[(structPtr - 0x400000) + KIND_BYTE_OFF] = KIND_CASE_22;

    let f160ae: { ptr: number; idx: number } | null = null;
    stateDispatch1605C(s, structPtr, {
      fun_160ae: (ptr, idx) => { f160ae = { ptr, idx }; },
    });
    expect(f160ae).not.toBeNull();
    expect(f160ae!.ptr).toBe(structPtr);
    expect(f160ae!.idx).toBe(0); // default fun_15c46 → 0
  });
});
