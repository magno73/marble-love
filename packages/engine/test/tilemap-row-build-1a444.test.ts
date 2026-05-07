import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import { buildTilemapRows1A444, TILEMAP_ROW_BUILD_1A444_ADDR } from "../src/tilemap-row-build-1a444.js";
import { emptyGameState } from "../src/state.js";

function writeU32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

describe("buildTilemapRows1A444 (FUN_1A444)", () => {
  it("exposes the binary entry address", () => {
    expect(TILEMAP_ROW_BUILD_1A444_ADDR).toBe(0x1a444);
  });

  it("runs a terminating zero-entry row build and dispatches pack rows", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    for (let i = 0; i < 24; i++) {
      const v = 0x004e + i * 0x80;
      rom.program[0x1eb3a + i * 2] = (v >>> 8) & 0xff;
      rom.program[0x1eb3a + i * 2 + 1] = v & 0xff;
    }
    s.playfieldRam.fill(0xcc);
    writeU32(s.workRam, 0x0474, 0x00400800);
    writeU32(s.workRam, 0x065a, 0x00401200);
    writeU32(s.workRam, 0x0808, 0x00400900);
    s.workRam[0x0818] = 0;
    s.workRam[0x0819] = 0x18;
    s.workRam[0x081a] = 0;
    s.workRam[0x081b] = 0;
    writeU32(s.workRam, 0x081c, 0x00401400);
    s.workRam[0x0900] = 0xff;
    s.workRam[0x0901] = 0xff;

    buildTilemapRows1A444(s, rom);

    expect(s.workRam[0x03f0]).toBe(0x18);
    expect(Array.from(s.playfieldRam.slice(0x4e, 0x4e + 6))).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
