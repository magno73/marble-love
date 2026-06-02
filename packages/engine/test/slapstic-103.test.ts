/**
 * slapstic-103.test.ts - verifies chip 137412-103 state machine with scenarios
 * derivati from the MAME source (`mame/src/mame/atari/slapstic.cpp`).
 *
 * I test are "intent" (Rule 9): codificano cosa la state machine MUST fare
 * for every branch (idle/active/alt/bit), not only reproduce behavior.
 */

import { describe, it, expect } from "vitest";
import {
  createSlapsticFsm,
  slapsticTick,
  _SLAPSTIC_103_CONFIG,
} from "../src/m68k/slapstic-103.js";

describe("slapstic-103 — initial state", () => {
  it("starts at bankstart=3 (chip 103 reset value) in IDLE", () => {
    const fsm = createSlapsticFsm();
    expect(fsm.bank).toBe(3);
    expect(fsm.state).toBe("IDLE");
  });

  it("config has the chip-103 specific magic constants from slapstic.cpp", () => {
    expect(_SLAPSTIC_103_CONFIG.BANK_VALUES).toEqual([0x0040, 0x0050, 0x0060, 0x0070]);
    expect(_SLAPSTIC_103_CONFIG.ALT1.value).toBe(0x002d);
    expect(_SLAPSTIC_103_CONFIG.ALT2.value).toBe(0x3d14);
    expect(_SLAPSTIC_103_CONFIG.BIT1.value).toBe(0x34c0);
    expect(_SLAPSTIC_103_CONFIG.BANKSTART).toBe(3);
  });
});

describe("slapstic-103 — reset access transitions IDLE → ACTIVE", () => {
  it("reset access at 0x80000 puts FSM in ACTIVE", () => {
    const fsm = createSlapsticFsm();
    slapsticTick(fsm, 0x080000);
    expect(fsm.state).toBe("ACTIVE");
    expect(fsm.bank).toBe(3); // bank invariato
  });

  it("non-reset address in IDLE leaves FSM in IDLE", () => {
    const fsm = createSlapsticFsm();
    slapsticTick(fsm, 0x080dc2);
    expect(fsm.state).toBe("IDLE");
    expect(fsm.bank).toBe(3);
  });
});

describe("slapstic-103 — direct bank switch (ACTIVE → IDLE)", () => {
  it.each([
    [0x080080, 0],
    [0x0800a0, 1],
    [0x0800c0, 2],
    [0x0800e0, 3],
  ])("addr 0x%s in ACTIVE selects bank %d → IDLE", (addr, bank) => {
    const fsm = createSlapsticFsm();
    slapsticTick(fsm, 0x080000); // → ACTIVE
    slapsticTick(fsm, addr as number);
    expect(fsm.bank).toBe(bank);
    expect(fsm.state).toBe("IDLE");
  });
});

describe("slapstic-103 — verified against MAME trace (140 accesses, f12000-12005)", () => {
  // Source: /tmp/mame_slapstic_trace.json analizzato via Python script.
  // Expected bank after f=12000: 1, verified via data match against ROM blob.
  // Expected bank after f=12001: 1 (with 1->2->1 transitions in between via lookups).
  it("bank=1 a inizio f=12000 → 7 access non-trigger → bank=1 a fine", () => {
    const fsm = { bank: 1, state: "IDLE" as const, loadedBank: 0 };
    const f12000_addrs = [0x080dc2, 0x0809e4, 0x080910, 0x081072, 0x081072, 0x080ff6, 0x080ff6];
    for (const a of f12000_addrs) slapsticTick(fsm, a);
    expect(fsm.bank).toBe(1);
    expect(fsm.state).toBe("IDLE");
  });

  it("bank=1 + reset + direct switch 0x800c0 → bank=2 (FUN_2FFB8 lookup arg=2)", () => {
    const fsm = { bank: 1, state: "IDLE" as const, loadedBank: 0 };
    slapsticTick(fsm, 0x080000); // trigger
    slapsticTick(fsm, 0x0800c0); // direct → bank 2
    expect(fsm.bank).toBe(2);
    expect(fsm.state).toBe("IDLE");
  });
});

describe("slapstic-103 — alt sequence does NOT inadvertently break on normal reads", () => {
  it("alt1 trigger followed by non-alt2 read goes back to ACTIVE", () => {
    const fsm = createSlapsticFsm();
    slapsticTick(fsm, 0x080000); // → ACTIVE
    // ALT1 test_any: (addr & 0xFE) == 0x5A. E.g. addr 0x0000005A (lookup wrap).
    // For chip 103, l'arg=0xD (15) prodotto da `arg<<5 = 0x1A0`, signed = 0x1A0.
    // Could a "0x5A" value on the bus be triggered? In practice, MAME
    // observed trace: no alt1 trigger in la window analizzata.
    slapsticTick(fsm, 0x00005a); // forza alt1 trigger (test_any matches 0x5A)
    expect(fsm.state).toBe("ALT_VALID");
    // Non-alt2 read → torna ACTIVE
    slapsticTick(fsm, 0x080dc2);
    expect(fsm.state).toBe("ACTIVE");
  });
});

describe("slapstic-103 — code-prefetch alt path", () => {
  it("prefetch at 0x2ff5a can arm alt banking before the table-store R/W pair", () => {
    const fsm = { bank: 2, state: "IDLE" as const, loadedBank: 0 };

    slapsticTick(fsm, 0x080000); // reset access → ACTIVE
    slapsticTick(fsm, 0x080000); // harmless in ACTIVE
    slapsticTick(fsm, 0x02ff5a); // ALT1 test_any, outside protected window
    slapsticTick(fsm, 0x087a28); // ALT2
    slapsticTick(fsm, 0x087a4c); // ALT3, loads bank 2
    slapsticTick(fsm, 0x080080); // ALT4 commit, not direct bank 0

    expect(fsm.bank).toBe(2);
    expect(fsm.state).toBe("IDLE");
  });
});
