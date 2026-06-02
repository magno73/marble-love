/**
 * Test findNearestTarget2637A (FUN_0002637A) - smoke tests for the scanner
 * for nearest-neighbor with filter + line-of-sight.
 *
 * ROM, filters by byte (≡ A2[+0x1D] sign-ext), validates via `FUN_17CB8`, and
 * picks the best visible candidate.
 *
 * `cli/src/test-find-nearest-target-2637a-parity.ts` (500/500 cases).
 */

import { describe, it, expect } from "vitest";
import {
  findNearestTarget2637A,
  FIND_NEAREST_TARGET_2637A_ADDR,
  FIND_NEAREST_TARGET_2637A_GLOBALS,
  FIND_NEAREST_TARGET_2637A_FIELDS,
  FIND_NEAREST_TARGET_2637A_CONSTS,
  type FindNearestTarget2637ASubs,
} from "../src/find-nearest-target-2637a.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;

function readU32BE(wr: Uint8Array, off: number): number {
  return (
    (((wr[off] ?? 0) << 24) |
      ((wr[off + 1] ?? 0) << 16) |
      ((wr[off + 2] ?? 0) << 8) |
      (wr[off + 3] ?? 0)) >>>
    0
  );
}

/** Builds a bytewise reader over a Uint8Array indexed from
 *  a fictitious base address (e.g. 0x20000 = ROM area).
 */
function makeTableReader(
  base: number,
  bytes: readonly number[],
): (addr: number) => number {
  return (addr: number): number => {
    const idx = (addr >>> 0) - (base >>> 0);
    if (idx < 0 || idx >= bytes.length) return 0xff; // out-of-range = sentinel
    return bytes[idx]! & 0xff;
  };
}

