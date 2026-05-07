/**
 * state-sub-28ea.test.ts — smoke + corner case di FUN_28EA.
 *
 * La parità bit-perfect col binario è verificata in
 * `packages/cli/src/test-state-sub-28ea-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { stateSub28EA } from "../src/state-sub-28ea.js";
import type { StateSub28EASubs } from "../src/state-sub-28ea.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const DATA_BASE = 0x1f04;
const WORD16_BASE = 0x1f14;
const STATE_BASE = 0x1f1c;
const THRESHOLD_BASE = 0x1f20;
const COUNTER_BASE = 0x1f28;
const FLAG34_BASE = 0x1f34;
const TARGET_OFF = 0x1f3e;

function readLong(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function readWord(s: ReturnType<typeof emptyGameState>, off: number): number {
  return ((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0);
}

describe("stateSub28EA (FUN_28EA)", () => {
  it("scrive 0x401F3E con la target word PRIMA della render (anche se nessun slot libero)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Tutti slot occupati
    for (let i = 0; i < 4; i++) s.workRam[STATE_BASE + i] = 1;

    let renderCalled = 0;
    let renderTargetSeenBeforeJsr = -1;
    const subs: StateSub28EASubs = {
      fun_2572: (state) => {
        renderCalled++;
        renderTargetSeenBeforeJsr = readWord(state, TARGET_OFF);
      },
    };

    stateSub28EA(s, rom, 0xdeadbeef, 0x1234, 0x9abc, subs);

    expect(renderCalled).toBe(1);
    expect(renderTargetSeenBeforeJsr).toBe(0x9abc);
    expect(readWord(s, TARGET_OFF)).toBe(0x9abc);
    // Nessuna registrazione (tutti occupati)
    for (let i = 0; i < 4; i++) expect(s.workRam[STATE_BASE + i]).toBe(1);
  });

  it("registra slot 0 con state=7, dataPtr long, word16 word — non tocca THRESHOLD/COUNTER/FLAG34", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Pre-fill THRESHOLD/COUNTER/FLAG34 dello slot 0 con sentinel: NON devono cambiare.
    s.workRam[THRESHOLD_BASE + 0] = 0xaa;
    s.workRam[THRESHOLD_BASE + 1] = 0xbb;
    s.workRam[COUNTER_BASE + 0] = 0xcc;
    s.workRam[COUNTER_BASE + 1] = 0xdd;
    s.workRam[FLAG34_BASE + 0] = 0xee;

    stateSub28EA(s, rom, 0xcafe1234, 0x55aa1234, 0xffff0042);

    expect(readLong(s, DATA_BASE + 0)).toBe(0xcafe1234);
    expect(s.workRam[STATE_BASE + 0]).toBe(7);
    // arg2.w = 0x1234 (low word di 0x55AA1234)
    expect(readWord(s, WORD16_BASE + 0)).toBe(0x1234);
    // target = arg3.w = 0x0042
    expect(readWord(s, TARGET_OFF)).toBe(0x0042);

    // Sentinel preservati (FUN_28EA non li scrive a differenza di state=3)
    expect(s.workRam[THRESHOLD_BASE + 0]).toBe(0xaa);
    expect(s.workRam[THRESHOLD_BASE + 1]).toBe(0xbb);
    expect(s.workRam[COUNTER_BASE + 0]).toBe(0xcc);
    expect(s.workRam[COUNTER_BASE + 1]).toBe(0xdd);
    expect(s.workRam[FLAG34_BASE + 0]).toBe(0xee);
  });

  it("salta slot occupati e scrive nel primo libero", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[STATE_BASE + 0] = 3;
    s.workRam[STATE_BASE + 1] = 5;
    s.workRam[STATE_BASE + 2] = 0;
    s.workRam[STATE_BASE + 3] = 0;

    stateSub28EA(s, rom, 0x11223344, 0xabcd, 0x0001);

    expect(s.workRam[STATE_BASE + 2]).toBe(7);
    expect(readLong(s, DATA_BASE + 2 * 4)).toBe(0x11223344);
    expect(readWord(s, WORD16_BASE + 2 * 2)).toBe(0xabcd);
    // Slot 3 intatto
    expect(s.workRam[STATE_BASE + 3]).toBe(0);
    expect(readLong(s, DATA_BASE + 3 * 4)).toBe(0);
  });

  it("passa sext.l(arg2.w) a fun_2572 (sign-extension da word a long)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    let observedAttr = 0;
    const subs: StateSub28EASubs = {
      fun_2572: (_st, _r, _ptr, attrSigned) => {
        observedAttr = attrSigned;
      },
    };

    // arg2.w = 0x8000 → sext.l = -32768 (0xFFFF8000 / -32768)
    stateSub28EA(s, rom, 0, 0xdead8000, 0, subs);
    expect(observedAttr).toBe(-32768);

    // arg2.w = 0x7FFF → sext.l = 32767 positivo
    stateSub28EA(s, rom, 0, 0x12347fff, 0, subs);
    expect(observedAttr).toBe(0x7fff);

    // arg2.w = 0xFFFF → sext.l = -1
    stateSub28EA(s, rom, 0, 0x0000ffff, 0, subs);
    expect(observedAttr).toBe(-1);
  });

  it("default subs: nessuna eccezione se fun_2572 non è iniettato (no-op)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => stateSub28EA(s, rom, 0xdeadbeef, 0x1111, 0x2222)).not.toThrow();
    // Slot 0 comunque allocato (render no-op non blocca la registrazione)
    expect(s.workRam[STATE_BASE + 0]).toBe(7);
    expect(readLong(s, DATA_BASE + 0)).toBe(0xdeadbeef);
    expect(readWord(s, WORD16_BASE + 0)).toBe(0x1111);
    expect(readWord(s, TARGET_OFF)).toBe(0x2222);
  });

  it("usa solo low word di arg2 e arg3 (mask 0xFFFF; high word ignorato)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    stateSub28EA(s, rom, 0x00000000, 0xffff5678, 0xdead9abc);
    expect(readWord(s, WORD16_BASE + 0)).toBe(0x5678);
    expect(readWord(s, TARGET_OFF)).toBe(0x9abc);
  });
});
