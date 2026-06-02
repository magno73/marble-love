/**
 * Test clearPlayfieldStride (FUN_12186) — smoke tests on the main branches.
 *
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
    expect(STRIDE_ENTRY_COUNT).toBe(64);
    expect(STRIDE_BYTES).toBe(0x80); // 72 cleared + 56 skipped = 128
    expect(STRIDE_CLEAR_BYTES).toBe(72); // 18 long × 4 byte
    expect(STRIDE_SKIP_BYTES).toBe(0x38); // adda.l #0x38, A0
    expect(STRIDE_CLEAR_BYTES + STRIDE_SKIP_BYTES).toBe(STRIDE_BYTES);
  });

  it("preserva i first 6 byte (offset < 0xA00006)", () => {
    const pf = new Uint8Array(PF_SIZE);
    fillSentinel(pf, 0xaa);
    clearPlayfieldStride(pf);
    for (let i = 0; i < STRIDE_OFF; i++) {
      expect(pf[i]).toBe(0xaa);
    }
  });

  it("azzera 72 byte to the inizio of each entry, preserva i successivi 56", () => {
    const pf = new Uint8Array(PF_SIZE);
    fillSentinel(pf, 0xff);
    clearPlayfieldStride(pf);

    for (let entry = 0; entry < STRIDE_ENTRY_COUNT; entry++) {
      const base = STRIDE_OFF + entry * STRIDE_BYTES;

      // First 72 bytes = 0
      for (let j = 0; j < STRIDE_CLEAR_BYTES; j++) {
        const idx = base + j;
        if (idx >= PF_SIZE) break;
        expect(pf[idx]).toBe(0);
      }
      // Next 56 bytes = 0xFF (preserved)
      for (let j = STRIDE_CLEAR_BYTES; j < STRIDE_BYTES; j++) {
        const idx = base + j;
        if (idx >= PF_SIZE) break;
        expect(pf[idx]).toBe(0xff);
      }
    }
  });

  it("non writes beyond l'last byte cleared (0xA01FCD)", () => {
    const pf = new Uint8Array(PF_SIZE);
    fillSentinel(pf, 0x5a);
    clearPlayfieldStride(pf);

    const lastClearedOff = STRIDE_OFF + (STRIDE_ENTRY_COUNT - 1) * STRIDE_BYTES + (STRIDE_CLEAR_BYTES - 1);
    expect(lastClearedOff).toBe(0x1fcd);
    expect(pf[lastClearedOff]).toBe(0);
    // The next 50 bytes (0x1FCE..0x1FFF) stay 0x5A
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

  it("idempotente: call twice == una time", () => {
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
    // 100-byte buffer: only entry 0 is partial.
    const small = new Uint8Array(100);
    fillSentinel(small, 0xc7);
    clearPlayfieldStride(small);

    // First 6 bytes preserved
    for (let i = 0; i < STRIDE_OFF; i++) {
      expect(small[i]).toBe(0xc7);
    }
    // 6..77 zeroed (72 bytes of entry 0).
    for (let i = STRIDE_OFF; i < STRIDE_OFF + STRIDE_CLEAR_BYTES && i < 100; i++) {
      expect(small[i]).toBe(0);
    }
    // 78..99 (skip region entry 0) preserved
    for (let i = STRIDE_OFF + STRIDE_CLEAR_BYTES; i < 100; i++) {
      expect(small[i]).toBe(0xc7);
    }
  });

  it("buffer already a zero: no-op effective (stays all 0)", () => {
    const pf = new Uint8Array(PF_SIZE);
    clearPlayfieldStride(pf);
    for (let i = 0; i < PF_SIZE; i++) {
      expect(pf[i]).toBe(0);
    }
  });
});
