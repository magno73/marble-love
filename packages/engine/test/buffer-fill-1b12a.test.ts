/**
 * buffer-fill-1b12a.test.ts — unit tests per `bufferFill1B12A` (FUN_0001B12A).
 *
 * Bit-perfect parity verificata in `cli/src/test-buffer-fill-1b12a-parity.ts`.
 * Qui copriamo each path of dispatch + edge cases (typeCode 0, null-ptr, out-of-range).
 */

import { describe, it, expect } from "vitest";
import {
  bufferFill1B12A,
  BUFFER_FILL_1B12A_ADDR,
} from "../src/buffer-fill-1b12a.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { RomImage } from "../src/bus.js";
import type { GameState } from "../src/state.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORK_RAM_BASE = 0x00400000;

function w16(state: GameState, abs: number, val: number): void {
  const off = abs - WORK_RAM_BASE;
  state.workRam[off]     = (val >>> 8) & 0xff;
  state.workRam[off + 1] = val & 0xff;
}

function w32(buf: Uint8Array | GameState, absOrOff: number, val: number): void {
  const arr = buf instanceof Uint8Array ? buf : null;
  if (arr) {
    arr[absOrOff]     = (val >>> 24) & 0xff;
    arr[absOrOff + 1] = (val >>> 16) & 0xff;
    arr[absOrOff + 2] = (val >>> 8)  & 0xff;
    arr[absOrOff + 3] = val & 0xff;
  }
}

function romW32(rom: RomImage, off: number, val: number): void {
  rom.program[off]     = (val >>> 24) & 0xff;
  rom.program[off + 1] = (val >>> 16) & 0xff;
  rom.program[off + 2] = (val >>> 8)  & 0xff;
  rom.program[off + 3] = val & 0xff;
}

function wrW32(state: GameState, abs: number, val: number): void {
  const off = abs - WORK_RAM_BASE;
  state.workRam[off]     = (val >>> 24) & 0xff;
  state.workRam[off + 1] = (val >>> 16) & 0xff;
  state.workRam[off + 2] = (val >>> 8)  & 0xff;
  state.workRam[off + 3] = val & 0xff;
}

