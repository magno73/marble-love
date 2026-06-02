/**
 * render-tile-line-1ad54.test.ts — smoke test of `FUN_0001AD54`.
 *
 * `packages/cli/src/test-render-tile-line-1ad54-parity.ts`.
 *
 *   - Struct 8-byte @ workRam off 0x1000 (abs 0x401000).
 *   - Pointer-table root @ workRam off 0x0474 (abs 0x400474): punta a un
 *   - Data ptr @ 0x401300: stream of byte; 0x80 = sentinel (reset A2).
 *   - Fake direction table in ROM @ 0x1ECEA.
 *   - Buffer output @ 0x400A9C (workRam off 0x0A9C).
 */

import { describe, it, expect } from "vitest";
import {
  renderTileLine1AD54,
  CELL_BUF_ABS,
  GRID_COLS,
  CELL_BYTES,
  PTR_TABLE_ROOT,
  DIR_TABLE_ROM,
} from "../src/render-tile-line-1ad54.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import type { GameState } from "../src/state.js";
import type { RomImage } from "../src/bus.js";

// ─── Costanti test ───────────────────────────────────────────────────────────

const WR_BASE   = 0x400000;
const DESC_ABS  = 0x401000;  // struct 8-byte
const ROOT_ABS  = 0x401100;
const PTRTBL_ABS = 0x401200;
const DATA_ABS  = 0x401300;

// ─── Helper ──────────────────────────────────────────────────────────────────

function wr32(s: GameState, abs: number, v: number): void {
  const o = abs - WR_BASE;
  s.workRam[o]   = (v >>> 24) & 0xff;
  s.workRam[o+1] = (v >>> 16) & 0xff;
  s.workRam[o+2] = (v >>> 8)  & 0xff;
  s.workRam[o+3] = v          & 0xff;
}

function wr16(s: GameState, abs: number, v: number): void {
  const o = abs - WR_BASE;
  s.workRam[o]   = (v >>> 8) & 0xff;
  s.workRam[o+1] = v         & 0xff;
}

function rd16(s: GameState, abs: number): number {
  const o = abs - WR_BASE;
  return (((s.workRam[o] ?? 0) << 8) | (s.workRam[o+1] ?? 0)) & 0xffff;
}

function wr16rom(r: RomImage, abs: number, v: number): void {
  r.program[abs]   = (v >>> 8) & 0xff;
  r.program[abs+1] = v         & 0xff;
}

/**
 *   - PTR_TABLE_ROOT → ROOT_ABS (long)
 *   - PTRTBL_ABS + subIdx*4 → DATA_ABS (long, data ptr)
 *   - ROM direction table @DIR_TABLE_ROM + dirIdx*4: (dx, dy) as word signed
 */
function setupEnv(
  s: GameState,
  r: RomImage,
  opts: {
    subIdx?: number;
    dirIdx?: number;
    dx?: number;
    dy?: number;
    dataBytes?: number[];
  } = {},
): void {
  const {
    subIdx  = 0,
    dirIdx  = 0,
    dx      = 1,
    dy      = 1,
    dataBytes = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  } = opts;

  // PTR_TABLE_ROOT (long @ WR off 0x0474) → ROOT_ABS
  wr32(s, PTR_TABLE_ROOT, ROOT_ABS);
  // *(ROOT_ABS+0x20) → PTRTBL_ABS
  wr32(s, ROOT_ABS + 0x20, PTRTBL_ABS);
  // PTRTBL_ABS + subIdx*4 → DATA_ABS
  wr32(s, PTRTBL_ABS + subIdx * 4, DATA_ABS);
  // Data stream
  for (let i = 0; i < dataBytes.length; i++) {
    s.workRam[DATA_ABS - WR_BASE + i] = dataBytes[i]! & 0xff;
  }
  // Direction table in ROM @ DIR_TABLE_ROM + dirIdx*4: (dx, dy)
  wr16rom(r, DIR_TABLE_ROM + dirIdx * 4,     dx  & 0xffff);
  wr16rom(r, DIR_TABLE_ROM + dirIdx * 4 + 2, dy  & 0xffff);
}

/**
 * Costruisce la struct descrittore a 8 byte @ DESC_ABS.
 *
 *   byte[0] = x_base (int8)
 *   byte[1] = x_count (uint8)
 *   byte[2] = y_base (int8)
 *   byte[3] = y_count (uint8)
 *   byte[4..5] = flags_word (value used in D1 computation)
 *   byte[6] = extra (bit 7 → A4|=0x80; bits 6:5 → A4 bits; bits 4:0 = subIdx)
 *   byte[7] = lookup (bit 3 = subMode; bits 2:0 = dirIdx)
 */