describe("findNearestTarget2637A (FUN_0002637A)", () => {
  it("selects the nearest candidate with filter match and LOS free", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1000;
    const objOff = objPtr - WORK_RAM_BASE;

    // A2[+0x1D] = filter category = 0x05
    s.workRam[objOff + 0x1d] = 0x05;
    // A2[+0x32].w = objX (grid-space) = 0x20. A2[+0x34].w = objY = 0x20.
    s.workRam[objOff + 0x32] = 0x00;
    s.workRam[objOff + 0x33] = 0x20;
    s.workRam[objOff + 0x34] = 0x00;
    s.workRam[objOff + 0x35] = 0x20;

    // record [x, y, filter, _pad]
    //   #0: (0x10, 0x10, 0x05, 0)  → grid-dist from (0x20, 0x20):
    //                                  |dX|=|0x20-0x10|=0x10, |dY|=0x10
    //                                  d1Shifted=0x100, d3Shifted=0x100
    //                                  d2 = (0x100>>>3)*3 + 0x100 = 0x60+0x100=0x160
    //                                  pixel out = (0x10<<3)+4 = 0x84
    //   #1: (0x21, 0x21, 0x05, 0)  → |dX|=1, |dY|=1
    //                                 d1=0x10, d3=0x10
    //                                 d2 = (0x10>>>3)*3 + 0x10 = 6+16 = 0x16
    //                                 pixel out = (0x21<<3)+4 = 0x10C
    //   #2: (0x18, 0x18, 0x07, 0)  → filter mismatch, skip
    //   #3: 0xFF (sentinel)
    const tableBase = 0x20000;
    const reader = makeTableReader(tableBase, [
      0x10, 0x10, 0x05, 0x00,
      0x21, 0x21, 0x05, 0x00,
      0x18, 0x18, 0x07, 0x00,
      0xff, 0x00, 0x00, 0x00,
    ]);

    findNearestTarget2637A(s, objPtr, tableBase, reader, {
      lineOfSight17CB8: () => 0, // path free
    });

    // Best = #1 → pixelX = (0x21<<3)+4 = 0x10C, pixelY = 0x10C, filter = 0x05
    expect(readU32BE(s.workRam, 0x462)).toBe(0x10c);
    expect(readU32BE(s.workRam, 0x466)).toBe(0x10c);
    expect(s.workRam[0x472]).toBe(0x05);
  });

  it("discards candidates with LOS blocked", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1100;
    const objOff = objPtr - WORK_RAM_BASE;

    // Filter = 0x03, obj at grid (0x14, 0x14)
    s.workRam[objOff + 0x1d] = 0x03;
    s.workRam[objOff + 0x32] = 0x00;
    s.workRam[objOff + 0x33] = 0x14;
    s.workRam[objOff + 0x34] = 0x00;
    s.workRam[objOff + 0x35] = 0x14;

    const tableBase = 0x21000;
    // 3 candidates with filter match and dist < 0x300. LOS blocks #0 and #1.
    //   #0: (0x10, 0x10) → |d|=4 → d2 small, pixelX=0x84
    //   #2: (0x16, 0x16) → |d|=2 → similar, pixelX=0xB4
    const reader = makeTableReader(tableBase, [
      0x10, 0x10, 0x03, 0x00,
      0x12, 0x12, 0x03, 0x00,
      0x16, 0x16, 0x03, 0x00,
      0xff, 0x00, 0x00, 0x00,
    ]);

    const subs: FindNearestTarget2637ASubs = {
      lineOfSight17CB8: (_s, _o, px) => {
        return px < 0xb0 ? 1 : 0;
      },
    };

    findNearestTarget2637A(s, objPtr, tableBase, reader, subs);

    // Only #2 passes: pixelX = (0x16<<3)+4 = 0xB4.
    expect(readU32BE(s.workRam, 0x462)).toBe(0xb4);
    expect(readU32BE(s.workRam, 0x466)).toBe(0xb4);
    expect(s.workRam[0x472]).toBe(0x03);
  });

  it("no candidate passes: globals 0x400462/466/472 unchanged", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1200;
    const objOff = objPtr - WORK_RAM_BASE;

    s.workRam[objOff + 0x1d] = 0x09;

    // Pre-fill globals with distinct sentinels.
    s.workRam[0x462] = 0xde;
    s.workRam[0x463] = 0xad;
    s.workRam[0x464] = 0xbe;
    s.workRam[0x465] = 0xef;
    s.workRam[0x466] = 0xca;
    s.workRam[0x467] = 0xfe;
    s.workRam[0x468] = 0xba;
    s.workRam[0x469] = 0xbe;
    s.workRam[0x472] = 0xa5;

    const tableBase = 0x22000;
    const reader = makeTableReader(tableBase, [
      0x10, 0x10, 0x05, 0x00, // filter mismatch
      0x20, 0x20, 0x07, 0x00, // filter mismatch
      0xff, 0x00, 0x00, 0x00,
    ]);

    findNearestTarget2637A(s, objPtr, tableBase, reader, {
      lineOfSight17CB8: () => 0,
    });

    // Globals unchanged
    expect(readU32BE(s.workRam, 0x462)).toBe(0xdeadbeef >>> 0);
    expect(readU32BE(s.workRam, 0x466)).toBe(0xcafebabe >>> 0);
    expect(s.workRam[0x472]).toBe(0xa5);
  });

  it("filter byte sign-ext: A2[+0x1D]=0xFE → cmp.w 0xFFFE; matches 0xFE", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1300;
    const objOff = objPtr - WORK_RAM_BASE;

    // Filter sign-ext: 0xFE (.b) → 0xFFFE (.w sign-ext).
    // The candidate has filter byte 0xFE (.b) → 0x00FE (.w zero-ext, moveq #0,D0).
    //   D0.w = zero-ext byte from A3[+2] (= 0x00FE)
    // vs
    //   word at (-2,A6) = sign-ext A2[+0x1D] (= 0xFFFE for 0xFE)
    s.workRam[objOff + 0x1d] = 0xfe;
    s.workRam[objOff + 0x32] = 0x00;
    s.workRam[objOff + 0x33] = 0x80;
    s.workRam[objOff + 0x34] = 0x00;
    s.workRam[objOff + 0x35] = 0x80;

    const tableBase = 0x23000;
    const reader = makeTableReader(tableBase, [
      0x10, 0x10, 0xfe, 0x00, // filter byte 0xFE
      0xff, 0x00, 0x00, 0x00,
    ]);

    // Pre-clear globals
    for (let k = 0x462; k < 0x46c; k++) s.workRam[k] = 0;
    s.workRam[0x472] = 0;

    findNearestTarget2637A(s, objPtr, tableBase, reader, {
      lineOfSight17CB8: () => 0,
    });

    // Filter mismatch (0x00FE != 0xFFFE) → no write.
    expect(readU32BE(s.workRam, 0x462)).toBe(0);
    expect(readU32BE(s.workRam, 0x466)).toBe(0);
    expect(s.workRam[0x472]).toBe(0);
  });

  it("filter byte 0x00 matches 0x00 (zero-ext == sign-ext for positive byte)", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1400;
    const objOff = objPtr - WORK_RAM_BASE;

    s.workRam[objOff + 0x1d] = 0x00;
    s.workRam[objOff + 0x32] = 0x00;
    s.workRam[objOff + 0x33] = 0x10;
    s.workRam[objOff + 0x34] = 0x00;
    s.workRam[objOff + 0x35] = 0x10;

    const tableBase = 0x24000;
    const reader = makeTableReader(tableBase, [
      0x08, 0x08, 0x00, 0x00, // pixel = (0x44, 0x44); dist grid = 8
      0xff, 0x00, 0x00, 0x00,
    ]);

    findNearestTarget2637A(s, objPtr, tableBase, reader, {
      lineOfSight17CB8: () => 0,
    });

    expect(readU32BE(s.workRam, 0x462)).toBe(0x44);
    expect(readU32BE(s.workRam, 0x466)).toBe(0x44);
    expect(s.workRam[0x472]).toBe(0x00);
  });

  it("invokes lineOfSight17CB8 with pixelX/Y of cell center and range 0x180", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1500;
    const objOff = objPtr - WORK_RAM_BASE;
    s.workRam[objOff + 0x1d] = 0x02;
    s.workRam[objOff + 0x32] = 0x00;
    s.workRam[objOff + 0x33] = 0x12;
    s.workRam[objOff + 0x34] = 0x00;
    s.workRam[objOff + 0x35] = 0x22;

    const tableBase = 0x25000;
    const reader = makeTableReader(tableBase, [
      0x10, 0x20, 0x02, 0x00,
      0xff, 0x00, 0x00, 0x00,
    ]);

    const calls: Array<{
      objPtr: number;
      px: number;
      py: number;
      range: number;
    }> = [];
    findNearestTarget2637A(s, objPtr, tableBase, reader, {
      lineOfSight17CB8: (_, op, px, py, range) => {
        calls.push({ objPtr: op, px, py, range });
        return 0;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      objPtr,
      px: (0x10 << 3) + 4, // 0x84 — pixel center of the target
      py: (0x20 << 3) + 4, // 0x104
      range: 0x180,
    });
  });

  it("constants exposed: addresses and offsets correct", () => {
    expect(FIND_NEAREST_TARGET_2637A_ADDR).toBe(0x2637a);
    expect(FIND_NEAREST_TARGET_2637A_GLOBALS.bestPixelX_400462).toBe(0x400462);
    expect(FIND_NEAREST_TARGET_2637A_GLOBALS.bestPixelY_400466).toBe(0x400466);
    expect(FIND_NEAREST_TARGET_2637A_GLOBALS.bestFilter_400472).toBe(0x400472);
    expect(FIND_NEAREST_TARGET_2637A_GLOBALS.stateSelector_400394).toBe(
      0x400394,
    );
    expect(FIND_NEAREST_TARGET_2637A_FIELDS.filterFrom1D).toBe(0x1d);
    expect(FIND_NEAREST_TARGET_2637A_FIELDS.objPixelX_32).toBe(0x32);
    expect(FIND_NEAREST_TARGET_2637A_FIELDS.objPixelY_34).toBe(0x34);
    expect(FIND_NEAREST_TARGET_2637A_CONSTS.recordTerminator).toBe(0xff);
    expect(FIND_NEAREST_TARGET_2637A_CONSTS.recordStride).toBe(4);
    expect(FIND_NEAREST_TARGET_2637A_CONSTS.initialBestDistance).toBe(0x300);
    expect(FIND_NEAREST_TARGET_2637A_CONSTS.losRange0x180).toBe(0x180);
    expect(FIND_NEAREST_TARGET_2637A_CONSTS.fun_17CB8_addr).toBe(0x17cb8);
    expect(FIND_NEAREST_TARGET_2637A_CONSTS.dispatchTableRom_1EF1A).toBe(
      0x1ef1a,
    );
  });
});
