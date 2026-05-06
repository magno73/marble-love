/**
 * Test clearPlayfieldStride (FUN_12186) — smoke tests sui rami principali.
 *
 * Bit-perfect verificato vs binary tramite `cli/src/test-clear-pf-stride-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  clearPlayfieldStride,
  PF_RAM_BASE_ADDR,
  STRIDE_START_ADDR,
  STRIDE_ENTRY_COUNT,
  STRIDE_BYTES,
  STRIDE_CLEAR_BYTES,
  STRIDE_SKIP_BYTES,
} from "../src/clear-pf-stride.js";

const PF_SIZE = 0x2000; // 8 KB PF RAM
const STRIDE_OFF = STRIDE_START_ADDR - PF_RAM_BASE_ADDR; // 6

function fillSentinel(buf: Uint8Array, value: number): void {
  buf.fill(value & 0xff);
}

describe("clearPlayfieldStride (FUN_12186)", () => {
  it("costanti coerenti col disasm", () => {
    expect(PF_RAM_BASE_ADDR).toBe(0xa00000);
    expect(STRIDE_START_ADDR).toBe(0xa00006);
    expect(STRIDE_ENTRY_COUNT).toBe(64); // outer dbf #0x3F → 64 iterazioni
    expect(STRIDE_BYTES).toBe(0x80); // 72 cleared + 56 skipped = 128
    expect(STRIDE_CLEAR_BYTES).toBe(72); // 18 long × 4 byte
    expect(STRIDE_SKIP_BYTES).toBe(0x38); // adda.l #0x38, A0
    expect(STRIDE_CLEAR_BYTES + STRIDE_SKIP_BYTES).toBe(STRIDE_BYTES);
  });

  it("preserva i primi 6 byte (offset < 0xA00006)", () => {
    const pf = new Uint8Array(PF_SIZE);
    fillSentinel(pf, 0xaa);
    clearPlayfieldStride(pf);
    for (let i = 0; i < STRIDE_OFF; i++) {
      expect(pf[i]).toBe(0xaa);
    }
  });

  it("azzera 72 byte all'inizio di ogni entry, preserva i successivi 56", () => {
    const pf = new Uint8Array(PF_SIZE);
    fillSentinel(pf, 0xff);
    clearPlayfieldStride(pf);

    for (let entry = 0; entry < STRIDE_ENTRY_COUNT; entry++) {
      const base = STRIDE_OFF + entry * STRIDE_BYTES;

      // Primi 72 byte = 0
      for (let j = 0; j < STRIDE_CLEAR_BYTES; j++) {
        const idx = base + j;
        if (idx >= PF_SIZE) break;
        expect(pf[idx]).toBe(0);
      }
      // Successivi 56 byte = 0xFF (preservati)
      for (let j = STRIDE_CLEAR_BYTES; j < STRIDE_BYTES; j++) {
        const idx = base + j;
        if (idx >= PF_SIZE) break;
        expect(pf[idx]).toBe(0xff);
      }
    }
  });

  it("non scrive oltre l'ultimo byte cleared (0xA01FCD)", () => {
    const pf = new Uint8Array(PF_SIZE);
    fillSentinel(pf, 0x5a);
    clearPlayfieldStride(pf);

    // Ultimo byte azzerato = 6 + 63*0x80 + 71 = 0x1FCD
    const lastClearedOff = STRIDE_OFF + (STRIDE_ENTRY_COUNT - 1) * STRIDE_BYTES + (STRIDE_CLEAR_BYTES - 1);
    expect(lastClearedOff).toBe(0x1fcd);
    expect(pf[lastClearedOff]).toBe(0);
    // I 50 byte successivi (0x1FCE..0x1FFF) restano 0x5A
    for (let i = lastClearedOff + 1; i < PF_SIZE; i++) {
      expect(pf[i]).toBe(0x5a);
    }
  });

  it("totale byte azzerati = 64 × 72 = 4608 (su buffer pre-fillato 0xFF)", () => {
    const pf = new Uint8Array(PF_SIZE);
    fillSentinel(pf, 0xff);
    clearPlayfieldStride(pf);
    let zeros = 0;
    for (let i = 0; i < PF_SIZE; i++) {
      if (pf[i] === 0) zeros++;
    }
    expect(zeros).toBe(STRIDE_ENTRY_COUNT * STRIDE_CLEAR_BYTES);
    expect(zeros).toBe(4608);
  });

  it("idempotente: chiamare due volte == una volta", () => {
    const a = new Uint8Array(PF_SIZE);
    fillSentinel(a, 0x33);
    clearPlayfieldStride(a);

    const b = new Uint8Array(PF_SIZE);
    fillSentinel(b, 0x33);
    clearPlayfieldStride(b);
    clearPlayfieldStride(b);

    expect(b).toEqual(a);
  });

  it("buffer più corto: bound-safe, no overflow", () => {
    // Buffer da 100 byte: solo entry 0 partial.
    const small = new Uint8Array(100);
    fillSentinel(small, 0xc7);
    clearPlayfieldStride(small);

    // Primi 6 byte preservati
    for (let i = 0; i < STRIDE_OFF; i++) {
      expect(small[i]).toBe(0xc7);
    }
    // 6..77 azzerati (72 byte di entry 0)
    for (let i = STRIDE_OFF; i < STRIDE_OFF + STRIDE_CLEAR_BYTES && i < 100; i++) {
      expect(small[i]).toBe(0);
    }
    // 78..99 (skip region entry 0) preservati
    for (let i = STRIDE_OFF + STRIDE_CLEAR_BYTES; i < 100; i++) {
      expect(small[i]).toBe(0xc7);
    }
  });

  it("buffer già a zero: no-op effective (resta tutto 0)", () => {
    const pf = new Uint8Array(PF_SIZE);
    clearPlayfieldStride(pf);
    for (let i = 0; i < PF_SIZE; i++) {
      expect(pf[i]).toBe(0);
    }
  });
});