function makeDesc(
  s: GameState,
  opts: {
    xBase?:      number;
    xCount?:     number;
    yBase?:      number;
    yCount?:     number;
    flagsWord?:  number;
    extra?:      number;
    lookup?:     number;
  } = {},
): void {
  const {
    xBase     = 0,
    xCount    = 2,
    yBase     = 0,
    yCount    = 2,
    flagsWord = 0x0000,
    extra     = 0x00,
    lookup    = 0x00,
  } = opts;
  const o = DESC_ABS - WR_BASE;
  s.workRam[o + 0] = xBase   & 0xff;
  s.workRam[o + 1] = xCount  & 0xff;
  s.workRam[o + 2] = yBase   & 0xff;
  s.workRam[o + 3] = yCount  & 0xff;
  s.workRam[o + 4] = (flagsWord >>> 8) & 0xff;
  s.workRam[o + 5] = flagsWord & 0xff;
  s.workRam[o + 6] = extra   & 0xff;
  s.workRam[o + 7] = lookup  & 0xff;
}

function readCell(s: GameState, row: number, col: number, wordOff: number): number {
  const idx  = col * GRID_COLS + row;
  const abs  = CELL_BUF_ABS + idx * CELL_BYTES + wordOff * 2;
  return rd16(s, abs);
}

// ─── Test ────────────────────────────────────────────────────────────────────

describe("renderTileLine1AD54 — flag == 0 early exit", () => {
  it("flag=0: returns A4 senza scrivere in cell-buf", () => {
    const s = emptyGameState();
    const r = emptyRomImage();
    makeDesc(s, { xBase: 0, extra: 0x80 }); // bit 7 → A4 |= 0x80

    const before = new Uint8Array(s.workRam);
    const ret = renderTileLine1AD54(s, r, DESC_ABS, 0, 0, 0x100, /* flag= */ 0);

    // A4: xBase=0 (bit 0 clear → A4|=1) + extra bit7 (A4|=0x80) = 0x81 = 129
    // sign-ext 0x0081 → 129 (bit 15 not set)
    expect(ret).toBe(129);

    expect(s.workRam).toEqual(before);
  });

  it("flag=0, bit 0 of xBase=1 → A4 NOT ha bit 0", () => {
    const s = emptyGameState();
    const r = emptyRomImage();
    makeDesc(s, { xBase: 0x01 }); // bit 0 set → NOT si setta A4 bit 0
    const ret = renderTileLine1AD54(s, r, DESC_ABS, 0, 0, 0x100, 0);
    expect(ret & 1).toBe(0);
  });

  it("flag=0, bit 0 of xBase=0 → A4 ha bit 0", () => {
    const s = emptyGameState();
    const r = emptyRomImage();
    makeDesc(s, { xBase: 0x00 }); // bit 0 clear → A4 |= 1
    const ret = renderTileLine1AD54(s, r, DESC_ABS, 0, 0, 0x100, 0);
    expect(ret & 1).toBe(1);
  });
});