function readWord(buf: Uint8Array, off: number): number {
  const w = (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

/** Build a localRect buffer with given typeCode and subIdx. */
function makeRect(typeCode: number, subIdx: number): Uint8Array {
  const buf = new Uint8Array(14);
  buf[0] = typeCode & 0xff;
  buf[1] = subIdx & 0xff;
  return buf;
}

/** Read the 6 output words from localRect[2..0xD]. */
function readOut(buf: Uint8Array): { xMin: number; yMin: number; zMin: number; xMax: number; yMax: number; zMax: number } {
  return {
    xMin: readWord(buf, 2),
    yMin: readWord(buf, 4),
    zMin: readWord(buf, 6),
    xMax: readWord(buf, 8),
    yMax: readWord(buf, 0xa),
    zMax: readWord(buf, 0xc),
  };
}

// ─── BUFFER_FILL_1B12A_ADDR constant ─────────────────────────────────────────

describe("BUFFER_FILL_1B12A_ADDR", () => {
  it("has expected value", () => {
    expect(BUFFER_FILL_1B12A_ADDR).toBe(0x0001b12a);
  });
});

// ─── typeCode == 0: sentinel ──────────────────────────────────────────────────

describe("typeCode 0 — sentinel / invalid", () => {
  it("fills all 6 fields with 0x7fff (min) and size 0", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const buf = makeRect(0, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(0x7fff);
    expect(out.yMin).toBe(0x7fff);
    expect(out.zMin).toBe(0x7fff);
    expect(out.xMax).toBe(0x7fff);
    expect(out.yMax).toBe(0x7fff);
    expect(out.zMax).toBe(0x7fff);
  });
});

// ─── typeCode == 1: table PT_TYPE1 ───────────────────────────────────────────

describe("typeCode 1 — PT_TYPE1 subtract offsets", () => {
  it("xMin = A1[0xc]-3, yMin = A1[0x10]-3, zMin = A1[0x14]+1, sizes = 6", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    // Create an object struct in work RAM @ 0x401000
    const objBase = 0x401000;
    w16(state, objBase + 0x0c, 100);
    w16(state, objBase + 0x10, 200);
    w16(state, objBase + 0x14, 300);
    // Point ROM table 0x1eff6[0] to objBase
    romW32(rom, 0x1eff6, objBase);
    const buf = makeRect(1, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(97);     // 100 - 3
    expect(out.yMin).toBe(197);    // 200 - 3
    expect(out.zMin).toBe(301);    // 300 + 1
    expect(out.xMax).toBe(97 + 6); // 103
    expect(out.yMax).toBe(197 + 6); // 203
    expect(out.zMax).toBe(301 + 6); // 307
  });

  it("subIdx 1 uses second table entry", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const obj0 = 0x401000;
    const obj1 = 0x401100;
    w16(state, obj0 + 0x0c, 10);
    w16(state, obj1 + 0x0c, 50);
    w16(state, obj1 + 0x10, 60);
    w16(state, obj1 + 0x14, 70);
    romW32(rom, 0x1eff6, obj0);
    romW32(rom, 0x1eff6 + 4, obj1);
    const buf = makeRect(1, 1);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(47); // 50 - 3
    expect(out.yMin).toBe(57); // 60 - 3
    expect(out.zMin).toBe(71); // 70 + 1
  });
});

// ─── typeCode == 2: table PT_TYPE2 ───────────────────────────────────────────

describe("typeCode 2 — PT_TYPE2 (same offsets as type 1)", () => {
  it("xMin = A1[0xc]-3, size 6", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const obj = 0x401000;
    w16(state, obj + 0x0c, 20);
    w16(state, obj + 0x10, 30);
    w16(state, obj + 0x14, 40);
    romW32(rom, 0x1effe, obj);
    const buf = makeRect(2, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(17); // 20-3
    expect(out.yMin).toBe(27); // 30-3
    expect(out.zMin).toBe(41); // 40+1
  });
});

// ─── typeCode == 0x2c: all zeros ──────────────────────────────────────────────

describe("typeCode 0x2c — all zeros", () => {
  it("all output fields = 0", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const buf = makeRect(0x2c, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(0);
    expect(out.yMin).toBe(0);
    expect(out.zMin).toBe(0);
    expect(out.xMax).toBe(0);
    expect(out.yMax).toBe(0);
    expect(out.zMax).toBe(0);
  });
});

// ─── typeCode == 0x2a: direct word array ─────────────────────────────────────

describe("typeCode 0x2a — work-RAM word array @ 0x40098c", () => {
  it("xMin=word[0], yMin=word[2], zMin=word[4]-8, sizes 0", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    // struct at 0x40098c + 0 (subIdx=0)
    const base = 0x40098c;
    w16(state, base + 0, 100);
    w16(state, base + 2, 200);
    w16(state, base + 4, 300);
    const buf = makeRect(0x2a, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(100);
    expect(out.yMin).toBe(200);
    expect(out.zMin).toBe(292); // 300-8
    expect(out.xMax).toBe(100); // size=0
    expect(out.yMax).toBe(200);
    expect(out.zMax).toBe(292);
  });

  it("subIdx 1 uses offset 12", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const base = 0x40098c + 12;
    w16(state, base + 0, 10);
    w16(state, base + 2, 20);
    w16(state, base + 4, 30);
    const buf = makeRect(0x2a, 1);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(10);
    expect(out.yMin).toBe(20);
    expect(out.zMin).toBe(22); // 30-8
  });
});

// ─── typeCode == 0x29: byte coords × 8 + 2 ───────────────────────────────────

describe("typeCode 0x29 — bitmap coords @ 0x401650", () => {
  it("xMin = byte[4]*8+2, yMin = byte[5]*8+2, zMin = word[6]", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const base = 0x401650; // subIdx = 0, stride 16
    // byte[4] = 5 → xMin = 5*8+2 = 42
    state.workRam[base - WORK_RAM_BASE + 4] = 5;
    // byte[5] = 3 → yMin = 3*8+2 = 26
    state.workRam[base - WORK_RAM_BASE + 5] = 3;
    // word[6] = 100 → zMin = 100
    w16(state, base + 6, 100);
    const buf = makeRect(0x29, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(42);
    expect(out.yMin).toBe(26);
    expect(out.zMin).toBe(100);
    expect(out.xMax).toBe(42 + 4);
    expect(out.yMax).toBe(26 + 4);
    expect(out.zMax).toBe(100 + 0x14);
  });

  it("negative byte[4] sign-extends correctly", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const base = 0x401650;
    // byte[4] = 0xff = -1 → xMin = -8+2 = -6
    state.workRam[base - WORK_RAM_BASE + 4] = 0xff;
    state.workRam[base - WORK_RAM_BASE + 5] = 0;
    const buf = makeRect(0x29, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(-6);
  });
});

