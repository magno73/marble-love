/**
 * dispatch-table-1eea0.test.ts — corner cases di `dispatchTable1EEA0`
 * (replica `FUN_00011AD8`).
 *
 * Bit-perfect parity validata vs binary in
 * `packages/cli/src/test-dispatch-table-1eea0-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  dispatchTable1EEA0,
  TABLE_BASE,
  ENTRY_STRIDE,
} from "../src/dispatch-table-1eea0.js";
import { emptyGameState } from "../src/state.js";

interface Call {
  arg1Long: number;
  arg2Long: number;
}

function makeRecorder(): { calls: Call[]; cb: (a: number, b: number) => void } {
  const calls: Call[] = [];
  return {
    calls,
    cb: (arg1Long, arg2Long) => {
      calls.push({ arg1Long: arg1Long >>> 0, arg2Long: arg2Long >>> 0 });
    },
  };
}

describe("dispatchTable1EEA0 (FUN_00011AD8)", () => {
  it("argIdx = 0 → 10 chiamate (D2.b 0..9, ptr 0x1EEA0,0x1EEA8,...,0x1EEE8)", () => {
    const s = emptyGameState();
    const rec = makeRecorder();

    dispatchTable1EEA0(s, 0, { fun_428e: rec.cb });

    expect(rec.calls).toHaveLength(10);
    for (let k = 0; k < 10; k++) {
      expect(rec.calls[k]!.arg1Long).toBe(k); // signExt di un byte non-negativo
      expect(rec.calls[k]!.arg2Long).toBe(TABLE_BASE + k * ENTRY_STRIDE);
    }
  });

  it("argIdx = 9 → 1 chiamata sola (D2.b=9, ptr=0x1EEA0+9*8=0x1EEE8)", () => {
    const s = emptyGameState();
    const rec = makeRecorder();

    dispatchTable1EEA0(s, 9, { fun_428e: rec.cb });

    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]).toEqual({
      arg1Long: 9,
      arg2Long: TABLE_BASE + 9 * ENTRY_STRIDE,
    });
  });

  it("argIdx = 0x0A → 0 chiamate (loop saltato dal test iniziale)", () => {
    const s = emptyGameState();
    const rec = makeRecorder();

    dispatchTable1EEA0(s, 0x0a, { fun_428e: rec.cb });

    expect(rec.calls).toHaveLength(0);
  });

  it("argIdx = 0xFF (signed -1 byte) → 11 chiamate; D2.b: FF,00..09; ptr da 0x1EEA0-8", () => {
    const s = emptyGameState();
    const rec = makeRecorder();

    dispatchTable1EEA0(s, 0xff, { fun_428e: rec.cb });

    expect(rec.calls).toHaveLength(11);

    // Iter 0: D2.b=0xFF → arg1 = signExt(0xFF) = 0xFFFFFFFF
    expect(rec.calls[0]!.arg1Long).toBe(0xffffffff >>> 0);
    // ptr base = 0x1EEA0 + signExt(0xFF)*8 = 0x1EEA0 + (-8) = 0x1EE98
    expect(rec.calls[0]!.arg2Long).toBe((TABLE_BASE - 8) >>> 0);

    // Iter 1: D2.b=0x00 → arg1 = 0; ptr = 0x1EE98 + 8 = 0x1EEA0
    expect(rec.calls[1]!.arg1Long).toBe(0);
    expect(rec.calls[1]!.arg2Long).toBe(TABLE_BASE);

    // Iter 10: D2.b=0x09 → arg1 = 9; ptr = 0x1EEA0 + 9*8 = 0x1EEE8
    expect(rec.calls[10]!.arg1Long).toBe(9);
    expect(rec.calls[10]!.arg2Long).toBe(TABLE_BASE + 9 * ENTRY_STRIDE);
  });

  it("argIdx = 0x80 (signed -128 byte) → 138 chiamate; arg1 wrap byte da -128 a 9", () => {
    const s = emptyGameState();
    const rec = makeRecorder();

    dispatchTable1EEA0(s, 0x80, { fun_428e: rec.cb });

    // D2.b: 0x80, 0x81, ..., 0xFF (128 valori), 0x00..0x09 (10 valori) = 138.
    expect(rec.calls).toHaveLength(138);

    // Iter 0: D2.b=0x80 → arg1 = signExt(0x80) = 0xFFFFFF80
    expect(rec.calls[0]!.arg1Long).toBe(0xffffff80 >>> 0);
    // ptr base = 0x1EEA0 + signExt(0x80)*8 = 0x1EEA0 + (0xFFFFFF80 << 3) MOD 2^32
    // = 0x1EEA0 + 0xFFFFFC00 = 0x1EAA0 (modulo 2^32)
    const expectedBase = (TABLE_BASE + ((0xffffff80 << 3) >>> 0)) >>> 0;
    expect(rec.calls[0]!.arg2Long).toBe(expectedBase);

    // Iter 128: D2.b dovrebbe essere 0x00 (dopo 0x80..0xFF wrap → 0x00)
    expect(rec.calls[128]!.arg1Long).toBe(0);

    // Iter 137: D2.b = 0x09 (ultimo prima di 0x0A che ferma il loop)
    expect(rec.calls[137]!.arg1Long).toBe(9);
  });

  it("subs assente → no errore, esegue il loop senza side effect", () => {
    const s = emptyGameState();
    const before = new Uint8Array(s.workRam);
    expect(() => dispatchTable1EEA0(s, 0)).not.toThrow();
    expect(s.workRam).toEqual(before);
  });

  it("argIdx normalizzato a byte: 0x100 (= 0x00 byte) → 10 chiamate come argIdx=0", () => {
    const s = emptyGameState();
    const rec = makeRecorder();

    dispatchTable1EEA0(s, 0x100, { fun_428e: rec.cb });

    expect(rec.calls).toHaveLength(10);
    expect(rec.calls[0]!.arg1Long).toBe(0);
    expect(rec.calls[0]!.arg2Long).toBe(TABLE_BASE);
  });
});
