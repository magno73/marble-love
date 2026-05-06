/**
 * state-sub-15bd0.test.ts — smoke + corner case di FUN_15BD0.
 */

import { describe, it, expect } from "vitest";
import { stateSub15BD0, OBJ_BASE_ADDR, OBJ_STRIDE, OBJ_COUNT_ADDR } from "../src/state-sub-15bd0.js";
import type { StateSub15BD0Subs } from "../src/state-sub-15bd0.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x00400000;
const STRUCT_PTR_OFF = 0x100; // arg1 struct in workRam @ 0x400100
const STRUCT_PTR_ABS = WORK_RAM_BASE + STRUCT_PTR_OFF;

const OBJ_BASE_OFF = OBJ_BASE_ADDR - WORK_RAM_BASE;
const OBJ_COUNT_OFF = OBJ_COUNT_ADDR - WORK_RAM_BASE;

interface Call18F46 {
  arg1: number;
  arg2: number;
}
interface Call285B0 {
  objAddr: number;
  eventByte: number;
}

function makeRecorder(): {
  subs: StateSub15BD0Subs;
  calls18f46: Call18F46[];
  calls285b0: Call285B0[];
} {
  const calls18f46: Call18F46[] = [];
  const calls285b0: Call285B0[] = [];
  return {
    calls18f46,
    calls285b0,
    subs: {
      fun_18f46: (a1, a2) => {
        calls18f46.push({ arg1: a1 >>> 0, arg2: a2 >>> 0 });
      },
      fun_285b0: (oa, eb) => {
        calls285b0.push({ objAddr: oa >>> 0, eventByte: eb >>> 0 });
      },
    },
  };
}

