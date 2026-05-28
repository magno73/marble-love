/**
 * mo-grid-init-2404.test.ts — smoke + corner case di FUN_2404.
 *
 * Validate bit-perfect behavior without requiring the original binary:
 *   1. A production-style case (arg1 = 0): writes 56 slots to bank 0, MMIO = 0x0000.
 *   2. A non-zero case (arg1 = 3): bank offset = 0x600, MMIO = 0x18, code wrap.
 *   3. An edge case (arg1 = 0x10000): MMIO long shift wrap.
 */

import { describe, it, expect } from "vitest";
import {
  moGridInit2404,
  MMIO_AV_CONTROL_ADDR,
  TABLE_Y_ROM_ADDR,
  TABLE_X_ROM_ADDR,
  ROM_CODE_BIAS_ADDR,
  NUM_SLOTS,
  MO_BANK_SIZE,
  MO_FIELD_Y_OFF,
  MO_FIELD_CODE_OFF,
  MO_FIELD_X_OFF,
  MO_FIELD_LINK_OFF,
} from "../src/mo-grid-init-2404.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

/** Builds a minimal ROM with only the fields FUN_2404 reads:
 *   - Y table @ 0x2468 (56 BE words)
 *   - X table @ 0x24D8 (56 BE words)
 *   - word code-bias @ 0x1006A
 * All remaining bytes are zero. The tables are real values from the Marble ROM. */
function makeRomFixture() {
  const rom = emptyRomImage();

  // Tabella Y reale: 16× 0x00C8, 16× 0x00A0, 16× 0x0078, 8× 0x0050
  const yTable: number[] = [];
  for (let i = 0; i < 16; i++) yTable.push(0x00c8);
  for (let i = 0; i < 16; i++) yTable.push(0x00a0);
  for (let i = 0; i < 16; i++) yTable.push(0x0078);
  for (let i = 0; i < 8; i++) yTable.push(0x0050);
  for (let i = 0; i < NUM_SLOTS; i++) {
    rom.program[TABLE_Y_ROM_ADDR + i * 2] = (yTable[i]! >>> 8) & 0xff;
    rom.program[TABLE_Y_ROM_ADDR + i * 2 + 1] = yTable[i]! & 0xff;
  }

  // Real X table: 4x sequence [0x008,0x018,...,0x100] (16 elems, last truncated to 8).
  const xRow = [
    0x008, 0x018, 0x028, 0x038, 0x048, 0x058, 0x068, 0x078,
    0x090, 0x0a0, 0x0b0, 0x0c0, 0x0d0, 0x0e0, 0x0f0, 0x100,
  ];
  const xTable: number[] = [];
  for (let r = 0; r < 3; r++) for (const x of xRow) xTable.push(x);
  for (let i = 0; i < 8; i++) xTable.push(xRow[i]!);
  for (let i = 0; i < NUM_SLOTS; i++) {
    rom.program[TABLE_X_ROM_ADDR + i * 2] = (xTable[i]! >>> 8) & 0xff;
    rom.program[TABLE_X_ROM_ADDR + i * 2 + 1] = xTable[i]! & 0xff;
  }

  // Code bias word @ 0x1006A = 0x0002 (real Marble ROM value).
  rom.program[ROM_CODE_BIAS_ADDR] = 0x00;
  rom.program[ROM_CODE_BIAS_ADDR + 1] = 0x02;

  return { rom, yTable, xTable };
}

function readWordBE(buf: Uint8Array, off: number): number {
  return ((buf[off]! << 8) | buf[off + 1]!) & 0xffff;
}

