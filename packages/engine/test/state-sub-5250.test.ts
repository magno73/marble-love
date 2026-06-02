/**
 * state-sub-5250.test.ts — smoke test per stateSub5250 (FUN_5250).
 *
 * Qui copriamo i path principali: OR su primary and secondary flags, idempotenza,
 */

import { describe, it, expect } from "vitest";
import {
  stateSub5250,
  PRIMARY_FLAGS_OFF,
  SECONDARY_FLAGS_OFF,
  PRIMARY_FLAGS_ADDR,
  SECONDARY_FLAGS_ADDR,
} from "../src/state-sub-5250.js";
import { emptyGameState } from "../src/state.js";

function readLongBE(workRam: Uint8Array, off: number): number {
  return (
    (((workRam[off] ?? 0) << 24) |
      ((workRam[off + 1] ?? 0) << 16) |
      ((workRam[off + 2] ?? 0) << 8) |
      (workRam[off + 3] ?? 0)) >>>
    0
  );
}

describe("stateSub5250 (FUN_5250) — smoke", () => {
  it("d1=0: both i long rimangono invariati (OR con 0 = no-op)", () => {
    const s = emptyGameState();
    s.workRam[PRIMARY_FLAGS_OFF]     = 0x12;
    s.workRam[PRIMARY_FLAGS_OFF + 1] = 0x34;
    s.workRam[PRIMARY_FLAGS_OFF + 2] = 0x56;
    s.workRam[PRIMARY_FLAGS_OFF + 3] = 0x78;
    s.workRam[SECONDARY_FLAGS_OFF]     = 0xab;
    s.workRam[SECONDARY_FLAGS_OFF + 1] = 0xcd;
    s.workRam[SECONDARY_FLAGS_OFF + 2] = 0xef;
    s.workRam[SECONDARY_FLAGS_OFF + 3] = 0x00;

    stateSub5250(s, 0);

    expect(readLongBE(s.workRam, PRIMARY_FLAGS_OFF)).toBe(0x12345678);
    expect(readLongBE(s.workRam, SECONDARY_FLAGS_OFF)).toBe(0xabcdef00);
  });

  it("d1=0xFFFFFFFF con both a 0: setta all i bit in primary and secondary", () => {
    const s = emptyGameState();

    stateSub5250(s, 0xffffffff);

    expect(readLongBE(s.workRam, PRIMARY_FLAGS_OFF)).toBe(0xffffffff);
    expect(readLongBE(s.workRam, SECONDARY_FLAGS_OFF)).toBe(0xffffffff);
  });

  it("d1=0x00000001: setta solo il bit 0 in both i long", () => {
    const s = emptyGameState();

    stateSub5250(s, 0x00000001);

    expect(readLongBE(s.workRam, PRIMARY_FLAGS_OFF)).toBe(0x00000001);
    expect(readLongBE(s.workRam, SECONDARY_FLAGS_OFF)).toBe(0x00000001);
  });

  it("d1=0x80000000: setta solo il bit 31 (MSB) in both i long", () => {
    const s = emptyGameState();

    stateSub5250(s, 0x80000000);

    expect(readLongBE(s.workRam, PRIMARY_FLAGS_OFF)).toBe(0x80000000);
    expect(readLongBE(s.workRam, SECONDARY_FLAGS_OFF)).toBe(0x80000000);
  });

  it("OR cumulativo: bit pre-esistenti are preservati (non sovrascritti)", () => {
    const s = emptyGameState();
    // pre-set bit 8 in primary, bit 16 in secondary
    s.workRam[PRIMARY_FLAGS_OFF + 2] = 0x01; // bit 8
    s.workRam[SECONDARY_FLAGS_OFF + 1] = 0x01; // bit 16

    stateSub5250(s, 0x00000001); // OR bit 0

    // primary: bit 8 | bit 0 = 0x00000101
    expect(readLongBE(s.workRam, PRIMARY_FLAGS_OFF)).toBe(0x00000101);
    // secondary: bit 16 | bit 0 = 0x00010001
    expect(readLongBE(s.workRam, SECONDARY_FLAGS_OFF)).toBe(0x00010001);
  });

  it("interleaved bits: d1=0xAAAAAAAA | primary=0x55555555 → 0xFFFFFFFF", () => {
    const s = emptyGameState();
    s.workRam[PRIMARY_FLAGS_OFF]     = 0x55;
    s.workRam[PRIMARY_FLAGS_OFF + 1] = 0x55;
    s.workRam[PRIMARY_FLAGS_OFF + 2] = 0x55;
    s.workRam[PRIMARY_FLAGS_OFF + 3] = 0x55;
    s.workRam[SECONDARY_FLAGS_OFF]     = 0x55;
    s.workRam[SECONDARY_FLAGS_OFF + 1] = 0x55;
    s.workRam[SECONDARY_FLAGS_OFF + 2] = 0x55;
    s.workRam[SECONDARY_FLAGS_OFF + 3] = 0x55;

    stateSub5250(s, 0xaaaaaaaa);

    expect(readLongBE(s.workRam, PRIMARY_FLAGS_OFF)).toBe(0xffffffff);
    expect(readLongBE(s.workRam, SECONDARY_FLAGS_OFF)).toBe(0xffffffff);
  });

  it("idempotenza: call twice con lo same d1 dà lo same risultato of the first", () => {
    const s = emptyGameState();

    stateSub5250(s, 0x12345678);
    const primary1   = readLongBE(s.workRam, PRIMARY_FLAGS_OFF);
    const secondary1 = readLongBE(s.workRam, SECONDARY_FLAGS_OFF);

    stateSub5250(s, 0x12345678);
    const primary2   = readLongBE(s.workRam, PRIMARY_FLAGS_OFF);
    const secondary2 = readLongBE(s.workRam, SECONDARY_FLAGS_OFF);

    expect(primary2).toBe(primary1);
    expect(secondary2).toBe(secondary1);
  });

  it("OR non tocca altrthe bytes of the workRam (no side-effect outside from the due long)", () => {
    const s = emptyGameState();
    s.workRam.fill(0x5a);
    // Zero out only the 8 bytes of the two long targets.
    for (let i = 0; i < 4; i++) {
      s.workRam[PRIMARY_FLAGS_OFF + i]   = 0;
      s.workRam[SECONDARY_FLAGS_OFF + i] = 0;
    }

    stateSub5250(s, 0xdeadbeef);

    // I due long aggiornati correttamente
    expect(readLongBE(s.workRam, PRIMARY_FLAGS_OFF)).toBe(0xdeadbeef);
    expect(readLongBE(s.workRam, SECONDARY_FLAGS_OFF)).toBe(0xdeadbeef);

    // Byte adiacenti intact
    expect(s.workRam[PRIMARY_FLAGS_OFF - 1]).toBe(0x5a);
    expect(s.workRam[PRIMARY_FLAGS_OFF + 4]).toBe(0x5a);
    expect(s.workRam[SECONDARY_FLAGS_OFF - 1]).toBe(0x5a);
    expect(s.workRam[SECONDARY_FLAGS_OFF + 4]).toBe(0x5a);
    expect(s.workRam[0x0100]).toBe(0x5a);
  });

  it("costanti esportate corrette (indirizzi and offset)", () => {
    expect(PRIMARY_FLAGS_OFF).toBe(0x1f5e);
    expect(SECONDARY_FLAGS_OFF).toBe(0x1f76);
    expect(PRIMARY_FLAGS_ADDR).toBe(0x00401f5e);
    expect(SECONDARY_FLAGS_ADDR).toBe(0x00401f76);
  });
});
