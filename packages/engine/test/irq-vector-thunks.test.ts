/**
 * irq-vector-thunks.test.ts — smoke test per THUNK_TABLE.
 *
 *
 * `move #0x2000,SR ; rts` (enable-interrupts, targetAddr=null).
 */

import { describe, it, expect } from "vitest";
import {
  THUNK_TABLE,
  THUNK_MAP,
  enableInterrupts1010A,
  type ThunkEntry,
} from "../src/irq-vector-thunks.js";

const EXPECTED: Array<{ sourceAddr: number; targetAddr: number | null }> = [
  { sourceAddr: 0x000100, targetAddr: 0x00002a24 },
  { sourceAddr: 0x00010c, targetAddr: 0x00003a08 },
  { sourceAddr: 0x000112, targetAddr: 0x00003874 },
  { sourceAddr: 0x000118, targetAddr: 0x00002678 },
  { sourceAddr: 0x00012a, targetAddr: 0x00002b50 },
  { sourceAddr: 0x00013c, targetAddr: 0x0000255a },
  { sourceAddr: 0x000148, targetAddr: 0x00002e18 },
  { sourceAddr: 0x00014e, targetAddr: 0x000031d0 },
  { sourceAddr: 0x00015a, targetAddr: 0x00004ca0 },
  { sourceAddr: 0x000160, targetAddr: 0x00003f78 },
  { sourceAddr: 0x000178, targetAddr: 0x00004d68 },
  { sourceAddr: 0x00019c, targetAddr: 0x00004790 },
  { sourceAddr: 0x0001a8, targetAddr: 0x000040d8 },
  { sourceAddr: 0x0001ae, targetAddr: 0x000041c8 },
  { sourceAddr: 0x0001b4, targetAddr: 0x0000428e },
  { sourceAddr: 0x0001c0, targetAddr: 0x00004420 },
  { sourceAddr: 0x0001c6, targetAddr: 0x00004686 },
  { sourceAddr: 0x000218, targetAddr: 0x00003784 },
  { sourceAddr: 0x000224, targetAddr: 0x000037e4 },
  { sourceAddr: 0x000230, targetAddr: 0x00004008 },
  { sourceAddr: 0x000236, targetAddr: 0x00003f3e },
  { sourceAddr: 0x00023c, targetAddr: 0x00004c6e },
  { sourceAddr: 0x000254, targetAddr: 0x00004d98 },
  { sourceAddr: 0x01010a, targetAddr: null },
];

describe("THUNK_TABLE (irq-vector-thunks)", () => {
  it("contiene esattamente 24 entry", () => {
    expect(THUNK_TABLE.length).toBe(24);
  });

  it("ogni entry ha sourceAddr, targetAddr e romBytes definiti", () => {
    for (const entry of THUNK_TABLE) {
      expect(typeof entry.sourceAddr).toBe("number");
      expect(entry.romBytes).toMatch(/^[0-9A-F]{12}$/);
      if (entry.targetAddr !== null) {
        expect(typeof entry.targetAddr).toBe("number");
      }
    }
  });

  it("tutti i 23 JMP thunk hanno opcode 4EF9 in romBytes", () => {
    const jmpEntries = THUNK_TABLE.filter((e) => e.targetAddr !== null);
    expect(jmpEntries.length).toBe(23);
    for (const entry of jmpEntries) {
      expect(entry.romBytes.startsWith("4EF9")).toBe(true);
    }
  });

  it("0x01010A ha targetAddr null e romBytes 46FC20004E75", () => {
    const e = THUNK_MAP.get(0x01010a);
    expect(e).toBeDefined();
    expect(e!.targetAddr).toBeNull();
    expect(e!.romBytes).toBe("46FC20004E75");
  });

  it("tutti i targetAddr corrispondono ai valori ROM estratti dalla disasm cache", () => {
    for (const expected of EXPECTED) {
      const entry = THUNK_MAP.get(expected.sourceAddr);
      expect(entry).toBeDefined();
      expect(entry!.targetAddr).toBe(expected.targetAddr);
    }
  });

  it("THUNK_MAP ha 24 entry con le stesse chiavi di THUNK_TABLE", () => {
    expect(THUNK_MAP.size).toBe(THUNK_TABLE.length);
    for (const entry of THUNK_TABLE) {
      expect(THUNK_MAP.get(entry.sourceAddr)).toBe(entry);
    }
  });

  it("sourceAddr di ogni JMP thunk codificato correttamente in romBytes (byte 2-5)", () => {
    // For each JMP: romBytes[4..11] must match targetAddr big-endian.
    const jmpEntries = THUNK_TABLE.filter((e) => e.targetAddr !== null);
    for (const entry of jmpEntries) {
      const targetFromBytes = parseInt(entry.romBytes.slice(4), 16);
      expect(targetFromBytes).toBe(entry.targetAddr!);
    }
  });

  it("enableInterrupts1010A è una funzione chiamabile senza side-effect", () => {
    expect(typeof enableInterrupts1010A).toBe("function");
    expect(() => enableInterrupts1010A()).not.toThrow();
  });
});
