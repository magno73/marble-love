/**
 * eeprom-helper-40d8.test.ts — smoke tests di `eepromHelper40D8`.
 *
 * Bit-perfect parity (500 casi randomici) verificata in
 * `packages/cli/src/test-eeprom-helper-40d8-parity.ts` vs Musashi.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROM_MAX_RECORDS_BYTE,
  eepromHelper40D8,
  RET_KEY_OUT_OF_RANGE,
} from "../src/eeprom-helper-40d8.js";
import { emptyGameState } from "../src/state.js";

function writeLongBE(ram: Uint8Array, off: number, value: number): void {
  const v = value >>> 0;
  ram[off] = (v >>> 24) & 0xff;
  ram[off + 1] = (v >>> 16) & 0xff;
  ram[off + 2] = (v >>> 8) & 0xff;
  ram[off + 3] = v & 0xff;
}

describe("eepromHelper40D8 (FUN_40D8)", () => {
  it("key 0: reads byte at ptr+0 and appends byte at ptr+0x14", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, 0x1ffc, 0x401000);
    s.workRam[0x1000] = 0xab;
    s.workRam[0x1014] = 0xcd;

    expect(eepromHelper40D8(s, 0)).toBe(0xabcd);
  });

  it("key 3: packs high 12 bits and appends descriptor byte 3", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, 0x1ffc, 0x401000);
    s.workRam[0x1003] = 0x12;
    s.workRam[0x1004] = 0xa7;
    s.workRam[0x1017] = 0x5c;

    expect(eepromHelper40D8(s, 3)).toBe(0x12a5c);
  });

  it("key 4: packs low 12 bits and appends descriptor byte 4", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, 0x1ffc, 0x401000);
    s.workRam[0x1004] = 0x9a;
    s.workRam[0x1005] = 0xbc;
    s.workRam[0x1018] = 0xde;

    expect(eepromHelper40D8(s, 4)).toBe(0xabcde);
  });

  it("key 10: reads a big-endian word without append", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, 0x1ffc, 0x401000);
    s.workRam[0x1011] = 0x34;
    s.workRam[0x1012] = 0x56;

    expect(eepromHelper40D8(s, 10)).toBe(0x3456);
  });

  it("key 11: reads a word then drops the low byte", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, 0x1ffc, 0x401000);
    s.workRam[0x100a] = 0xbe;
    s.workRam[0x100b] = 0xef;

    expect(eepromHelper40D8(s, 11)).toBe(0xbe);
  });

  it("key 13: returns sign-extended ROM byte at 0x1006F", () => {
    const s = emptyGameState();

    expect(eepromHelper40D8(s, 13, DEFAULT_ROM_MAX_RECORDS_BYTE)).toBe(0xffffffe3);
    expect(eepromHelper40D8(s, 13, 0x7f)).toBe(0x7f);
  });

  it("key > 13 unsigned returns -1", () => {
    const s = emptyGameState();

    expect(eepromHelper40D8(s, 14)).toBe(RET_KEY_OUT_OF_RANGE);
    expect(eepromHelper40D8(s, 0xffffffff)).toBe(RET_KEY_OUT_OF_RANGE);
  });

  it("has no side effects on workRam", () => {
    const s = emptyGameState();
    writeLongBE(s.workRam, 0x1ffc, 0x401000);
    for (let i = 0; i < 0x40; i++) s.workRam[0x1000 + i] = (i * 7) & 0xff;
    const before = new Uint8Array(s.workRam);

    for (let key = 0; key <= 14; key++) eepromHelper40D8(s, key);

    expect(s.workRam).toEqual(before);
  });
});
