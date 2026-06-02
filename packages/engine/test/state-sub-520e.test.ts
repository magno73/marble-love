/**
 * state-sub-520e.test.ts — smoke test per stateSub520E (FUN_520E).
 *
 * Bit-perfect parity verificata vs binary in `test-state-sub-520e-parity.ts`.
 * Qui copriamo i path principali and le edge case sui side effect of workRam.
 */

import { describe, it, expect } from "vitest";
import {
  stateSub520E,
  fun523AInner,
  STATUS_FLAGS_OFF,
  FIXED_OR_MASK,
  PRODUCTION_STACK_D0,
} from "../src/state-sub-520e.js";
import { emptyGameState } from "../src/state.js";

function readStatusFlags(workRam: Uint8Array): number {
  return (
    (((workRam[STATUS_FLAGS_OFF] ?? 0) << 24) |
      ((workRam[STATUS_FLAGS_OFF + 1] ?? 0) << 16) |
      ((workRam[STATUS_FLAGS_OFF + 2] ?? 0) << 8) |
      (workRam[STATUS_FLAGS_OFF + 3] ?? 0)) >>>
    0
  );
}

describe("fun523AInner (FUN_523A inner) — smoke", () => {
  it("D0 = 0xFF02 (byte=4 from the byte_at_A2_9 path) → bit 2 (shift = 0xFF00 & 0x3F = 0)... wait", () => {
    // 0xFF02 - 2 = 0xFF00 → & 0x3F = 0 → bit 0
    const s = emptyGameState();
    fun523AInner(s, 0xff02);
    expect(readStatusFlags(s.workRam)).toBe(0x00000001);
  });

  it("D0 = 0xFF06 (byte=6) → shift = (0xFF04) & 0x3F = 4 → bit 4", () => {
    const s = emptyGameState();
    fun523AInner(s, 0xff06);
    expect(readStatusFlags(s.workRam)).toBe(0x00000010);
  });

  it("D0 = 0x00F00001 (production saved A3) → shift = (0x00EFFFFF) & 0x3F = 0x3F = 63 → no-op", () => {
    const s = emptyGameState();
    s.workRam[STATUS_FLAGS_OFF] = 0xab;
    s.workRam[STATUS_FLAGS_OFF + 1] = 0xcd;
    s.workRam[STATUS_FLAGS_OFF + 2] = 0xef;
    s.workRam[STATUS_FLAGS_OFF + 3] = 0x12;
    fun523AInner(s, PRODUCTION_STACK_D0);
    // No-op: status flags intact (shift ≥ 32 → D1 = 0 → OR no-op)
    expect(readStatusFlags(s.workRam)).toBe(0xabcdef12);
  });
});