// ─── typeCode == 4: compound ptr via PT_TYPE4 ────────────────────────────────

describe("typeCode 4 — compound ptr (PT_TYPE4)", () => {
  it("null sub-object: d4=d6=-4, d1=d2=8, d3=0x10; a3=0", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const a2Base = 0x401100;
    const ptrList = 0x401200; // A2[0x58] → pointer to sub-object list
    const subObjPtr = 0x401300; // sub-object pointer placeholder

    // A2[0xc] = 100, A2[0x10] = 200, A2[0x14] = 300
    w16(state, a2Base + 0x0c, 100);
    w16(state, a2Base + 0x10, 200);
    w16(state, a2Base + 0x14, 300);
    // A2[0x58] → ptrList
    wrW32(state, a2Base + 0x58, ptrList);
    // (ptrList) = NULL_PTR (0xffffffff)
    wrW32(state, ptrList, 0xffffffff);

    romW32(rom, 0x1f006, a2Base); // table[0] = a2Base
    const buf = makeRect(4, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    // xMin = A2[0xc] + d4 = 100 + (-4) = 96
    expect(out.xMin).toBe(96);
    // yMin = A2[0x10] + d6 = 200 + (-4) = 196
    expect(out.yMin).toBe(196);
    // zMin = A2[0x14] + a3 = 300 + 0 = 300
    expect(out.zMin).toBe(300);
    expect(out.xMax).toBe(96 + 8);   // d1 = 8
    expect(out.yMax).toBe(196 + 8);  // d2 = 8
    expect(out.zMax).toBe(300 + 0x10); // d3 = 0x10
  });

  it("non-null sub-object: reads bytes 4..7 from subObj", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const a2Base = 0x401100;
    const ptrList = 0x401200;
    const subObj  = 0x401400;

    w16(state, a2Base + 0x0c, 50);
    w16(state, a2Base + 0x10, 60);
    w16(state, a2Base + 0x14, 70);
    wrW32(state, a2Base + 0x58, ptrList);
    wrW32(state, ptrList, subObj);
    // sub-object offsets: byte[4]=2, byte[5]=3, byte[6]=4, byte[7]=5
    state.workRam[subObj - WORK_RAM_BASE + 4] = 2;
    state.workRam[subObj - WORK_RAM_BASE + 5] = 3;
    state.workRam[subObj - WORK_RAM_BASE + 6] = 4;
    state.workRam[subObj - WORK_RAM_BASE + 7] = 5;

    romW32(rom, 0x1f006, a2Base);
    const buf = makeRect(4, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(52);   // 50+2
    expect(out.yMin).toBe(63);   // 60+3
    expect(out.zMin).toBe(70);   // 70+0 (a3=0 for type4)
    expect(out.xMax).toBe(56);   // 52+4
    expect(out.yMax).toBe(68);   // 63+5
    expect(out.zMax).toBe(70 + 0x10); // d3=0x10
  });
});

// ─── typeCode == 7: table PT_TYPE_79, flip flag ───────────────────────────────