describe("stateSub15BD0 (FUN_15BD0)", () => {
  it("no-op completo se arg2.b == 0 && arg3.b == 0", () => {
    const s = emptyGameState();
    // Sporca byte struct+0x18 per verificare invarianza.
    s.workRam[STRUCT_PTR_OFF + 0x18] = 0xaa;
    // Setup count word > 0 e qualche obj con state attivo.
    s.workRam[OBJ_COUNT_OFF] = 0;
    s.workRam[OBJ_COUNT_OFF + 1] = 5;
    s.workRam[(OBJ_BASE_ADDR - WORK_RAM_BASE) + 0x18] = 1; // obj0 state=1

    const r = makeRecorder();
    stateSub15BD0(s, STRUCT_PTR_ABS, 0xffffff00, 0xaaaaaa00, r.subs);

    // Block A skipped → struct+0x18 invariato.
    expect(s.workRam[STRUCT_PTR_OFF + 0x18]).toBe(0xaa);
    // Nessuna chiamata.
    expect(r.calls18f46).toHaveLength(0);
    expect(r.calls285b0).toHaveLength(0);
  });

  it("Block A only: arg3.b != 0 azzera struct+0x18 e chiama fun_18f46(2, sext_l(byte19))", () => {
    const s = emptyGameState();
    s.workRam[STRUCT_PTR_OFF + 0x18] = 0xaa;
    s.workRam[STRUCT_PTR_OFF + 0x19] = 0xff; // signed -1 → sext_l → 0xFFFFFFFF
    // arg2.b == 0 → Block B skipped
    const r = makeRecorder();
    stateSub15BD0(s, STRUCT_PTR_ABS, 0x00000000, 0x12345601, r.subs);

    expect(s.workRam[STRUCT_PTR_OFF + 0x18]).toBe(0);
    expect(r.calls18f46).toHaveLength(1);
    expect(r.calls18f46[0]?.arg1).toBe(2);
    expect(r.calls18f46[0]?.arg2 >>> 0).toBe(0xffffffff);
    expect(r.calls285b0).toHaveLength(0);
  });

  it("Block A: byte19 positivo (sign-extension non muta valore)", () => {
    const s = emptyGameState();
    s.workRam[STRUCT_PTR_OFF + 0x19] = 0x42;
    const r = makeRecorder();
    stateSub15BD0(s, STRUCT_PTR_ABS, 0, 0x01, r.subs);
    expect(r.calls18f46).toHaveLength(1);
    expect(r.calls18f46[0]?.arg2).toBe(0x42);
  });

  it("Block B only: arg2.b != 0 itera *0x400396 obj e chiama fun_285b0 dove state ∉ {0,2}", () => {
    const s = emptyGameState();
    // count word = 4
    s.workRam[OBJ_COUNT_OFF] = 0;
    s.workRam[OBJ_COUNT_OFF + 1] = 4;
    // obj0 state = 1 (call), obj1 = 0 (skip), obj2 = 2 (skip), obj3 = 5 (call)
    s.workRam[(OBJ_BASE_ADDR - WORK_RAM_BASE) + 0 * OBJ_STRIDE + 0x18] = 1;
    s.workRam[(OBJ_BASE_ADDR - WORK_RAM_BASE) + 1 * OBJ_STRIDE + 0x18] = 0;
    s.workRam[(OBJ_BASE_ADDR - WORK_RAM_BASE) + 2 * OBJ_STRIDE + 0x18] = 2;
    s.workRam[(OBJ_BASE_ADDR - WORK_RAM_BASE) + 3 * OBJ_STRIDE + 0x18] = 5;

    const r = makeRecorder();
    stateSub15BD0(s, STRUCT_PTR_ABS, 0x01, 0x00, r.subs);

    // Solo i 2 obj con state ∉ {0,2}
    expect(r.calls285b0).toHaveLength(2);
    expect(r.calls285b0[0]?.objAddr).toBe(OBJ_BASE_ADDR + 0 * OBJ_STRIDE);
    expect(r.calls285b0[0]?.eventByte).toBe(3);
    expect(r.calls285b0[1]?.objAddr).toBe(OBJ_BASE_ADDR + 3 * OBJ_STRIDE);
    expect(r.calls285b0[1]?.eventByte).toBe(3);
    expect(r.calls18f46).toHaveLength(0);
  });

  it("Block B: count == 0 → loop body mai eseguito", () => {
    const s = emptyGameState();
    s.workRam[OBJ_COUNT_OFF] = 0;
    s.workRam[OBJ_COUNT_OFF + 1] = 0;
    // Obj0 con state attivo: dovrebbe essere ignorato perché count=0.
    s.workRam[(OBJ_BASE_ADDR - WORK_RAM_BASE) + 0x18] = 1;

    const r = makeRecorder();
    stateSub15BD0(s, STRUCT_PTR_ABS, 0x01, 0x00, r.subs);
    expect(r.calls285b0).toHaveLength(0);
  });

  it("Entrambi i block: arg2.b != 0 && arg3.b != 0 → A poi B in sequenza", () => {
    const s = emptyGameState();
    s.workRam[STRUCT_PTR_OFF + 0x18] = 0x99;
    s.workRam[STRUCT_PTR_OFF + 0x19] = 0x07;
    s.workRam[OBJ_COUNT_OFF] = 0;
    s.workRam[OBJ_COUNT_OFF + 1] = 1;
    s.workRam[(OBJ_BASE_ADDR - WORK_RAM_BASE) + 0x18] = 1;

    const callOrder: string[] = [];
    const subs: StateSub15BD0Subs = {
      fun_18f46: () => callOrder.push("18f46"),
      fun_285b0: () => callOrder.push("285b0"),
    };
    stateSub15BD0(s, STRUCT_PTR_ABS, 0xff, 0xff, subs);
    expect(callOrder).toEqual(["18f46", "285b0"]);
    expect(s.workRam[STRUCT_PTR_OFF + 0x18]).toBe(0); // cleared by Block A
  });

  it("usa solo low byte di arg2 / arg3 (top 24 bit ignorati)", () => {
    const s = emptyGameState();
    s.workRam[STRUCT_PTR_OFF + 0x18] = 0x77;
    s.workRam[OBJ_COUNT_OFF] = 0;
    s.workRam[OBJ_COUNT_OFF + 1] = 1;
    s.workRam[(OBJ_BASE_ADDR - WORK_RAM_BASE) + 0x18] = 3;

    const r = makeRecorder();
    // arg2 = 0xFFFFFF00 → low byte 0 → Block B skipped
    // arg3 = 0xAAAAAA00 → low byte 0 → Block A skipped
    stateSub15BD0(s, STRUCT_PTR_ABS, 0xffffff00, 0xaaaaaa00, r.subs);
    expect(s.workRam[STRUCT_PTR_OFF + 0x18]).toBe(0x77); // not cleared
    expect(r.calls18f46).toHaveLength(0);
    expect(r.calls285b0).toHaveLength(0);

    // arg2 = 0x00000001 → low byte 1 → Block B exec
    // arg3 = 0xFFFFFF00 → low byte 0 → Block A skipped
    stateSub15BD0(s, STRUCT_PTR_ABS, 0x00000001, 0xffffff00, r.subs);
    expect(s.workRam[STRUCT_PTR_OFF + 0x18]).toBe(0x77); // not cleared
    expect(r.calls18f46).toHaveLength(0);
    expect(r.calls285b0).toHaveLength(1);
  });

  it("default subs (omessi): no-op ma side-effect Block A su workRam still applied", () => {
    const s = emptyGameState();
    s.workRam[STRUCT_PTR_OFF + 0x18] = 0xaa;
    s.workRam[STRUCT_PTR_OFF + 0x19] = 0x55;
    // No subs argument → fun_18f46/285b0 default no-op.
    expect(() => stateSub15BD0(s, STRUCT_PTR_ABS, 0, 0xff)).not.toThrow();
    expect(s.workRam[STRUCT_PTR_OFF + 0x18]).toBe(0); // cleared
  });
});
