/**
 * script-slot-claim.test.ts — corner cases of `claimScriptSlot` (FUN_12D46).
 *
 * Bit-perfect parity validata vs binary in
 * `packages/cli/src/test-script-slot-claim-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { claimScriptSlot } from "../src/script-slot-claim.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x400000;
const TABLE_BASE = 0x1f016;

/** Helper: sets the 25 canonical pointers in ROM table @0x1F016 (slot @0x400A9C stride 0x56). */
function setupCanonicalRomTable(rom: RomImage): void {
  for (let i = 0; i < 25; i++) {
    const slotAddr = 0x400a9c + i * 0x56;
    const off = TABLE_BASE + i * 4;
    rom.program[off] = (slotAddr >>> 24) & 0xff;
    rom.program[off + 1] = (slotAddr >>> 16) & 0xff;
    rom.program[off + 2] = (slotAddr >>> 8) & 0xff;
    rom.program[off + 3] = slotAddr & 0xff;
  }
}

describe("claimScriptSlot (FUN_00012D46)", () => {
  it("nessuno slot free (all +0x18 != 0) → returns 0xFFFFFFFF, niente side effect", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);

    // Marca all the slot +0x18 = 1 (occupied).
    for (let i = 0; i < 25; i++) {
      const slotAddr = 0x400a9c + i * 0x56;
      s.workRam[(slotAddr - WORK_RAM_BASE) + 0x18] = 1;
    }

    const before = new Uint8Array(s.workRam);
    const r = claimScriptSlot(s, rom, 0x1d854);
    expect(r >>> 0).toBe(0xffffffff);
    expect(s.workRam).toEqual(before);
  });

  it("first slot free (idx 0) → returns 0, writes script ptr + state byte + mark", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);

    const r = claimScriptSlot(s, rom, 0x0001d854);
    expect(r).toBe(0);

    // Expected slot: the first with +0x18 == 0. All empty -> idx 0 = 0x400A9C.
    const slotOff = 0x400a9c - WORK_RAM_BASE;
    expect(s.workRam[slotOff + 0x18]).toBe(0x01);
    expect(s.workRam[slotOff + 0x1a]).toBe(0x03);
    // Long arg @ +0x3A in big-endian: 0x0001D854
    expect(s.workRam[slotOff + 0x3a]).toBe(0x00);
    expect(s.workRam[slotOff + 0x3b]).toBe(0x01);
    expect(s.workRam[slotOff + 0x3c]).toBe(0xd8);
    expect(s.workRam[slotOff + 0x3d]).toBe(0x54);
  });

  it("slot[0..2] occupied, slot[3] free → bind on the third slot", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);

    for (let i = 0; i < 3; i++) {
      const slotAddr = 0x400a9c + i * 0x56;
      s.workRam[(slotAddr - WORK_RAM_BASE) + 0x18] = 1;
    }

    const r = claimScriptSlot(s, rom, 0xdeadbeef);
    expect(r).toBe(0);

    // Expected slot: idx 3 -> 0x400A9C + 3*0x56 = 0x400BF6... wait, stride 0x56 -> 0x400A9C + 0x102 = 0x400B9E.
    const slotAddr = 0x400a9c + 3 * 0x56;
    const slotOff = slotAddr - WORK_RAM_BASE;
    expect(s.workRam[slotOff + 0x18]).toBe(0x01);
    expect(s.workRam[slotOff + 0x1a]).toBe(0x03);
    expect(s.workRam[slotOff + 0x3a]).toBe(0xde);
    expect(s.workRam[slotOff + 0x3b]).toBe(0xad);
    expect(s.workRam[slotOff + 0x3c]).toBe(0xbe);
    expect(s.workRam[slotOff + 0x3d]).toBe(0xef);

    // Slot precedenti NOT modificati in the field 0x1A/0x3A.
    const slot0 = 0x400a9c - WORK_RAM_BASE;
    expect(s.workRam[slot0 + 0x1a]).toBe(0);
    expect(s.workRam[slot0 + 0x3a]).toBe(0);
  });

  it("argPtr = 0 → script ptr scritto as long zero", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);

    const r = claimScriptSlot(s, rom, 0);
    expect(r).toBe(0);

    const slotOff = 0x400a9c - WORK_RAM_BASE;
    expect(s.workRam[slotOff + 0x3a]).toBe(0);
    expect(s.workRam[slotOff + 0x3b]).toBe(0);
    expect(s.workRam[slotOff + 0x3c]).toBe(0);
    expect(s.workRam[slotOff + 0x3d]).toBe(0);
    expect(s.workRam[slotOff + 0x18]).toBe(0x01);
  });

  it("findFirstFreeSlot semantica EARLY-EXIT: se idx 0 free non scansiona beyond", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setupCanonicalRomTable(rom);

    // All empty except for a forced non-zero value in slot 1 +0x18, to
    // prove it is not touched; early exit takes slot 0).
    const slot1 = 0x400a9c + 1 * 0x56;
    s.workRam[(slot1 - WORK_RAM_BASE) + 0x18] = 0x99;

    const r = claimScriptSlot(s, rom, 0x12345678);
    expect(r).toBe(0);

    const slot0Off = 0x400a9c - WORK_RAM_BASE;
    expect(s.workRam[slot0Off + 0x18]).toBe(0x01);
    expect(s.workRam[slot0Off + 0x3a]).toBe(0x12);
    expect(s.workRam[slot0Off + 0x3b]).toBe(0x34);
    expect(s.workRam[slot0Off + 0x3c]).toBe(0x56);
    expect(s.workRam[slot0Off + 0x3d]).toBe(0x78);

    // slot1 +0x18 unchanged (findFirstFreeSlot early exit).
    expect(s.workRam[(slot1 - WORK_RAM_BASE) + 0x18]).toBe(0x99);
  });
});
