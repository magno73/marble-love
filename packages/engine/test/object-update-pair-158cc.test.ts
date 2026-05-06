/**
 * object-update-pair-158cc.test.ts — corner cases di objectUpdatePair158CC
 * (FUN_158CC).
 *
 * Bit-perfect parity verificata vs binary in
 * `test-object-update-pair-158cc-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  objectUpdatePair158CC,
  SLOT_PAIR_BASE_ADDR,
  SLOT_PAIR_STRIDE,
  SLOT_PAIR_COUNT,
} from "../src/object-update-pair-158cc.js";
import { emptyGameState } from "../src/state.js";

describe("objectUpdatePair158CC (FUN_158CC)", () => {
  it("chiama objectUpdate esattamente 2 volte", () => {
    const s = emptyGameState();
    const calls: number[] = [];
    objectUpdatePair158CC(s, {
      objectUpdate: (p) => calls.push(p),
    });
    expect(calls).toHaveLength(2);
  });

  it("ordine deterministico: slot 0 (0x004009A4) → slot 1 (0x00400A20)", () => {
    const s = emptyGameState();
    const calls: number[] = [];
    objectUpdatePair158CC(s, {
      objectUpdate: (p) => calls.push(p),
    });
    expect(calls[0]).toBe(0x004009a4);
    expect(calls[1]).toBe(0x00400a20);
    // verifica simbolica delle costanti
    expect(SLOT_PAIR_BASE_ADDR).toBe(0x004009a4);
    expect(SLOT_PAIR_STRIDE).toBe(0x7c);
    expect(SLOT_PAIR_COUNT).toBe(2);
    expect(SLOT_PAIR_BASE_ADDR + SLOT_PAIR_STRIDE).toBe(0x00400a20);
  });

  it("default subs (no callback) → nessun errore, nessuna mutazione", () => {
    const s = emptyGameState();
    const before = new Uint8Array(s.workRam);
    expect(() => objectUpdatePair158CC(s)).not.toThrow();
    expect(s.workRam).toEqual(before);
  });

  it("nessun side effect su workRam (FUN_158CC pura: solo push/pop su stack)", () => {
    const s = emptyGameState();
    // Mette pattern arbitrari nelle slot 0 e 1 + altro: FUN_158CC stessa
    // non scrive (delega tutto a FUN_158F6 → qui no-op).
    s.workRam[0x9a4] = 0xab;
    s.workRam[0xa20] = 0xcd;
    s.workRam[0x100] = 0xef;
    const before = new Uint8Array(s.workRam);
    objectUpdatePair158CC(s, { objectUpdate: () => {} });
    expect(s.workRam).toEqual(before);
  });

  it("subs.objectUpdate vede sempre i due ptr assoluti, non offset", () => {
    const s = emptyGameState();
    const calls: number[] = [];
    objectUpdatePair158CC(s, {
      objectUpdate: (p) => calls.push(p),
    });
    // Sono indirizzi assoluti (work-RAM-mapped, base 0x400000), non offset.
    expect(calls[0]! & 0xff000000).toBe(0); // M68k 24-bit usable
    expect(calls[0]! >>> 16).toBe(0x0040);
    expect(calls[1]! >>> 16).toBe(0x0040);
  });

  it("non legge alcun campo dalla work RAM (state immutabile in input)", () => {
    // Anche con tutta la work RAM piena di pattern strani, le call sequence
    // resta identica.
    const s1 = emptyGameState();
    const calls1: number[] = [];
    objectUpdatePair158CC(s1, { objectUpdate: (p) => calls1.push(p) });

    const s2 = emptyGameState();
    s2.workRam.fill(0xff);
    const calls2: number[] = [];
    objectUpdatePair158CC(s2, { objectUpdate: (p) => calls2.push(p) });

    expect(calls1).toEqual(calls2);
  });
});