describe("renderTileLine1AD54 — row-major (dirIdx=0, dx=1, dy=1)", () => {
  it("single cell (1×1): writes on the cell offset +4 (bordo first+last)", () => {
    // Con xBase=0, xCount=1, yBase=0, yCount=1:
    //   loc_neg2 = 0, loc_neg8 = 1
    //   loc_neg4 = 0, loc_neg6 = 1
    //   adj: loc_neg4 = 0+0-1 = -1, loc_neg6 = 1+1-1 = 1
    //   dx=1 >= 0 → outer: A3 starts at loc_neg2=0, ends at loc_neg4+1=0
    //   → outer loop condition: A3 != 0, starts at 0 → immediately exits!
    // Hmm, let's use xBase=0, xCount=2, yBase=0, yCount=2 for a 2×2 test.
    //
    // Actually let's use xBase=3, xCount=2, yBase=2, yCount=2:
    //   loc_neg2 = sign_ext8(3) = 3, loc_neg8 = 2
    //   loc_neg4 = sign_ext8(2) = 2, loc_neg6 = 2
    //   adj: loc_neg4 = 2+3-1 = 4, loc_neg6 = 2+2-1 = 3
    //   dx=1 >= 0 → outer_start = 3, outer_end = 4+1 = 5
    //   dy=1 >= 0 → inner_start = 2, inner_end = 3+1 = 4
    //
    // Loop (row-major, dirIdx=0 → D3=0 < 4):
    //   D6 = inner_start = 2
    //   while D6 != 4:
    //     A3 = outer_start = 3
    //     while A3 != 5:
    //       A1 = D6 + A3 - D5 = D6 + A3 - 0
    //       A0 = (A1>>1) + (D4 - A3) = (A1>>1) + 0 - A3
    //       ...
    //     D6 += 1
    // d5=0, d4=0
    //
    // Iter: D6=2, A3=3: A1=5, A0=(5>>1)+(0-3)=2-3=-1 → skip (A0 < 0)
    // Iter: D6=2, A3=4: A1=6, A0=(6>>1)+(0-4)=3-4=-1 → skip
    // D6=3, A3=3: A1=6, A0=3-3=0 ≥ 0, d2=0 < d0=0x16-0=22 ✓
    //   cell: A1=6, A0=0 → idx = 6*0x16+0 = 132 → base = 132*8+0x400a9c = 0x401A7C
    //   first_row=3, last_row=4, first_col=2, last_col=3
    //   A3=3=first_row, D6=3=last_col → write offset +6
    // D6=3, A3=4: A1=7, A0=(7>>1)+(0-4)=3-4=-1 → skip
    // D6=4: exit
    //
    // Only one write: cell[6][0] at offset +6.
    // cell buf base = 0x400a9c, cellIdx = 6*0x16+0 = 132, cellBase = 132*8+0x400a9c
    const s = emptyGameState();
    const r = emptyRomImage();
    setupEnv(s, r, {
      dirIdx: 0, dx: 1, dy: 1,
      dataBytes: [0x07, 0x80, 0x07, 0x80, 0x07, 0x80, 0x07, 0x80, // data: value 7
                  0x07, 0x80, 0x07, 0x80, 0x07, 0x80, 0x07, 0x80],
    });
    makeDesc(s, {
      xBase: 3, xCount: 2,   // loc_neg2=3, loc_neg8=2
      yBase: 2, yCount: 2,   // loc_neg4=2, loc_neg6=2
      flagsWord: 0x0000,
      extra: 0x00,            // subIdx=0, subMode=0
      lookup: 0x00,           // dirIdx=0, subMode=0
    });

    renderTileLine1AD54(s, r, DESC_ABS, /* d5= */ 0, /* d4= */ 0, /* limit= */ 0x100, /* flag= */ 1);

    // A3=3=first_row, D6=3=last_col → offset +6
    const cellOff = (6 * GRID_COLS + 0) * CELL_BYTES; // A1=6, A0=0
    const cellBase = CELL_BUF_ABS + cellOff;
    // data byte at A2=DATA_ABS is 0x07; subMode=0 → D1 = 7 + 0 = 7
    // But there are skipped iters (D6=2,A3=3 and D6=2,A3=4) that advance A2
    // A2 starts at DATA_ABS.
    // Iter 1 (D6=2,A3=3): skip (A0<0) but A2 advances
    // Iter 2 (D6=2,A3=4): skip, A2 advances
    // Iter 3 (D6=3,A3=3): write! A2 = DATA_ABS+2, byte = 0x07; D1 = 7+0=7
    // Since data[0]=7, data[1]=7 (sentinel check: 7 != 0x80 → no reset)
    // data[2] = 7 → D1 = 7
    expect(rd16(s, (cellBase + 6) >>> 0)).toBe(0x0007);
    // Offsets 0,2,4 must be zero
    expect(rd16(s, (cellBase + 0) >>> 0)).toBe(0);
    expect(rd16(s, (cellBase + 2) >>> 0)).toBe(0);
    expect(rd16(s, (cellBase + 4) >>> 0)).toBe(0);
  });

  it("middle cell: writes su all and 4 the slot (offset 0,2,4,6)", () => {
    // Setup: 3x3 rectangle. Middle cell (row in (first,last), col in (first,last))
    // xBase=2, xCount=3 → loc_neg2=2, loc_neg8=3
    // yBase=1, yCount=3 → loc_neg4=1, loc_neg6=3
    // adj: loc_neg4 = 1+2-1=2, loc_neg6 = 3+3-1=5
    // dx=1>=0: outer_start=2, outer_end=3
    // dy=1>=0: inner_start=3, inner_end=6
    // d5=0, d4=10
    //
    // Iterate D6 in [3..5], A3 in [2..2] (outer_end=3, so A3 stops at 3)
    // A3=2 is both first_row and last_row (only row), D6 varies.
    //
    // Actually with outer_start=2, outer_end=3: A3 iterates 2 → (2+1=3, stop).
    // Only one outer iter with A3=2.
    //
    // With D6=3,4,5 (inner), A3=2:
    // D6=3,A3=2: A1=3+2=5, A0=(5>>1)+(10-2)=2+8=10
    //   D2=10 < 0x16 ✓; cellIdx = 5*0x16+10=5*22+10=120; cellBase=120*8+0x400a9c
    //   A3=2=first_row=last_row(both), D6=3=first_col → write +4 (first row) and +2 (last row)?
    //   Hmm with only 1 row: first_row == last_row. This won't show "middle" behavior.
    //
    // Let me reconsider: need at least 3 rows for middle cell.
    // xBase=5, xCount=1 → loc_neg2=5, loc_neg8=1
    // yBase=1, yCount=1 → loc_neg4=1, loc_neg6=1
    // adj: loc_neg4=1+5-1=5, loc_neg6=1+1-1=1
    // dx=1>=0: outer_start=5, outer_end=6
    // dy=1>=0: inner_start=1, inner_end=2
    // D6 in [1], A3 in [5]: single cell
    // A1=1+5=6, A0=(6>>1)+(d4-5)=3+(d4-5) → d4=5: A0=3, d2=3 < 22 ✓
    // cellIdx=6*22+3=135; cellBase=135*8+0x400a9c
    // A3=5=first_row=last_row, D6=1=first_col=last_col
    // → "first row, first col" → write +4 only
    //
    // For a real middle cell test, we need 3 rows × 3 cols and hit the center.
    // xBase=10, xCount=3 → loc_neg2=10, loc_neg8=3
    // yBase=4, yCount=3 → loc_neg4=4, loc_neg6=3
    // adj: loc_neg4=4+10-1=13, loc_neg6=3+3-1=5
    // dx=1>=0: outer_start=10, outer_end=14
    // dy=1>=0: inner_start=3, inner_end=6
    // d5=0, d4=14
    //
    // D6=3,A3=10: A1=13, A0=(13>>1)+(14-10)=6+4=10 ≥ 0, D2=10<22 ✓
    //   cellIdx=13*22+10=296; A3=10=first_row, D6=3=first_col → write +4
    // D6=3,A3=11: A1=14, A0=(14>>1)+(14-11)=7+3=10; idx=14*22+10=318; A3=11=middle_row, D6=3=first_col → write +2,+4
    // D6=3,A3=12: A1=15, A0=(15>>1)+(14-12)=7+2=9; idx=15*22+9=339; A3=12=middle_row, D6=3=first_col → write +2,+4
    // D6=3,A3=13: A1=16, A0=8+(14-13)=8+1=9; idx=16*22+9=361; A3=13=middle_row, D6=3=first_col → write +2,+4
    // ...etc
    //
    // D6=4,A3=11: A1=15, A0=7+(14-11)=10; idx=15*22+10=340; A3=11=middle_row, D6=4=middle_col → write +0,+2,+4,+6
    //
    // Let's check the case D6=4, A3=11 (middle row, middle col):

    const s = emptyGameState();
    const r = emptyRomImage();

    // constant data value 5 (no sentinel)
    const data = new Array(64).fill(5);
    setupEnv(s, r, {
      dirIdx: 0, dx: 1, dy: 1,
      dataBytes: data,
    });
    makeDesc(s, {
      xBase: 10, xCount: 3,   // loc_neg2=10, loc_neg8=3
      yBase: 4,  yCount: 3,   // loc_neg4=4, loc_neg6=3
      flagsWord: 0x0000,
      extra: 0x00,
      lookup: 0x00,
    });

    renderTileLine1AD54(s, r, DESC_ABS, 0, 14, 0x100, 1);

    // Middle cell: A3=11=middle_row, D6=4=middle_col
    // A1 = 4+11 = 15, A0 = (15>>1)+(14-11) = 7+3 = 10
    // cellIdx = 15*22+10 = 340
    const cellIdx = 15 * 22 + 10;
    const cellBase = CELL_BUF_ABS + cellIdx * CELL_BYTES;
    // All 4 slots must be written with D1 = 5 + 0 = 5
    expect(rd16(s, (cellBase + 0) >>> 0)).toBe(5);
    expect(rd16(s, (cellBase + 2) >>> 0)).toBe(5);
    expect(rd16(s, (cellBase + 4) >>> 0)).toBe(5);
    expect(rd16(s, (cellBase + 6) >>> 0)).toBe(5);
  });

  it("A2 reset su sentinella 0x80", () => {
    const s = emptyGameState();
    const r = emptyRomImage();

    // Data: [0x0A, 0x80, 0x0A, 0x80, ...]
    // byte 0x0A (= 10), poi 0x80 → reset; poi of nuovo 0x0A → 10, 0x80 → reset...
    const data = [];
    for (let i = 0; i < 32; i++) data.push(i % 2 === 0 ? 0x0A : 0x80);
    setupEnv(s, r, {
      dirIdx: 0, dx: 1, dy: 1,
      dataBytes: data,
    });
    makeDesc(s, {
      xBase: 5, xCount: 1,   // loc_neg2=5, loc_neg8=1
      yBase: 1, yCount: 1,   // loc_neg4=1, loc_neg6=1
      flagsWord: 0x0001,     // flags_word = 1 (added to A2 byte)
      extra: 0x00,
      lookup: 0x00,
    });
    // A3=5, D6=1: A1=6, A0=(6>>1)+(d4-5); d4=5: A0=3+0=3
    // cellIdx=6*22+3=135, d2=3 < 22 ✓
    // data[0]=0x0A → D1 = 0x0A + 1 = 0x0B (subMode=0, flagsWord=1)
    // A2++ → A2[1]=0x80 → reset. Next iter: A2 = DATA_ABS again.
    // A3=5=first_row=last_row, D6=1=first_col=last_col → write +4
    renderTileLine1AD54(s, r, DESC_ABS, 0, 5, 0x100, 1);

    const cellIdx = 6 * 22 + 3;
    const cellBase = CELL_BUF_ABS + cellIdx * CELL_BYTES;
    // D1 = sign_ext(0x0A) + 1 = 10 + 1 = 11 = 0x0B
    expect(rd16(s, (cellBase + 4) >>> 0)).toBe(0x0B);
  });
});

