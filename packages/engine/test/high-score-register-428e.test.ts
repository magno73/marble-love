import { describe, expect, it } from "vitest";
import { emptyGameState } from "../src/state.js";
import { highScoreRegister428E } from "../src/high-score-register-428e.js";

const WRAM = 0x00400000;
const PTR_OFF = 0x1ffc;
const STRUCT_ADDR = 0x00401e74;
const TABLE_OFF = STRUCT_ADDR - WRAM + 0x1e;
const RECORD_ADDR = 0x00400018 + 0xbc;

function writeLongBE(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 24) & 0xff;
  ram[off + 1] = (value >>> 16) & 0xff;
  ram[off + 2] = (value >>> 8) & 0xff;
  ram[off + 3] = value & 0xff;
}

function writeTableRow(ram: Uint8Array, row: number, score: number, initialsPacked = 0): void {
  const off = TABLE_OFF + row * 5;
  ram[off] = (score >>> 16) & 0xff;
  ram[off + 1] = (score >>> 8) & 0xff;
  ram[off + 2] = score & 0xff;
  ram[off + 3] = (initialsPacked >>> 8) & 0xff;
  ram[off + 4] = initialsPacked & 0xff;
}

function rowHex(ram: Uint8Array, row: number): string {
  return Buffer.from(ram.slice(TABLE_OFF + row * 5, TABLE_OFF + row * 5 + 5)).toString("hex");
}

describe("highScoreRegister428E (FUN_0000428E)", () => {
  it("inserts score and packed initials at rank, shifting lower rows", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, STRUCT_ADDR);
    for (let row = 0; row < 10; row++) {
      writeTableRow(s.workRam, row, 0x9000 - row * 0x100, row);
    }
    writeLongBE(s.workRam, RECORD_ADDR - WRAM, 0x00008888);
    s.workRam[RECORD_ADDR - WRAM + 4] = 0x41; // A
    s.workRam[RECORD_ADDR - WRAM + 5] = 0x41; // A
    s.workRam[RECORD_ADDR - WRAM + 6] = 0x41; // A

    expect(highScoreRegister428E(s, 2, RECORD_ADDR)).toBe(0);

    expect(rowHex(s.workRam, 1)).toBe("008f000001");
    expect(rowHex(s.workRam, 2)).toBe("0088880669");
    expect(rowHex(s.workRam, 3)).toBe("008e000002");
  });

  it("returns -1 and leaves table untouched for rank out of range", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, STRUCT_ADDR);
    writeTableRow(s.workRam, 9, 0x123456, 0x789a);
    const before = rowHex(s.workRam, 9);

    expect(highScoreRegister428E(s, 10, RECORD_ADDR)).toBe(-1);

    expect(rowHex(s.workRam, 9)).toBe(before);
  });

  it("normalizes lowercase, space, and unsupported initials like the radix-40 path", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, STRUCT_ADDR);
    writeLongBE(s.workRam, RECORD_ADDR - WRAM, 0x00000000);
    s.workRam[RECORD_ADDR - WRAM + 4] = 0x61; // a -> A
    s.workRam[RECORD_ADDR - WRAM + 5] = 0x20; // space
    s.workRam[RECORD_ADDR - WRAM + 6] = 0x7f; // unsupported -> space

    expect(highScoreRegister428E(s, 0, RECORD_ADDR)).toBe(0);

    expect(rowHex(s.workRam, 0)).toBe("0000000640");
  });

  it("clamps scores above 24 bits and returns -2", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, STRUCT_ADDR);
    writeLongBE(s.workRam, RECORD_ADDR - WRAM, 0x01012345);
    s.workRam[RECORD_ADDR - WRAM + 4] = 0x41;
    s.workRam[RECORD_ADDR - WRAM + 5] = 0x42;
    s.workRam[RECORD_ADDR - WRAM + 6] = 0x43;

    expect(highScoreRegister428E(s, 0, RECORD_ADDR)).toBe(-2);

    expect(rowHex(s.workRam, 0)).toBe("ffffff0693");
  });
});
