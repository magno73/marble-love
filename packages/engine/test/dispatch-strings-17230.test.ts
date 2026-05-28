/**
 * Test dispatchStrings17230 (FUN_17230) — smoke tests sui rami principali.
 *
 * `cli/src/test-dispatch-strings-17230-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  dispatchStrings17230,
  SLOT_BASE_ADDR,
  SLOT_STRIDE,
  SLOT_COUNT,
  CALLEE_ADDR,
} from "../src/dispatch-strings-17230.js";

describe("dispatchStrings17230 (FUN_17230)", () => {
  it("costanti coerenti col disasm", () => {
    expect(SLOT_BASE_ADDR).toBe(0x401482);
    expect(SLOT_STRIDE).toBe(0x42);
    expect(SLOT_COUNT).toBe(7);
    expect(CALLEE_ADDR).toBe(0x0001725a);
  });

  it("invoca callee esattamente 7 volte, nell'ordine 68k (i=0..6)", () => {
    const calls: number[] = [];
    dispatchStrings17230((slot) => calls.push(slot >>> 0));

    expect(calls).toHaveLength(SLOT_COUNT);
    for (let i = 0; i < SLOT_COUNT; i++) {
      expect(calls[i]).toBe((SLOT_BASE_ADDR + i * SLOT_STRIDE) >>> 0);
    }
    expect(calls).toEqual([
      0x401482, 0x4014c4, 0x401506, 0x401548, 0x40158a, 0x4015cc, 0x40160e,
    ]);
  });

  it("nessun side-effect del dispatcher: callee no-op → nessuna mutazione osservabile", () => {
    let count = 0;
    dispatchStrings17230(() => {
      count++;
    });
    expect(count).toBe(7);
  });

  it("callee può mutare strutture esterne senza interferire col loop", () => {
    const wr = new Uint8Array(0x2000);
    dispatchStrings17230((slot) => {
      const off = slot - 0x400000;
      if (off >= 0 && off < wr.length) wr[off] = 0x99;
    });
    // The 7 slots must have 0x99 in their first byte.
    for (let i = 0; i < SLOT_COUNT; i++) {
      const off = (SLOT_BASE_ADDR + i * SLOT_STRIDE) - 0x400000;
      expect(wr[off]).toBe(0x99);
    }
    let mutated = 0;
    for (let i = 0; i < wr.length; i++) if (wr[i] !== 0) mutated++;
    expect(mutated).toBe(SLOT_COUNT);
  });

  it("ordine call deterministico: nessun bit fuori posto col post-incremento di D3", () => {
    // from the add. Verify that the first arg is 0x401482, not 0x4014C4.
    const first: number[] = [];
    dispatchStrings17230((slot) => {
      if (first.length === 0) first.push(slot);
    });
    expect(first[0]).toBe(SLOT_BASE_ADDR);
  });

  it("dispatcher è puro: due chiamate con callback identica → identici call sequences", () => {
    const a: number[] = [];
    const b: number[] = [];
    dispatchStrings17230((s) => a.push(s));
    dispatchStrings17230((s) => b.push(s));
    expect(b).toEqual(a);
  });

  it("eccezione lanciata dal callee si propaga (no swallowing)", () => {
    expect(() => {
      dispatchStrings17230((slot) => {
        if (slot === SLOT_BASE_ADDR + 3 * SLOT_STRIDE) {
          throw new Error("test");
        }
      });
    }).toThrow("test");
  });

  it("ultimo slot pushato è 0x40160E (i=6); D3 post-loop unused è 0x401650 (i=7)", () => {
    // The 7th (last) pushed pointer corresponds to i=6: 0x401482 + 6*0x42 = 0x40160E.
    const calls: number[] = [];
    dispatchStrings17230((s) => calls.push(s));
    expect(calls[SLOT_COUNT - 1]).toBe(0x40160e);
    expect(calls).not.toContain(0x401650);
  });
});
