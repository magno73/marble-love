/**
 * state-sub-535e.test.ts — smoke + corner cases di stateSub535E (FUN_535E).
 *
 * Bit-perfect parity verificata vs binary in `test-state-sub-535e-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { stateSub535E } from "../src/state-sub-535e.js";
import { emptyGameState } from "../src/state.js";

describe("stateSub535E (FUN_535E)", () => {
  it("passa byte98 e byte99 sign-extesi + arg all'inner (positivi)", () => {
    const s = emptyGameState();
    s.workRam[0x1f98] = 0x12;
    s.workRam[0x1f99] = 0x34;
    let seen: { b98: number; b99: number; a: number } | null = null;
    const inner = (b98: number, b99: number, a: number): number => {
      seen = { b98, b99, a };
      return 0xdeadbeef;
    };
    const out = stateSub535E(s, 0xcafebabe, inner);
    expect(out).toBe(0xdeadbeef);
    expect(seen).toEqual({ b98: 0x00000012, b99: 0x00000034, a: 0xcafebabe });
  });

  it("byte 0xFF → sign-extende a 0xFFFFFFFF (long M68k)", () => {
    const s = emptyGameState();
    s.workRam[0x1f98] = 0xff;
    s.workRam[0x1f99] = 0x80; // -128
    let b98 = -1;
    let b99 = -1;
    stateSub535E(s, 0, (a, b, _c) => {
      b98 = a;
      b99 = b;
      return 0;
    });
    expect(b98).toBe(0xffffffff);
    expect(b99).toBe(0xffffff80);
  });

  it("byte 0x7F → sign-positive (rimane 0x0000007F, no extend a 0xFFxx)", () => {
    const s = emptyGameState();
    s.workRam[0x1f98] = 0x7f;
    s.workRam[0x1f99] = 0x00;
    let b98 = -1;
    let b99 = -1;
    stateSub535E(s, 0, (a, b, _c) => {
      b98 = a;
      b99 = b;
      return 0;
    });
    expect(b98).toBe(0x0000007f);
    expect(b99).toBe(0x00000000);
  });

  it("default inner=() => 0: ritorna 0 senza side effects", () => {
    const s = emptyGameState();
    s.workRam[0x1f98] = 0xab;
    s.workRam[0x1f99] = 0xcd;
    const before = new Uint8Array(s.workRam);
    const r = stateSub535E(s, 0x12345678);
    expect(r).toBe(0);
    expect(s.workRam).toEqual(before);
  });

  it("arg negativo → normalizzato unsigned 32-bit (complemento 2)", () => {
    const s = emptyGameState();
    let receivedArg = -1;
    stateSub535E(s, -1, (_a, _b, c) => {
      receivedArg = c;
      return 0;
    });
    expect(receivedArg).toBe(0xffffffff);
  });

  it("D0 pass-through: ritorna ESATTAMENTE il valore dell'inner", () => {
    const s = emptyGameState();
    const out = stateSub535E(s, 0, () => 0x12345678);
    expect(out).toBe(0x12345678);
  });

  it("non muta state.workRam (pure read-only sui byte 0x1F98/0x1F99)", () => {
    const s = emptyGameState();
    s.workRam[0x1f98] = 0x55;
    s.workRam[0x1f99] = 0xaa;
    const before = new Uint8Array(s.workRam);
    stateSub535E(s, 0xdeadbeef, () => 0xdeadbeef);
    expect(s.workRam).toEqual(before);
  });
});