describe("moGridInit2404 (FUN_2404)", () => {
  it("arg1=0: bank 0, MMIO=0, scrive 56 slot, code=0x0002, link=1..56", () => {
    const s = emptyGameState();
    const { rom, yTable, xTable } = makeRomFixture();

    const writes: Array<{ addr: number; value: number }> = [];
    moGridInit2404(s, rom, 0, {
      onMmioWrite: (addr, value) => writes.push({ addr, value }),
    });

    // A single MMIO write, value = arg1<<3 = 0.
    expect(writes).toEqual([{ addr: MMIO_AV_CONTROL_ADDR, value: 0x0000 }]);

    // Bank offset = arg1<<9 = 0. Tutti gli slot in spriteRam[0..0x1EF].
    for (let i = 0; i < NUM_SLOTS; i++) {
      const slotPos = i * 2;
      const tableIdx = NUM_SLOTS - 1 - i; // index decrescente

      // Y = (TABLE_Y[tableIdx] << 5) & 0xFFFF
      const expectedY = (yTable[tableIdx]! << 5) & 0xffff;
      expect(readWordBE(s.spriteRam, slotPos + MO_FIELD_Y_OFF)).toBe(expectedY);

      // X = ((TABLE_X[tableIdx] + 0x10) << 5) & 0xFFFF
      const expectedX = (((xTable[tableIdx]! + 0x10) & 0xffff) << 5) & 0xffff;
      expect(readWordBE(s.spriteRam, slotPos + MO_FIELD_X_OFF)).toBe(expectedX);

      // code = (arg1 + 0x0002) & 0xFFFF = 0x0002
      expect(readWordBE(s.spriteRam, slotPos + MO_FIELD_CODE_OFF)).toBe(0x0002);

      // link = i+1 (1..56)
      expect(readWordBE(s.spriteRam, slotPos + MO_FIELD_LINK_OFF)).toBe(i + 1);
    }

    // Bytes oltre il bank (0x1F0..0xFFF) restano 0.
    for (let off = MO_BANK_SIZE; off < s.spriteRam.length; off++) {
      expect(s.spriteRam[off]).toBe(0);
    }
  });

  it("arg1=3: bank offset 0x600, MMIO=0x18, code=0x0005", () => {
    const s = emptyGameState();
    const { rom, yTable, xTable } = makeRomFixture();

    const writes: Array<{ addr: number; value: number }> = [];
    moGridInit2404(s, rom, 3, {
      onMmioWrite: (addr, value) => writes.push({ addr, value }),
    });

    // MMIO = (3 << 3) = 0x18.
    expect(writes).toEqual([{ addr: MMIO_AV_CONTROL_ADDR, value: 0x0018 }]);

    // Bank offset = 3 << 9 = 0x600.
    const bankOff = 0x600;

    // Previous bank (0..0x5FF) not touched.
    for (let off = 0; off < bankOff; off++) {
      expect(s.spriteRam[off]).toBe(0);
    }

    // Slot in bank 3:
    //   code = (3 + 2) & 0xFFFF = 0x0005
    //   link = i+1
    //   Y/X as before, but at bankOff offset.
    for (let i = 0; i < NUM_SLOTS; i++) {
      const slotPos = bankOff + i * 2;
      const tableIdx = NUM_SLOTS - 1 - i;

      expect(readWordBE(s.spriteRam, slotPos + MO_FIELD_Y_OFF)).toBe(
        (yTable[tableIdx]! << 5) & 0xffff,
      );
      expect(readWordBE(s.spriteRam, slotPos + MO_FIELD_X_OFF)).toBe(
        (((xTable[tableIdx]! + 0x10) & 0xffff) << 5) & 0xffff,
      );
      expect(readWordBE(s.spriteRam, slotPos + MO_FIELD_CODE_OFF)).toBe(0x0005);
      expect(readWordBE(s.spriteRam, slotPos + MO_FIELD_LINK_OFF)).toBe(i + 1);
    }

    // Banks successivi (0x800..) restano 0.
    for (let off = bankOff + MO_BANK_SIZE; off < s.spriteRam.length; off++) {
      expect(s.spriteRam[off]).toBe(0);
    }
  });

  it("arg1=0x10000: long shift wrap, MMIO=0x0 (bit 16 esce dal word)", () => {
    const s = emptyGameState();
    const { rom } = makeRomFixture();

    const writes: Array<{ addr: number; value: number }> = [];
    // arg1 = 0x10000 → arg1<<3 = 0x80000 → low word = 0x0000 (i 16 bit alti escono).
    // arg1<<9 = 0x2000000 → bank offset assoluto enorme: cade fuori dai 4KB di
    // spriteRam. The TS replica must no-op out-of-bounds writes (not
    // crash).
    moGridInit2404(s, rom, 0x10000, {
      onMmioWrite: (addr, value) => writes.push({ addr, value }),
    });

    // MMIO = 0x80000 & 0xFFFF = 0x0000.
    expect(writes).toEqual([{ addr: MMIO_AV_CONTROL_ADDR, value: 0x0000 }]);

    // SpriteRam intera = 0 (tutti i write cadono fuori bound).
    for (let off = 0; off < s.spriteRam.length; off++) {
      expect(s.spriteRam[off]).toBe(0);
    }
  });

  it("arg1=1: code bias wrap mod 0x10000 con arg1=0xFFFE → code=0x0000", () => {
    const s = emptyGameState();
    const { rom } = makeRomFixture();

    const writes: Array<{ addr: number; value: number }> = [];
    // arg1 = 0xFFFE → arg1<<3 = 0x7FFF0 → MMIO low word = 0xFFF0
    // arg1<<9 = 0x1FFFC00 → fuori dai 4KB. spriteRam non scritta.
    // Ma proviamo arg1=0 per code wrap:
    // (0 + 0x0002) & 0xFFFF = 0x0002.
    // To test wrap, inject a different bias.
    rom.program[ROM_CODE_BIAS_ADDR] = 0xff;
    rom.program[ROM_CODE_BIAS_ADDR + 1] = 0xff; // bias = 0xFFFF

    moGridInit2404(s, rom, 1, {
      onMmioWrite: (addr, value) => writes.push({ addr, value }),
    });

    expect(writes).toEqual([{ addr: MMIO_AV_CONTROL_ADDR, value: 0x0008 }]);

    // code = (1 + 0xFFFF) & 0xFFFF = 0x0000.
    const bankOff = 1 << 9; // 0x200
    for (let i = 0; i < NUM_SLOTS; i++) {
      expect(
        readWordBE(s.spriteRam, bankOff + i * 2 + MO_FIELD_CODE_OFF),
      ).toBe(0x0000);
    }
  });

  it("subs.onMmioWrite opzionale: senza callback non crasha", () => {
    const s = emptyGameState();
    const { rom } = makeRomFixture();

    expect(() => moGridInit2404(s, rom, 0)).not.toThrow();

    // Verify spriteRam was still written correctly.
    // (almeno il primo slot).
    expect(readWordBE(s.spriteRam, MO_FIELD_LINK_OFF)).toBe(1);
    // L'ultimo slot link = 56.
    expect(readWordBE(s.spriteRam, 55 * 2 + MO_FIELD_LINK_OFF)).toBe(56);
  });
});
