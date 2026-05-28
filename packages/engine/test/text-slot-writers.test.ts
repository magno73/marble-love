import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import {
  TEXT_SLOT_INIT_255A_ADDR,
  TRIM_TRAILING_SPACE_28F28_ADDR,
  RENDER_TEXT_SLOT_28F62_ADDR,
  textSlotInit255A,
  trimTrailingSpace28F28,
  renderTextSlot28F62,
} from "../src/text-slot-writers.js";

describe("FUN_255A textSlotInit255A", () => {
  it("expone l'address del binario", () => {
    expect(TEXT_SLOT_INIT_255A_ADDR).toBe(0x255a);
  });

  it("scrive 2 byte + clear byte at +0x6", () => {
    const s = emptyGameState();
    // Pre-fill with noise to verify clear.
    for (let i = 0; i < 8; i++) s.workRam[0x100 + i] = 0xab;

    textSlotInit255A(s, 0x00400100, 0x42, 0x73);

    expect(s.workRam[0x100]).toBe(0x42);
    expect(s.workRam[0x101]).toBe(0x73);
    expect(s.workRam[0x102]).toBe(0xab); // non toccato
    expect(s.workRam[0x103]).toBe(0xab);
    expect(s.workRam[0x104]).toBe(0xab);
    expect(s.workRam[0x105]).toBe(0xab);
    expect(s.workRam[0x106]).toBe(0); // clear
    expect(s.workRam[0x107]).toBe(0xab);
  });

  it("masking: solo byte LSB di byte1/byte2 viene scritto", () => {
    const s = emptyGameState();
    textSlotInit255A(s, 0x00400100, 0x1234, 0xcafe);
    expect(s.workRam[0x100]).toBe(0x34);
    expect(s.workRam[0x101]).toBe(0xfe);
  });

  it("ptr fuori range → no-op (graceful)", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0x99;
    textSlotInit255A(s, 0x00500000, 1, 2); // out of workRam
    expect(s.workRam[0x100]).toBe(0x99);
  });
});

describe("FUN_28F28 trimTrailingSpace28F28", () => {
  it("expone l'address del binario", () => {
    expect(TRIM_TRAILING_SPACE_28F28_ADDR).toBe(0x28f28);
  });

  it("trova primo 0x20 e lo azzera", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0x41; // 'A'
    s.workRam[0x101] = 0x42; // 'B'
    s.workRam[0x102] = 0x20; // ' '
    s.workRam[0x103] = 0x43; // 'C'

    const pos = trimTrailingSpace28F28(s, 0x00400100, 10);

    expect(pos).toBe(2);
    expect(s.workRam[0x102]).toBe(0); // clear
    expect(s.workRam[0x101]).toBe(0x42); // non toccato
    expect(s.workRam[0x103]).toBe(0x43); // non toccato
  });

  it("nessuno space entro maxLen → no-op + ritorna maxLen", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0x41;
    s.workRam[0x101] = 0x42;
    s.workRam[0x102] = 0x43;

    const pos = trimTrailingSpace28F28(s, 0x00400100, 3);

    expect(pos).toBe(3);
    expect(s.workRam[0x100]).toBe(0x41); // non toccato
  });

  it("space al primo byte → pos=0, byte azzerato", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0x20;
    const pos = trimTrailingSpace28F28(s, 0x00400100, 5);
    expect(pos).toBe(0);
    expect(s.workRam[0x100]).toBe(0);
  });

  it("maxLen=0 → no-op", () => {
    const s = emptyGameState();
    s.workRam[0x100] = 0x20;
    const pos = trimTrailingSpace28F28(s, 0x00400100, 0);
    expect(pos).toBe(0);
    expect(s.workRam[0x100]).toBe(0x20); // non toccato
  });
});

describe("FUN_28F62 renderTextSlot28F62 (orchestrator)", () => {
  it("expone l'address del binario", () => {
    expect(RENDER_TEXT_SLOT_28F62_ADDR).toBe(0x28f62);
  });

  // Test orchestrator delegates to stateSub2572; verify only that
  // textSlotInit255A side effect avvenga (workRam[0x40041C]=byte1, etc.)
  // Full parity would need musashi-wasm with state-sub-2572 enabled.
  it("scrive in workRam[0x40041C] tramite textSlotInit255A inline", () => {
    const s = emptyGameState();
    const rom = { program: new Uint8Array(0x88000) };
    renderTextSlot28F62(s, rom, 0x42, 0x73, 0x22a56);
    expect(s.workRam[0x41c]).toBe(0x42); // 0x40041C - 0x400000
    expect(s.workRam[0x41d]).toBe(0x73);
    expect(s.workRam[0x422]).toBe(0); // clear at +6
  });
});