describe("typeCode 7 — PT_TYPE_79, flip-flag branch", () => {
  it("flip==2: zDelta=-8, zSize=0", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const a1Base = 0x401100;
    const a4Ptr  = 0x401200; // A1[0x1c] → a4Ptr
    const subObj = 0x401300; // *(a4Ptr) = subObj

    w16(state, a1Base + 0x0c, 10);
    w16(state, a1Base + 0x10, 20);
    w16(state, a1Base + 0x14, 30);
    wrW32(state, a1Base + 0x1c, a4Ptr);
    wrW32(state, a4Ptr, subObj);
    state.workRam[subObj - WORK_RAM_BASE + 4] = 1;  // d4 = 1
    state.workRam[subObj - WORK_RAM_BASE + 5] = 2;  // d6 = 2
    state.workRam[subObj - WORK_RAM_BASE + 6] = 3;  // d1 = 3
    state.workRam[subObj - WORK_RAM_BASE + 7] = 4;  // d2 = 4
    // flip = 2
    state.workRam[a1Base - WORK_RAM_BASE + 0x1a] = 2;

    romW32(rom, 0x1f096, a1Base);
    const buf = makeRect(7, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(11);  // 10 + 1 (d4=byte[4])
    expect(out.yMin).toBe(22);  // 20 + 2 (d6=byte[5])
    expect(out.zMin).toBe(22);  // 30 + (-8) = 22
    expect(out.xMax).toBe(14);  // 11 + 3 (d1=byte[6])
    expect(out.yMax).toBe(26);  // 22 + 4 (d2=byte[7])
    expect(out.zMax).toBe(22);  // 22 + 0 (d3=0)
  });

  it("flip!=2: zDelta=0, zSize=6", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const a1Base = 0x401100;
    const a4Ptr  = 0x401200;
    const subObj = 0x401300;

    w16(state, a1Base + 0x0c, 10);
    w16(state, a1Base + 0x10, 20);
    w16(state, a1Base + 0x14, 30);
    wrW32(state, a1Base + 0x1c, a4Ptr);
    wrW32(state, a4Ptr, subObj);
    state.workRam[subObj - WORK_RAM_BASE + 4] = 1;
    state.workRam[subObj - WORK_RAM_BASE + 5] = 2;
    state.workRam[subObj - WORK_RAM_BASE + 6] = 3;
    state.workRam[subObj - WORK_RAM_BASE + 7] = 4;
    // flip = 0 (not 2)
    state.workRam[a1Base - WORK_RAM_BASE + 0x1a] = 0;

    romW32(rom, 0x1f096, a1Base);
    const buf = makeRect(7, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(11);   // 10+1
    expect(out.yMin).toBe(22);   // 20+2
    expect(out.zMin).toBe(30);   // 30+0
    expect(out.xMax).toBe(14);   // 11+3
    expect(out.yMax).toBe(26);   // 22+4
    expect(out.zMax).toBe(36);   // 30+6
  });
});

// ─── typeCode 3..0xd default: jump-table dispatch ────────────────────────────

describe("typeCode 3 — default path, sub-obj from A1[0x3e], d6=-16, d3=0x10", () => {
  it("reads byte[4]/[5]/[6]/[7] from sub-object, applies fixed z offsets", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const a1Base = 0x401100;
    const a4Ptr  = 0x401200;  // A1[0x3e] → ptrList
    const subObj = 0x401300;

    w16(state, a1Base + 0x0c, 100);
    w16(state, a1Base + 0x10, 200);
    w16(state, a1Base + 0x14, 300);
    wrW32(state, a1Base + 0x3e, a4Ptr);
    wrW32(state, a4Ptr, subObj);
    state.workRam[subObj - WORK_RAM_BASE + 4] = 5;  // d5=xDelta
    state.workRam[subObj - WORK_RAM_BASE + 5] = 7;  // d4=yDelta
    state.workRam[subObj - WORK_RAM_BASE + 6] = 8;  // d1=xSize
    state.workRam[subObj - WORK_RAM_BASE + 7] = 9;  // d2=ySize

    romW32(rom, 0x1f016, a1Base);
    const buf = makeRect(3, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(105);      // 100+5
    expect(out.yMin).toBe(207);      // 200+7
    expect(out.zMin).toBe(300 - 16); // 300 + (-16) = 284
    expect(out.xMax).toBe(105 + 8);  // +d1
    expect(out.yMax).toBe(207 + 9);  // +d2
    expect(out.zMax).toBe(284 + 0x10); // +d3=16
  });
});

describe("typeCode 5 — default path, d6=0, d3=0x18", () => {
  it("zDelta=0, zSize=0x18", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const a1Base = 0x401100;
    const a4Ptr  = 0x401200;
    const subObj = 0x401300;
    w16(state, a1Base + 0x0c, 10);
    w16(state, a1Base + 0x10, 20);
    w16(state, a1Base + 0x14, 30);
    wrW32(state, a1Base + 0x3e, a4Ptr);
    wrW32(state, a4Ptr, subObj);
    state.workRam[subObj - WORK_RAM_BASE + 4] = 1;
    state.workRam[subObj - WORK_RAM_BASE + 5] = 2;
    state.workRam[subObj - WORK_RAM_BASE + 6] = 3;
    state.workRam[subObj - WORK_RAM_BASE + 7] = 4;
    romW32(rom, 0x1f016, a1Base);
    const buf = makeRect(5, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(11);  // 10+1
    expect(out.yMin).toBe(22);  // 20+2
    expect(out.zMin).toBe(30);  // 30+0
    expect(out.zMax).toBe(30 + 0x18);
  });
});

