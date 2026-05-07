import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import {
  TILEMAP_SPAN_BUILDER_1AA38_ADDR,
  buildTilemapSpan1AA38,
} from "../src/tilemap-span-builder-1aa38.js";
import { emptyGameState } from "../src/state.js";

const SCRATCH = 0x00400a9c;

function writeWord(s: ReturnType<typeof emptyGameState>, abs: number, value: number): void {
  const off = abs - 0x00400000;
  s.workRam[off] = (value >>> 8) & 0xff;
  s.workRam[off + 1] = value & 0xff;
}

describe("buildTilemapSpan1AA38 (FUN_1AA38)", () => {
  it("exposes the binary entry address", () => {
    expect(TILEMAP_SPAN_BUILDER_1AA38_ADDR).toBe(0x1aa38);
  });

  it("processes 22 cells when bitLong is zero", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const targets: number[] = [];
    for (let i = 0; i < 22; i++) writeWord(s, SCRATCH + i * 8, 0x20 + i);

    buildTilemapSpan1AA38(s, rom, 0, 0x100, SCRATCH, {
      bsearchTable1ABD4: (target) => {
        targets.push(target & 0xffff);
        return target + 1;
      },
    });

    expect(targets).toHaveLength(22);
    expect(targets[0]).toBe(0x20);
    expect(targets[21]).toBe(0x35);
    expect(Array.from(s.workRam.slice(0x0a9c, 0x0a9e))).toEqual([0x00, 0x21]);
  });

  it("processes 21 cells and clears the final word when bitLong is nonzero", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    for (let i = 0; i < 22; i++) writeWord(s, SCRATCH + i * 8, 0x40);
    writeWord(s, SCRATCH + 21 * 8, 0xbeef);

    let calls = 0;
    buildTilemapSpan1AA38(s, rom, 1, 0x100, SCRATCH, {
      bsearchTable1ABD4: () => {
        calls++;
        return 0x1234;
      },
    });

    expect(calls).toBe(21);
    expect(Array.from(s.workRam.slice(0x0a9c, 0x0a9e))).toEqual([0x12, 0x34]);
    expect(Array.from(s.workRam.slice(0x0a9c + 21 * 8, 0x0a9e + 21 * 8))).toEqual([0, 0]);
  });
});
