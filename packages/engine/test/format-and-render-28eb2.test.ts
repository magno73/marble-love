/**
 * format-and-render-28eb2.test.ts — smoke per FUN_28EB2.
 *
 * Bit-perfect verificato vs binary tramite
 * `cli/src/test-format-and-render-28eb2-parity.ts` (500/500).
 *
 * Smoke locali: verificano dispatch ordinato delle 3 sub, condizione del
 * trim path (arg2.w==2), e propagazione args sign-extended.
 */

import { describe, it, expect } from "vitest";
import {
  formatAndRender28EB2,
  FormatAndRender28EB2Subs,
  FMT_MODE_D,
  TRIM_SELECTOR,
  BUFEND_PTR_OFF,
  FUN_28EB2_SUB_ADDRS,
} from "../src/format-and-render-28eb2.js";
import { emptyGameState } from "../src/state.js";

interface CallLog {
  name: "fmt" | "trim" | "render";
  args: number[];
}

function makeRecorder(log: CallLog[]): FormatAndRender28EB2Subs {
  return {
    numberFormatter: (_s, value, bufEnd, fmtMode, width, fillExtra) =>
      log.push({ name: "fmt", args: [value, bufEnd, fmtMode, width, fillExtra] }),
    trimTrailingSpace: (_s, strPtr, maxLen) =>
      log.push({ name: "trim", args: [strPtr, maxLen] }),
    renderStringEntry: (_s, a1, a2, a3) =>
      log.push({ name: "render", args: [a1, a2, a3] }),
  };
}