describe("typeCode 11 — default path, null sub-obj: d6=-8, sizes 8/8/0", () => {
  it("null sub-object uses default offsets", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const a1Base = 0x401100;
    const a4Ptr  = 0x401200;

    w16(state, a1Base + 0x0c, 50);
    w16(state, a1Base + 0x10, 60);
    w16(state, a1Base + 0x14, 70);
    wrW32(state, a1Base + 0x3e, a4Ptr);
    // (a4Ptr) = NULL_PTR
    wrW32(state, a4Ptr, 0xffffffff);

    romW32(rom, 0x1f016, a1Base);
    const buf = makeRect(11, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(50);       // +0
    expect(out.yMin).toBe(60);       // +0
    expect(out.zMin).toBe(70 - 8);   // +(-8) = 62
    expect(out.xMax).toBe(50 + 8);
    expect(out.yMax).toBe(60 + 8);
    expect(out.zMax).toBe(62 + 0);   // d3=0
  });
});

describe("typeCode 12 — default path, null sub-obj: d6=-8, sizes 8/8/0", () => {
  it("null sub-object uses same defaults as type 11", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const a1Base = 0x401100;
    const a4Ptr  = 0x401200;
    w16(state, a1Base + 0x0c, 10);
    w16(state, a1Base + 0x10, 20);
    w16(state, a1Base + 0x14, 30);
    wrW32(state, a1Base + 0x3e, a4Ptr);
    wrW32(state, a4Ptr, 0xffffffff);
    romW32(rom, 0x1f016, a1Base);
    const buf = makeRect(12, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(10);
    expect(out.yMin).toBe(20);
    expect(out.zMin).toBe(22); // 30-8
    expect(out.xMax).toBe(18); // +8
    expect(out.yMax).toBe(28); // +8
    expect(out.zMax).toBe(22); // +0
  });

  it("non-null sub-obj: d6=0, d3=0x10", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const a1Base = 0x401100;
    const a4Ptr  = 0x401200;
    const subObj = 0x401300;
    w16(state, a1Base + 0x0c, 10);
    w16(state, a1Base + 0x10, 20);
    w16(state, a1Base + 0x14, 30);
    wrW32(state, a1Base + 0x3e, a4Ptr);
    wrW32(state, a4Ptr, subObj);
    state.workRam[subObj - WORK_RAM_BASE + 4] = 2;
    state.workRam[subObj - WORK_RAM_BASE + 5] = 3;
    state.workRam[subObj - WORK_RAM_BASE + 6] = 4;
    state.workRam[subObj - WORK_RAM_BASE + 7] = 5;
    romW32(rom, 0x1f016, a1Base);
    const buf = makeRect(12, 0);
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(12);  // 10+2
    expect(out.yMin).toBe(23);  // 20+3
    expect(out.zMin).toBe(30);  // 30+0
    expect(out.xMax).toBe(16);  // +4
    expect(out.yMax).toBe(28);  // +5
    expect(out.zMax).toBe(30 + 0x10);
  });
});

// ─── typeCode out-of-range for default path ───────────────────────────────────

describe("typeCode 0x10 (out of default range) — zero deltas", () => {
  it("typeCode > 0xd (but not a special case) → zero deltas", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const a1Base = 0x401100;
    w16(state, a1Base + 0x0c, 55);
    w16(state, a1Base + 0x10, 66);
    w16(state, a1Base + 0x14, 77);
    romW32(rom, 0x1f016, a1Base);
    const buf = makeRect(0x10, 0); // 0x10 > 0xd
    bufferFill1B12A(state, rom, buf);
    const out = readOut(buf);
    expect(out.xMin).toBe(55);
    expect(out.yMin).toBe(66);
    expect(out.zMin).toBe(77);
    expect(out.xMax).toBe(55);
    expect(out.yMax).toBe(66);
    expect(out.zMax).toBe(77);
  });
});

// ─── word overflow wrapping ───────────────────────────────────────────────────

describe("word overflow — wraps mod 65536", () => {
  it("type 1: large base + size wraps", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const obj = 0x401000;
    // A1[0xc] = 0x7fff: after -3 = 0x7ffc, +6 = 0x8002 → wraps to 0x8002
    w16(state, obj + 0x0c, 0x7fff);
    w16(state, obj + 0x10, 0);
    w16(state, obj + 0x14, 0);
    romW32(rom, 0x1eff6, obj);
    const buf = makeRect(1, 0);
    bufferFill1B12A(state, rom, buf);
    const xMin = readWord(buf, 2);
    const xMax = readWord(buf, 8);
    expect(xMin).toBe(0x7ffc);     // 0x7fff - 3 = 32764
    expect(xMax).toBe(0x8002 - 0x10000); // 0x8002 = -32766 signed (wraps)
  });
});
