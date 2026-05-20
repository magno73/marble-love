import { describe, expect, it } from "vitest";
import { emptyGameState } from "../src/state.js";
import {
  advanceHighScoreInitialsEntry,
  startHighScoreInitialsEntry,
} from "../src/high-score-initials-entry.js";

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

function rowHex(ram: Uint8Array, row: number): string {
  return Buffer.from(ram.slice(TABLE_OFF + row * 5, TABLE_OFF + row * 5 + 5)).toString("hex");
}

describe("high-score initials entry", () => {
  it("edits initials from trackball input and registers them on START", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, PTR_OFF, STRUCT_ADDR);
    writeLongBE(s.workRam, RECORD_ADDR - WRAM, 0x00004000);
    s.workRam[RECORD_ADDR - WRAM + 4] = 0x41;
    s.workRam[RECORD_ADDR - WRAM + 5] = 0x41;
    s.workRam[RECORD_ADDR - WRAM + 6] = 0x41;

    expect(startHighScoreInitialsEntry(s, 0x00400018, 0, RECORD_ADDR)).toBe(true);
    expect(s.clock.highScoreInitialsEntry?.cursor).toBe(0);

    expect(advanceHighScoreInitialsEntry(s, { p1X: 0xff, p1Y: 0xff, buttons: 0 }).active).toBe(true);
    const changed = advanceHighScoreInitialsEntry(s, { p1X: 0xff, p1Y: 0x1f, buttons: 0 });

    expect(changed.changed).toBe(true);
    expect(s.workRam[RECORD_ADDR - WRAM + 4]).toBe(0x42);

    const accepted = advanceHighScoreInitialsEntry(s, { p1X: 0xff, p1Y: 0x1f, buttons: 1 });

    expect(accepted.accepted).toBe(true);
    expect(s.clock.highScoreInitialsEntry).toBeUndefined();
    expect(rowHex(s.workRam, 0)).toBe("0040000ca9");
  });

  it("normalizes unsupported starting initials before entry", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, RECORD_ADDR - WRAM, 0x00000001);
    s.workRam[RECORD_ADDR - WRAM + 4] = 0x61;
    s.workRam[RECORD_ADDR - WRAM + 5] = 0x7f;
    s.workRam[RECORD_ADDR - WRAM + 6] = 0x20;

    startHighScoreInitialsEntry(s, 0x00400018, 0, RECORD_ADDR);

    expect(String.fromCharCode(
      s.workRam[RECORD_ADDR - WRAM + 4] ?? 0,
      s.workRam[RECORD_ADDR - WRAM + 5] ?? 0,
      s.workRam[RECORD_ADDR - WRAM + 6] ?? 0,
    )).toBe("AA ");
  });
});