describe("formatAndRender28EB2 (FUN_28EB2)", () => {
  it("invoca le 3 sub nell'ordine fmt → render quando arg2.w != 2 (skip trim)", () => {
    const s = emptyGameState();
    // Pre-fill *(0x40041E) come long BE = 0x00400500 (arbitrary buf).
    s.workRam[BUFEND_PTR_OFF + 0] = 0x00;
    s.workRam[BUFEND_PTR_OFF + 1] = 0x40;
    s.workRam[BUFEND_PTR_OFF + 2] = 0x05;
    s.workRam[BUFEND_PTR_OFF + 3] = 0x00;

    const log: CallLog[] = [];
    formatAndRender28EB2(
      s,
      0x12345678, // arg1 value
      0x00010001, // arg2: low word = 1 → skip trim
      0x000a000b, // arg3: low word = 0xb → col
      0x000c000d, // arg4: low word = 0xd → tickOff
      0x000e000f, // arg5: low word = 0xf → fill / maxLen
      0x00100011, // arg6: low word = 0x11 → render
      makeRecorder(log),
    );

    expect(log).toHaveLength(2);
    expect(log[0]!.name).toBe("fmt");
    expect(log[1]!.name).toBe("render");

    // FUN_3874 args: (value, bufEnd, fmtMode=0x64, ext_l(arg2.w), ext_l(arg5.w))
    expect(log[0]!.args[0]).toBe(0x12345678);   // value
    expect(log[0]!.args[1]).toBe(0x00400500);   // bufEnd from *(0x40041E)
    expect(log[0]!.args[2]).toBe(FMT_MODE_D);   // 0x64
    expect(log[0]!.args[3]).toBe(0x00000001);   // ext_l(0x0001)
    expect(log[0]!.args[4]).toBe(0x0000000f);   // ext_l(0x000f)

    // FUN_28FA0 args: (ext_l(arg3.w), ext_l(arg4.w), ext_l(arg6.w))
    expect(log[1]!.args[0]).toBe(0x0000000b);   // col
    expect(log[1]!.args[1]).toBe(0x0000000d);   // tickOff
    expect(log[1]!.args[2]).toBe(0x00000011);   // render arg
  });

  it("attiva il trim path quando arg2.w == 2 → ordine fmt → trim → render", () => {
    const s = emptyGameState();
    // *(0x40041E) = 0x00401000
    s.workRam[BUFEND_PTR_OFF + 0] = 0x00;
    s.workRam[BUFEND_PTR_OFF + 1] = 0x40;
    s.workRam[BUFEND_PTR_OFF + 2] = 0x10;
    s.workRam[BUFEND_PTR_OFF + 3] = 0x00;

    const log: CallLog[] = [];
    formatAndRender28EB2(
      s,
      0x42,                            // arg1 value
      0xdead0000 | TRIM_SELECTOR,      // arg2: low word == 2 → trim
      0x05,                            // arg3
      0x07,                            // arg4
      0x000000aa,                      // arg5
      0x000000bb,                      // arg6
      makeRecorder(log),
    );

    expect(log).toHaveLength(3);
    expect(log[0]!.name).toBe("fmt");
    expect(log[1]!.name).toBe("trim");
    expect(log[2]!.name).toBe("render");

    // trim args: (*(0x40041E), ext_l(arg5.w))
    expect(log[1]!.args[0]).toBe(0x00401000);
    expect(log[1]!.args[1]).toBe(0x000000aa);

    // FUN_3874 width = ext_l(arg2.w) = 2 (low word di arg2 == 2)
    expect(log[0]!.args[3]).toBe(0x00000002);
  });

  it("propaga sign-extension corretto su low word negative (bit15=1)", () => {
    const s = emptyGameState();
    const log: CallLog[] = [];

    // arg2.w = 0x8000 → ext_l = 0xFFFF8000 (negativo, ma != 2 → skip trim)
    // arg3.w = 0xFFFF → ext_l = 0xFFFFFFFF
    // arg5.w = 0x7FFF → ext_l = 0x00007FFF (positivo)
    formatAndRender28EB2(
      s,
      0,
      0x12348000, // arg2.w = 0x8000
      0xdeadffff, // arg3.w = 0xFFFF
      0x12340000, // arg4.w = 0
      0xbeef7fff, // arg5.w = 0x7FFF
      0x12348000, // arg6.w = 0x8000
      makeRecorder(log),
    );

    expect(log).toHaveLength(2);
    // FUN_3874 width = ext_l(0x8000) = 0xFFFF8000
    expect(log[0]!.args[3]).toBe(0xffff8000);
    // FUN_3874 fillExtra = ext_l(0x7FFF) = 0x00007FFF
    expect(log[0]!.args[4]).toBe(0x00007fff);
    // FUN_28FA0 col = ext_l(0xFFFF) = 0xFFFFFFFF
    expect(log[1]!.args[0]).toBe(0xffffffff);
    // FUN_28FA0 tickOff = ext_l(0) = 0
    expect(log[1]!.args[1]).toBe(0);
    // FUN_28FA0 renderArg = ext_l(0x8000) = 0xFFFF8000
    expect(log[1]!.args[2]).toBe(0xffff8000);
  });

  it("subs undefined → no-op completo, nessun crash", () => {
    const s = emptyGameState();
    expect(() => {
      formatAndRender28EB2(s, 0, 2, 0, 0, 0, 0);
    }).not.toThrow();
  });

  it("arg2.w == 2 attiva trim solo per low word esatta = 2 (high word ignored)", () => {
    const s = emptyGameState();
    // alta word arbitraria, low word = 2.
    const cases = [
      { arg2: 0x00000002, expectTrim: true },
      { arg2: 0xffff0002, expectTrim: true },
      { arg2: 0x00010002, expectTrim: true },
      { arg2: 0x00000012, expectTrim: false }, // 0x12 != 2
      { arg2: 0x00000003, expectTrim: false },
      { arg2: 0x00020002, expectTrim: true }, // low word still == 2
    ];

    for (const tc of cases) {
      const log: CallLog[] = [];
      formatAndRender28EB2(s, 0, tc.arg2, 0, 0, 0, 0, makeRecorder(log));
      const hasTrim = log.some((c) => c.name === "trim");
      expect(hasTrim).toBe(tc.expectTrim);
    }
  });

  it("legge bufEnd come long BIG-ENDIAN da workRam[0x41E..0x421]", () => {
    const s = emptyGameState();
    // BE pattern: bytes [0xCA, 0xFE, 0xBA, 0xBE] → long 0xCAFEBABE
    s.workRam[BUFEND_PTR_OFF + 0] = 0xca;
    s.workRam[BUFEND_PTR_OFF + 1] = 0xfe;
    s.workRam[BUFEND_PTR_OFF + 2] = 0xba;
    s.workRam[BUFEND_PTR_OFF + 3] = 0xbe;

    const log: CallLog[] = [];
    formatAndRender28EB2(s, 0x42, 0, 0, 0, 0, 0, makeRecorder(log));
    expect(log[0]!.args[1]).toBe(0xcafebabe);
  });

  it("FUN_28EB2_SUB_ADDRS contiene 3874, 28F28, 28FA0 nell'ordine", () => {
    expect(FUN_28EB2_SUB_ADDRS).toEqual([0x00003874, 0x00028f28, 0x00028fa0]);
  });
});
