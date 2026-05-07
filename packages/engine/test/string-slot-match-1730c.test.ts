/**
 * string-slot-match-1730c.test.ts — smoke test stringSlotMatch1730C (FUN_1730C).
 *
 * Bit-perfect parity verificata vs binary in
 * `cli/src/test-string-slot-match-1730c-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  stringSlotMatch1730C,
  SLOT_BASE_ADDR,
  SLOT_STRIDE,
  SLOT_COUNT,
  SLOT_ACTIVE_FLAG_OFF,
  SLOT_ID_LONG_OFF,
  ARG_ID_LONG_OFF,
} from "../src/string-slot-match-1730c.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;

/** Helper: scrive un long big-endian in workRam all'offset assoluto. */
function writeU32(s: ReturnType<typeof emptyGameState>, addr: number, v: number): void {
  const off = (addr - WORK_RAM_BASE) >>> 0;
  s.workRam[off] = (v >>> 24) & 0xff;
  s.workRam[off + 1] = (v >>> 16) & 0xff;
  s.workRam[off + 2] = (v >>> 8) & 0xff;
  s.workRam[off + 3] = v & 0xff;
}

/** Helper: setta flag active (byte) di slot i. */
function setActive(
  s: ReturnType<typeof emptyGameState>,
  slotIdx: number,
  active: number,
): void {
  const slotOff = (SLOT_BASE_ADDR + slotIdx * SLOT_STRIDE) - WORK_RAM_BASE;
  s.workRam[slotOff + SLOT_ACTIVE_FLAG_OFF] = active & 0xff;
}

/** Helper: setta ID long di slot i. */
function setSlotId(
  s: ReturnType<typeof emptyGameState>,
  slotIdx: number,
  id: number,
): void {
  const slotAddr = SLOT_BASE_ADDR + slotIdx * SLOT_STRIDE;
  writeU32(s, slotAddr + SLOT_ID_LONG_OFF, id);
}

describe("stringSlotMatch1730C (FUN_1730C)", () => {
  it("costanti coerenti col disasm", () => {
    expect(SLOT_BASE_ADDR).toBe(0x401482);
    expect(SLOT_STRIDE).toBe(0x42);
    expect(SLOT_COUNT).toBe(7);
    expect(SLOT_ACTIVE_FLAG_OFF).toBe(0x18);
    expect(SLOT_ID_LONG_OFF).toBe(0x30);
    expect(ARG_ID_LONG_OFF).toBe(0x2);
  });

  it("tutti slot inattivi (active=0) → ritorna 0", () => {
    const s = emptyGameState();
    // argPtr punta a un record con ID 0xDEADBEEF.
    const argPtr = 0x401e00;
    writeU32(s, argPtr + ARG_ID_LONG_OFF, 0xdeadbeef);
    // Anche se imposto gli ID degli slot uguali, devono essere ignorati
    // perché tutti inattivi.
    for (let i = 0; i < SLOT_COUNT; i++) {
      setSlotId(s, i, 0xdeadbeef);
    }
    expect(stringSlotMatch1730C(s, argPtr)).toBe(0);
  });

  it("slot attivo con ID matchante → ritorna 1", () => {
    const s = emptyGameState();
    const argPtr = 0x401e00;
    writeU32(s, argPtr + ARG_ID_LONG_OFF, 0x12345678);
    // Solo slot 3 attivo, ID matcha.
    setActive(s, 3, 1);
    setSlotId(s, 3, 0x12345678);
    expect(stringSlotMatch1730C(s, argPtr)).toBe(1);
  });

  it("slot attivo ma ID diverso → ritorna 0", () => {
    const s = emptyGameState();
    const argPtr = 0x401e00;
    writeU32(s, argPtr + ARG_ID_LONG_OFF, 0xaabbccdd);
    // Tutti gli slot attivi ma con ID diversi.
    for (let i = 0; i < SLOT_COUNT; i++) {
      setActive(s, i, 0xff);
      setSlotId(s, i, 0x11000000 + i);
    }
    expect(stringSlotMatch1730C(s, argPtr)).toBe(0);
  });

  it("active flag = 0xFF (byte != 0) ancora considerato attivo", () => {
    const s = emptyGameState();
    const argPtr = 0x401e00;
    writeU32(s, argPtr + ARG_ID_LONG_OFF, 0xcafebabe);
    setActive(s, 5, 0xff);
    setSlotId(s, 5, 0xcafebabe);
    expect(stringSlotMatch1730C(s, argPtr)).toBe(1);
  });

  it("match in slot 0 (primo, early exit)", () => {
    const s = emptyGameState();
    const argPtr = 0x401e00;
    writeU32(s, argPtr + ARG_ID_LONG_OFF, 0x55aa55aa);
    setActive(s, 0, 1);
    setSlotId(s, 0, 0x55aa55aa);
    expect(stringSlotMatch1730C(s, argPtr)).toBe(1);
  });

  it("match in slot 6 (ultimo)", () => {
    const s = emptyGameState();
    const argPtr = 0x401e00;
    writeU32(s, argPtr + ARG_ID_LONG_OFF, 0xfeedface);
    setActive(s, 6, 1);
    setSlotId(s, 6, 0xfeedface);
    expect(stringSlotMatch1730C(s, argPtr)).toBe(1);
  });

  it("nessun side-effect: workRam invariata dopo la chiamata", () => {
    const s = emptyGameState();
    const argPtr = 0x401e00;
    writeU32(s, argPtr + ARG_ID_LONG_OFF, 0x12345678);
    setActive(s, 2, 1);
    setSlotId(s, 2, 0x12345678);
    const before = new Uint8Array(s.workRam);
    stringSlotMatch1730C(s, argPtr);
    expect(s.workRam).toEqual(before);
  });

  it("ID = 0 con slot attivi che hanno ID 0 → match (no special-casing)", () => {
    const s = emptyGameState();
    const argPtr = 0x401e00;
    writeU32(s, argPtr + ARG_ID_LONG_OFF, 0);
    setActive(s, 1, 1);
    setSlotId(s, 1, 0);
    expect(stringSlotMatch1730C(s, argPtr)).toBe(1);
  });

  it("scan termina al primo match (slot 2 match → slot 5 con ID diverso non importa)", () => {
    const s = emptyGameState();
    const argPtr = 0x401e00;
    writeU32(s, argPtr + ARG_ID_LONG_OFF, 0x77777777);
    setActive(s, 2, 1);
    setSlotId(s, 2, 0x77777777);
    // Slot 5 attivo con ID malformato — non deve influire.
    setActive(s, 5, 1);
    setSlotId(s, 5, 0x99999999);
    expect(stringSlotMatch1730C(s, argPtr)).toBe(1);
  });
});