describe("renderTileLine1AD54 — column-major (dirIdx=4, dx=1, dy=1)", () => {
  it("column-major: outer=A3 col, inner=D6 row, single cell writes +4", () => {
    // dirIdx=4 ≥ 4 → column-major
    // xBase=5, xCount=1 → loc_neg2=5, loc_neg8=1
    // yBase=1, yCount=1 → loc_neg4=1, loc_neg6=1
    // adj: loc_neg4=1+5-1=5, loc_neg6=1+1-1=1
    // dx=1>=0: outer_start=5, outer_end=6
    // dy=1>=0: inner_start=1, inner_end=2
    // column-major: outer=A3 (col), inner=D6 (row)
    // A3=5, D6=1:
    //   A1 = D6 + A3 - d5 = 1+5-0=6
    //   A0 = (6>>1) + (d4 - A3) = 3 + (5-5) = 3
    //   cellIdx = 6*22+3=135
    //   A3=5=first_row, D6=1=first_col=last_col → write +4 (first row, first col)
    const s = emptyGameState();
    const r = emptyRomImage();
    const data = new Array(32).fill(0x42);
    setupEnv(s, r, {
      subIdx: 4, // matches extra & 0x1f
      dirIdx: 4, dx: 1, dy: 1,
      dataBytes: data,
    });

    makeDesc(s, {
      xBase: 5, xCount: 1,
      yBase: 1, yCount: 1,
      flagsWord: 0x0000,
      extra: 0x04,   // subIdx=4 (bit 4:0), bit 7=0, bit 6:5=0
      lookup: 0x04,  // dirIdx=4, subMode=0
    });
    renderTileLine1AD54(s, r, DESC_ABS, 0, 5, 0x100, 1);

    const cellIdx = 6 * 22 + 3;
    const cellBase = CELL_BUF_ABS + cellIdx * CELL_BYTES;
    // D1 = sign_ext(0x42) + 0 = 0x42 = 66
    expect(rd16(s, (cellBase + 4) >>> 0)).toBe(0x42);
  });
});

describe("renderTileLine1AD54 — subMode (lookup bit 3)", () => {
  it("subMode=1: D1 = flagsWord - sign_ext(*A2)", () => {
    // lookup=0x08 → subMode=1, dirIdx=0
    // flagsWord = 0x0064 (100), data byte = 0x0A (10)
    // D1 = 100 - 10 = 90 = 0x5A
    const s = emptyGameState();
    const r = emptyRomImage();
    const data = new Array(32).fill(0x0A);
    setupEnv(s, r, {
      dirIdx: 0, dx: 1, dy: 1,
      dataBytes: data,
    });
    makeDesc(s, {
      xBase: 5, xCount: 1,
      yBase: 1, yCount: 1,
      flagsWord: 0x0064,   // 100
      extra: 0x00,
      lookup: 0x08,        // subMode=1 (bit 3), dirIdx=0
    });
    renderTileLine1AD54(s, r, DESC_ABS, 0, 5, 0x100, 1);

    const cellIdx = 6 * 22 + 3;
    const cellBase = CELL_BUF_ABS + cellIdx * CELL_BYTES;
    expect(rd16(s, (cellBase + 4) >>> 0)).toBe(90);
  });
});
