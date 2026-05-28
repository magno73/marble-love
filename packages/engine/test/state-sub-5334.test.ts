/**
 * state-sub-5334.test.ts — smoke tests di stateSub5334 (FUN_5334).
 *
 * Bit-perfect parity verificata vs binary in `test-state-sub-5334-parity.ts`.
 * Covers forwarding 3 args, byte-to-long sign extension, return
 * pass-through, default inner no-op, no side-effects sul GameState.
 */

import { describe, it, expect } from "vitest";
import { stateSub5334 } from "../src/state-sub-5334.js";
import { emptyGameState } from "../src/state.js";

describe("stateSub5334 (FUN_5334)", () => {
  it("forwarda i 3 long a inner: byte98 sign-ext, byte99 sign-ext, argLong", () => {
    const s = emptyGameState();
    s.workRam[0x1f98] = 0x12;
    s.workRam[0x1f99] = 0x34;

    let captured: { a1: number; a2: number; a3: number } | null = null;
    const r = stateSub5334(s, 0xdeadbeef, (a1, a2, a3) => {
      captured = { a1, a2, a3 };
      return 0;
    });

    expect(r).toBe(0);
    expect(captured).not.toBeNull();
    expect(captured!.a1).toBe(0x12);
    expect(captured!.a2).toBe(0x34);
    expect(captured!.a3).toBe(0xdeadbeef);
  });

  it("sign-extension: byte 0x80 → 0xFFFFFF80, byte 0xFF → 0xFFFFFFFF", () => {
    const s = emptyGameState();
    s.workRam[0x1f98] = 0x80;
    s.workRam[0x1f99] = 0xff;

    let captured: { a1: number; a2: number } | null = null;
    stateSub5334(s, 0, (a1, a2) => {
      captured = { a1, a2 };
      return 0;
    });

    expect(captured!.a1).toBe(0xffffff80 >>> 0);
    expect(captured!.a2).toBe(0xffffffff >>> 0);
  });

  it("sign-extension: byte 0x7F resta 0x0000007F (positivo signed massimo)", () => {
    const s = emptyGameState();
    s.workRam[0x1f98] = 0x7f;
    s.workRam[0x1f99] = 0x00;

    let captured: { a1: number; a2: number } | null = null;
    stateSub5334(s, 0, (a1, a2) => {
      captured = { a1, a2 };
      return 0;
    });

    expect(captured!.a1).toBe(0x0000007f);
    expect(captured!.a2).toBe(0x00000000);
  });

  it("return = pass-through del valore di inner (uint32)", () => {
    const s = emptyGameState();
    const r = stateSub5334(s, 0, () => 0xcafebabe >>> 0);
    expect(r).toBe(0xcafebabe >>> 0);
  });

  it("return = 0 con default inner no-op", () => {
    const s = emptyGameState();
    const r = stateSub5334(s, 0x12345678);
    expect(r).toBe(0);
  });

  it("non altera workRam: i due byte e dintorni restano invariati", () => {
    const s = emptyGameState();
    s.workRam[0x1f97] = 0xab;
    s.workRam[0x1f98] = 0x55;
    s.workRam[0x1f99] = 0xaa;
    s.workRam[0x1f9a] = 0xcd;
    const before = new Uint8Array(s.workRam);

    stateSub5334(s, 0xffffffff, () => 0x42);
    expect(s.workRam).toEqual(before);
  });

  it("argLong viene normalizzato a uint32 (negativi/overflow)", () => {
    const s = emptyGameState();

    let captured = -1;
    stateSub5334(s, -1, (_a1, _a2, a3) => {
      captured = a3;
      return 0;
    });
    expect(captured).toBe(0xffffffff >>> 0);

    stateSub5334(s, 0x1_0000_0001, (_a1, _a2, a3) => {
      captured = a3;
      return 0;
    });
    expect(captured).toBe(0x00000001);
  });

  it("byte init zero → entrambi gli arg sign-extended sono 0", () => {
    const s = emptyGameState();
    let captured: { a1: number; a2: number } | null = null;
    stateSub5334(s, 0xa5a5a5a5, (a1, a2) => {
      captured = { a1, a2 };
      return 0;
    });
    expect(captured!.a1).toBe(0);
    expect(captured!.a2).toBe(0);
  });
});
