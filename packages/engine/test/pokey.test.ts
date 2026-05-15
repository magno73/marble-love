/**
 * pokey.test.ts — Phase 6 register-state parity smoke.
 *
 * Intent: il sound driver Marble scrive sui 4 canali POKEY per produrre il
 * rumble della biglia. In V2 verifichiamo che il byte stored nel writeRegs
 * shadow matcha esattamente il byte scritto dal CPU 6502 (= MAME shadow). La
 * generazione waveform/LFSR vera e' V3.
 */

import { describe, it, expect } from "vitest";
import { as_u8 } from "../src/wrap.js";
import {
  createPOKEY, pokeyWrite, pokeyRead, pokeyReset,
} from "../src/audio/pokey.js";

describe("POKEY register file", () => {
  it("init pulita: writeRegs all 0", () => {
    const pk = createPOKEY();
    expect(pk.writeRegs.length).toBe(16);
    expect(Array.from(pk.writeRegs).every((b) => b === 0)).toBe(true);
  });

  it("write singolo: byte stora nel slot corretto", () => {
    const pk = createPOKEY();
    pokeyWrite(pk, as_u8(0x00), as_u8(0x40));  // AUDF1
    expect(pk.writeRegs[0x00]).toBe(0x40);
    expect(pk.writeRegs[0x01]).toBe(0);
  });

  it("write 4 channels marble rumble (pattern realistico)", () => {
    const pk = createPOKEY();
    // Marble sound driver pattern (approssimato per V1 mailbox tracing):
    const seq: Array<[number, number]> = [
      [0x00, 0xA0],  // AUDF1 = freq mid
      [0x01, 0xA8],  // AUDC1 = vol 8 + dist 5 (noise)
      [0x02, 0x60],  // AUDF2
      [0x03, 0xA6],
      [0x04, 0x40],  // AUDF3
      [0x05, 0xA4],
      [0x06, 0x20],  // AUDF4
      [0x07, 0xA2],
      [0x08, 0x00],  // AUDCTL: default clock 64KHz
      [0x0E, 0x00],  // IRQEN: tutto disabilitato
      [0x0F, 0x03],  // SKCTL: enable keyboard scan + 2-tone off
    ];
    for (const [addr, data] of seq) {
      pokeyWrite(pk, as_u8(addr), as_u8(data));
    }
    expect(pk.writeRegs[0x00]).toBe(0xA0);
    expect(pk.writeRegs[0x01]).toBe(0xA8);
    expect(pk.writeRegs[0x07]).toBe(0xA2);
    expect(pk.writeRegs[0x08]).toBe(0x00);
    expect(pk.writeRegs[0x0E]).toBe(0x00);
    expect(pk.writeRegs[0x0F]).toBe(0x03);
  });

  it("wrap addr 4-bit: $10 → $00", () => {
    const pk = createPOKEY();
    pokeyWrite(pk, as_u8(0x10), as_u8(0xAA));
    expect(pk.writeRegs[0x00]).toBe(0xAA);
    expect(pk.writeRegs.length).toBe(16);
  });
});

describe("POKEY read stubs (V2: sentinel constant)", () => {
  function pk() { return createPOKEY(); }

  it("POT0..POT7 = 0 (paddle non usati in marble)", () => {
    for (let i = 0; i < 8; i++) {
      expect(pokeyRead(pk(), as_u8(i)) as number).toBe(0);
    }
  });

  it("ALLPOT = 0xFF (tutti pot 'done', no scan in corso)", () => {
    expect(pokeyRead(pk(), as_u8(0x08)) as number).toBe(0xff);
  });

  it("KBCODE = 0, RANDOM = 0 (V3 LFSR not yet)", () => {
    expect(pokeyRead(pk(), as_u8(0x09)) as number).toBe(0);
    expect(pokeyRead(pk(), as_u8(0x0a)) as number).toBe(0);
  });

  it("IRQST = 0xFF (no IRQ pending, active-low)", () => {
    expect(pokeyRead(pk(), as_u8(0x0d)) as number).toBe(0xff);
  });

  it("SKSTAT = 0xFF (idle serial)", () => {
    expect(pokeyRead(pk(), as_u8(0x0f)) as number).toBe(0xff);
  });

  it("open bus reg ($0C, $0E) → 0xFF", () => {
    expect(pokeyRead(pk(), as_u8(0x0c)) as number).toBe(0xff);
    expect(pokeyRead(pk(), as_u8(0x0e)) as number).toBe(0xff);
  });
});

describe("POKEY reset", () => {
  it("reset pulisce writeRegs", () => {
    const pk = createPOKEY();
    pokeyWrite(pk, as_u8(0x05), as_u8(0xFF));
    pokeyWrite(pk, as_u8(0x08), as_u8(0xAB));
    pokeyReset(pk);
    expect(Array.from(pk.writeRegs).every((b) => b === 0)).toBe(true);
  });
});