describe("stateSub520E (FUN_520E) — smoke", () => {
  it("clear basic: A2 fissato, byte_at_A2+9 = 6 → bits {0,1} fissi + bit 4 (da byte=6)", () => {
    const s = emptyGameState();
    const a2 = 0x401000;
    const off = a2 - 0x400000;

    // Pre-fill region that must be cleared + byte @ +9 (not cleared).
    for (let i = 0; i <= 8; i++) s.workRam[off + i] = 0xaa;
    s.workRam[off + 9] = 0x06; // byte_at_A2+9 = 6 → fun523A(0xFF06) → bit 4
    for (let i = 0; i <= 0xd; i++) {
      if (i === 9) continue;
    }
    s.workRam[off + 0x0a] = 0xbb; // NOT cleared
    s.workRam[off + 0x0b] = 0xcc; // NOT cleared
    s.workRam[off + 0x0c] = 0xdd; // NOT cleared
    s.workRam[off + 0x0d] = 0xee; // NOT cleared
    for (let i = 0; i <= 4; i++) s.workRam[off + 0xe + i] = 0xaa;
    s.workRam[off + 0x13] = 0xff; // NOT cleared (gap between phase 2 and phase 3)
    for (let i = 0; i <= 9; i++) s.workRam[off + 0x14 + i] = 0xaa;
    // Sentinels:
    s.workRam[off - 1] = 0xee;
    s.workRam[off + 0x1e] = 0xff;

    // stackD0 = produzione default (0x00F00001) → no-op on the second OR
    stateSub520E(s, a2);

    // Phase 1: A2+0..A2+8 cleared
    for (let i = 0; i <= 8; i++) expect(s.workRam[off + i]).toBe(0);
    // A2+9 not cleared (preserves original 0x06).
    expect(s.workRam[off + 9]).toBe(0x06);
    // A2+0xA..0xD NOT cleared
    expect(s.workRam[off + 0x0a]).toBe(0xbb);
    expect(s.workRam[off + 0x0b]).toBe(0xcc);
    expect(s.workRam[off + 0x0c]).toBe(0xdd);
    expect(s.workRam[off + 0x0d]).toBe(0xee);
    // Phase 2: A2+0xE..A2+0x12 cleared
    for (let i = 0; i <= 4; i++) expect(s.workRam[off + 0xe + i]).toBe(0);
    // A2+0x13 NOT cleared
    expect(s.workRam[off + 0x13]).toBe(0xff);
    // Phase 3: A2+0x14..A2+0x1D cleared
    for (let i = 0; i <= 9; i++) expect(s.workRam[off + 0x14 + i]).toBe(0);
    // Sentinels intact
    expect(s.workRam[off - 1]).toBe(0xee);
    expect(s.workRam[off + 0x1e]).toBe(0xff);

    // Status flags: bits {0,1} (mask 3) | bit 4 (da byte=6) | no-op (stackD0=prod)
    // = 0x3 | 0x10 = 0x13
    expect(readStatusFlags(s.workRam)).toBe(0x00000013);
  });

  it("status flags: byte_at_A2+9 = 0x21 (33) → shift 31 → bit 31 set", () => {
    const s = emptyGameState();
    const a2 = 0x401200;
    const off = a2 - 0x400000;

    s.workRam[off + 9] = 0x21; // 33 - 2 = 31 → bit 31

    stateSub520E(s, a2);

    // bits 0, 1 (fixed) + bit 31 (top bit, da byte=33)
    // = 0x80000003
    expect(readStatusFlags(s.workRam)).toBe(0x80000003);
  });

  it("status flags: byte_at_A2+9 = 0x22 (34) → shift 32 → asl.l no-op (bit beyond 31)", () => {
    const s = emptyGameState();
    const a2 = 0x401400;
    const off = a2 - 0x400000;

    s.workRam[off + 9] = 0x22; // 34 - 2 = 32 → asl.l ≥ 32 → 0 → no-op

    stateSub520E(s, a2);

    // Solo bits 0,1 fissi (no-op on the byte path); production stackD0 = no-op
    expect(readStatusFlags(s.workRam)).toBe(0x00000003);
  });

  it("OR cumulativo: status flags pre-esistenti are OR-ed (non sovrascritti)", () => {
    const s = emptyGameState();
    const a2 = 0x401000;
    const off = a2 - 0x400000;

    s.workRam[off + 9] = 0x06; // bit 4

    // Pre-set bit 7 and bit 30
    s.workRam[STATUS_FLAGS_OFF + 0] = 0x40; // bit 30
    s.workRam[STATUS_FLAGS_OFF + 3] = 0x80; // bit 7

    stateSub520E(s, a2);

    // Pre-set | mask fixed 3 | bit 4 = 0x40000080 | 3 | 0x10 = 0x40000093
    expect(readStatusFlags(s.workRam)).toBe(0x40000093);
  });

  it("stackD0 esplicito: 0x00000006 → bit 4 OR-ed (beyond ai bits 0,1,4 from the byte path)", () => {
    const s = emptyGameState();
    const a2 = 0x401600;
    const off = a2 - 0x400000;

    s.workRam[off + 9] = 0x07; // 7 - 2 = 5 → bit 5

    // stackD0 = 6 → fun523AInner(6) → 6-2=4 → bit 4
    stateSub520E(s, a2, 0x00000006);

    // bits {0,1} | bit 5 | bit 4 = 0x3 | 0x20 | 0x10 = 0x33
    expect(readStatusFlags(s.workRam)).toBe(0x00000033);
  });

  it("FIXED_OR_MASK exposed = 3 (bits 0,1)", () => {
    expect(FIXED_OR_MASK).toBe(3);
  });

  it("workRam clear strictly locale ad A2 (no leak su altre regioni)", () => {
    const s = emptyGameState();
    s.workRam.fill(0x5a);
    // Reset status flags long
    s.workRam[STATUS_FLAGS_OFF + 0] = 0;
    s.workRam[STATUS_FLAGS_OFF + 1] = 0;
    s.workRam[STATUS_FLAGS_OFF + 2] = 0;
    s.workRam[STATUS_FLAGS_OFF + 3] = 0;
    // Sets byte @ A2+9 sapientemente
    const a2 = 0x401000;
    const off = a2 - 0x400000;
    s.workRam[off + 9] = 0x06;

    stateSub520E(s, a2);

    // Range clearati
    for (let i = 0; i <= 8; i++) expect(s.workRam[off + i]).toBe(0);
    for (let i = 0; i <= 4; i++) expect(s.workRam[off + 0xe + i]).toBe(0);
    for (let i = 0; i <= 9; i++) expect(s.workRam[off + 0x14 + i]).toBe(0);
    // Byte outside range → intact
    expect(s.workRam[0x100]).toBe(0x5a);
    expect(s.workRam[off - 1]).toBe(0x5a);
    expect(s.workRam[off + 0x1e]).toBe(0x5a);
    // Status flags = 0x3 | 0x10 = 0x13
    expect(readStatusFlags(s.workRam)).toBe(0x00000013);
  });
});
