/**
 * mo-block-emit-1a8d2.test.ts — smoke test of FUN_1A8D2.
 *
 * Here we cover the module's main paths (early-exit, long-branch).
 */

import { describe, it, expect } from "vitest";
import {
  moBlockEmit1A8D2,
  CURSOR_A1_ADDR,
  CURSOR_A2_ADDR,
  CURSOR_A3_ADDR,
  CURSOR_A4_ADDR,
  COUNTER_D7_ADDR,
  ARG0_SENTINEL,
} from "../src/mo-block-emit-1a8d2.js";
import { emptyGameState } from "../src/state.js";
import type { GameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;
const SPRITE_RAM_BASE = 0xa02000;

function writeLongWorkRam(s: GameState, abs: number, val: number): void {
  const off = abs - WORK_RAM_BASE;
  s.workRam[off] = (val >>> 24) & 0xff;
  s.workRam[off + 1] = (val >>> 16) & 0xff;
  s.workRam[off + 2] = (val >>> 8) & 0xff;
  s.workRam[off + 3] = val & 0xff;
}

function writeWordWorkRam(s: GameState, abs: number, val: number): void {
  const off = abs - WORK_RAM_BASE;
  s.workRam[off] = (val >>> 8) & 0xff;
  s.workRam[off + 1] = val & 0xff;
}

function readWordSprite(s: GameState, abs: number): number {
  const off = abs - SPRITE_RAM_BASE;
  const hi = s.spriteRam[off] ?? 0;
  const lo = s.spriteRam[off + 1] ?? 0;
  return ((hi << 8) | lo) & 0xffff;
}

function readLongWorkRam(s: GameState, abs: number): number {
  const off = abs - WORK_RAM_BASE;
  const b0 = s.workRam[off] ?? 0;
  const b1 = s.workRam[off + 1] ?? 0;
  const b2 = s.workRam[off + 2] ?? 0;
  const b3 = s.workRam[off + 3] ?? 0;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

function readWordWorkRam(s: GameState, abs: number): number {
  const off = abs - WORK_RAM_BASE;
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}

/**
 * Standard setup for the 4 cursors + D7 counter. Cursors point to sprite RAM
 * at distant addresses (4 separate buffers).
 */
function setupCursors(
  s: GameState,
  a1 = 0xa02000,
  a2 = 0xa02080,
  a3 = 0xa02100,
  a4 = 0xa02180,
  d7 = 0,
): void {
  writeLongWorkRam(s, CURSOR_A1_ADDR, a1);
  writeLongWorkRam(s, CURSOR_A2_ADDR, a2);
  writeLongWorkRam(s, CURSOR_A3_ADDR, a3);
  writeLongWorkRam(s, CURSOR_A4_ADDR, a4);
  writeWordWorkRam(s, COUNTER_D7_ADDR, d7);
}

describe("moBlockEmit1A8D2 — early exit (arg0 == -1)", () => {
  it("arg0 == 0xFFFFFFFF → writeback only, no sprite-RAM write", () => {
    const s = emptyGameState();
    setupCursors(s, 0xa02000, 0xa02080, 0xa02100, 0xa02180, 0x1234);
    const spriteBefore = new Uint8Array(s.spriteRam);

    moBlockEmit1A8D2(s, ARG0_SENTINEL, 0x100, 0x200, 0x300);

    // Sprite RAM untouched.
    expect(s.spriteRam).toEqual(spriteBefore);

    expect(readLongWorkRam(s, CURSOR_A1_ADDR)).toBe(0xa02000);
    expect(readLongWorkRam(s, CURSOR_A2_ADDR)).toBe(0xa02080);
    expect(readLongWorkRam(s, CURSOR_A3_ADDR)).toBe(0xa02100);
    expect(readLongWorkRam(s, CURSOR_A4_ADDR)).toBe(0xa02180);
    expect(readWordWorkRam(s, COUNTER_D7_ADDR)).toBe(0x1234);
  });
});

describe("moBlockEmit1A8D2 — long branch (word-stream)", () => {
  it("body with count=2 → 2 iters, 4 outputs each, D7 increments by 2", () => {
    const s = emptyGameState();
    setupCursors(s, 0xa02000, 0xa02080, 0xa02100, 0xa02180, 0);

    // Header @ 0x401000:
    //   +0: x_bias_byte = 0x05 (signed = +5)
    //   +1: y_bias_byte = 0x03 (signed = +3)
    //   +8: body_ptr long = 0x401040 (bit0 = 0 ⇒ flag_lo, D5w = 0x100)
    const headerAbs = 0x401000;
    s.workRam[headerAbs - WORK_RAM_BASE + 0] = 0x05;
    s.workRam[headerAbs - WORK_RAM_BASE + 1] = 0x03;
    writeLongWorkRam(s, headerAbs + 8, 0x00401040);

    // Body @ 0x401040:
    //   [0] = 0x02   (count = 2)
    //   [1] = 0x01   (D1 delta byte = +1, signed)
    //   [2] = 0x00   (D4 byte mask = 0)
    //   [3] = 0x02   (D2 delta byte = +2, signed)
    //   [4..5] = word_0 = 0x1234
    //   [6..7] = word_1 = 0xABCD
    s.workRam[0x1040] = 0x02;
    s.workRam[0x1041] = 0x01;
    s.workRam[0x1042] = 0x00;
    s.workRam[0x1043] = 0x02;
    s.workRam[0x1044] = 0x12;
    s.workRam[0x1045] = 0x34;
    s.workRam[0x1046] = 0xab;
    s.workRam[0x1047] = 0xcd;

    // Call: arg1 = 0 (X bias), arg2 = 0 (Y bias), arg3 = 0x4000 (OR mask).
    moBlockEmit1A8D2(s, headerAbs, 0, 0, 0x4000);

    // Expected computations:
    //   D1 = 0; D2 = 0; D3 = 0x4000;
    //   header[+0] = 0x05 (s8 = +5) → D1 += 5 → D1 = 5;
    //   header[+1] = 0x03 (s8 = +3) → D2 += 3 → D2 = 3;
    //   header[+8] = 0x401040, bit0 = 0 → D4 = 0, D5 = 0x100;
    //   body[0] = 2 (≠ 0xFF) → LONG BRANCH;
    //   body[1] = 0x01 → D1 += 1 → D1 = 6; D1 = (6 << 5) & 0x3FE0 = 0xC0;
    //   body[2] = 0x00 → D4 = 0;
    //   body[3] = 0x02 → D2 += 2 → D2 = 5; D2 = (5 << 5) & 0x3FE0 = 0xA0;
    //   D2 |= D4 = 0xA0;
    //
    //   Iter 1:
    //     word = 0x1234 → A1 out = 0x1234 | 0x4000 = 0x5234
    //     A2 out = D1 = 0xC0
    //     A3 out = D2 = 0xA0
    //     A4 out = D7 = 0
    //     D7 = 1; D1 = 0xC0 + 0x100 = 0x1C0
    //   Iter 2:
    //     word = 0xABCD → A1 out = 0xABCD | 0x4000 = 0xEBCD
    //     A2 out = D1 = 0x1C0
    //     A3 out = D2 = 0xA0
    //     A4 out = D7 = 1
    //     D7 = 2; D1 = 0x2C0
    expect(readWordSprite(s, 0xa02000)).toBe(0x5234);
    expect(readWordSprite(s, 0xa02002)).toBe(0xebcd);

    expect(readWordSprite(s, 0xa02080)).toBe(0x00c0);
    expect(readWordSprite(s, 0xa02082)).toBe(0x01c0);

    expect(readWordSprite(s, 0xa02100)).toBe(0x00a0);
    expect(readWordSprite(s, 0xa02102)).toBe(0x00a0);

    expect(readWordSprite(s, 0xa02180)).toBe(0x0000);
    expect(readWordSprite(s, 0xa02182)).toBe(0x0001);

    // Cursor writeback: advanced by 4 bytes (2 iters × 2 bytes/iter).
    expect(readLongWorkRam(s, CURSOR_A1_ADDR)).toBe(0xa02004);
    expect(readLongWorkRam(s, CURSOR_A2_ADDR)).toBe(0xa02084);
    expect(readLongWorkRam(s, CURSOR_A3_ADDR)).toBe(0xa02104);
    expect(readLongWorkRam(s, CURSOR_A4_ADDR)).toBe(0xa02184);

    // Counter D7 writeback = 2.
    expect(readWordWorkRam(s, COUNTER_D7_ADDR)).toBe(2);
  });

  it("body_ptr bit0=1 ⇒ D4=0x8000, D5=0xFF00 (decrement D1)", () => {
    const s = emptyGameState();
    setupCursors(s, 0xa02000, 0xa02080, 0xa02100, 0xa02180, 0);

    const headerAbs = 0x401000;
    s.workRam[headerAbs - WORK_RAM_BASE] = 0; // x_bias = 0
    s.workRam[headerAbs - WORK_RAM_BASE + 1] = 0; // y_bias = 0
    // body_ptr = 0x00401041 (bit0 = 1 ⇒ flag_hi). bclr → 0x00401040.
    writeLongWorkRam(s, headerAbs + 8, 0x00401041);

    // Body @ 0x401040 (bit0 cleared):
    s.workRam[0x1040] = 0x02; // count = 2
    s.workRam[0x1041] = 0x00; // D1 delta = 0
    s.workRam[0x1042] = 0x55; // D4 byte = 0x55
    s.workRam[0x1043] = 0x00; // D2 delta = 0
    s.workRam[0x1044] = 0x00;
    s.workRam[0x1045] = 0x00;
    s.workRam[0x1046] = 0x00;
    s.workRam[0x1047] = 0x00;

    moBlockEmit1A8D2(s, headerAbs, 0x100, 0x100, 0);

    // D1 = 0x100; D2 = 0x100;
    // body[1] = 0 → D1 unchanged; D1 = (0x100 << 5) & 0x3FE0 = 0x2000
    // body[2] = 0x55 → D4 = 0x8000 OR'd low byte = 0x8055
    // body[3] = 0 → D2 = (0x100 << 5) & 0x3FE0 = 0x2000; D2 |= D4 = 0xA055
    //
    // Iter 1: A2 = D1 = 0x2000; A3 = D2 = 0xA055; D1 += 0xFF00 → 0x1F00
    // Iter 2: A2 = D1 = 0x1F00; A3 = D2 = 0xA055; D1 += 0xFF00 → 0x1E00
    expect(readWordSprite(s, 0xa02080)).toBe(0x2000);
    expect(readWordSprite(s, 0xa02082)).toBe(0x1f00);

    expect(readWordSprite(s, 0xa02100)).toBe(0xa055);
    expect(readWordSprite(s, 0xa02102)).toBe(0xa055);
  });
});

describe("moBlockEmit1A8D2 — short branch (triple-stream)", () => {
  it("body[0] == 0xFF → triple-stream, 3 iters with D4 reset per iter", () => {
    const s = emptyGameState();
    setupCursors(s, 0xa02000, 0xa02080, 0xa02100, 0xa02180, 0);

    const headerAbs = 0x401000;
    s.workRam[headerAbs - WORK_RAM_BASE + 0] = 0; // x_bias = 0
    s.workRam[headerAbs - WORK_RAM_BASE + 1] = 0; // y_bias = 0
    writeLongWorkRam(s, headerAbs + 8, 0x00401040); // bit0 = 0 ⇒ flag_lo

    // Body @ 0x401040 (short branch):
    //   [0] = 0xFF (triggers short branch)
    //   [1] = ??   (skipped by addq.l #1,A0)
    //   [2] = 0x02 (real count = 2)
    //   [3] = 0x01 (D1 delta = +1)
    //   [4..9]   = triple 0: byte_d4=0xAA, byte_d2_delta=+1, word=0x1234
    //   [10..15] = triple 1: byte_d4=0xBB, byte_d2_delta=+2, word=0xABCD
    s.workRam[0x1040] = 0xff;
    s.workRam[0x1041] = 0x99; // skipped
    s.workRam[0x1042] = 0x02;
    s.workRam[0x1043] = 0x01;
    // triple 0
    s.workRam[0x1044] = 0xaa;
    s.workRam[0x1045] = 0x01;
    s.workRam[0x1046] = 0x12;
    s.workRam[0x1047] = 0x34;
    // triple 1
    s.workRam[0x1048] = 0xbb;
    s.workRam[0x1049] = 0x02;
    s.workRam[0x104a] = 0xab;
    s.workRam[0x104b] = 0xcd;

    moBlockEmit1A8D2(s, headerAbs, 0, 0, 0x4000);

    // D1 = 0, D2 = 0, D3 = 0x4000
    // header[+0] = 0 → D1 unchanged; header[+1] = 0 → D2 unchanged.
    // bit0 = 0 → D4 = 0, D5 = 0x100.
    // body[0] = 0xFF → SHORT BRANCH.
    // skip body[1].
    // count = body[2] = 2.
    // body[3] = 0x01 → D1 += 1 = 1; D1 = (1 << 5) & 0x3FE0 = 0x20.
    //
    // Iter 1:
    //   A2 out = D1 = 0x20
    //   D4 &= 0x8000 → D4 = 0; D4 |= 0xAA → D4 = 0xAA
    //   D0 = D2 + s8(0x01) = 0+1 = 1; D0 = (1<<5) & 0x3FE0 = 0x20; D0 |= D4 = 0xAA
    //   A3 out = 0xAA
    //   word = 0x1234; A1 out = 0x1234 | 0x4000 = 0x5234
    //   A4 out = D7 = 0
    //   D7 = 1; D1 += 0x100 → 0x120
    // Iter 2:
    //   A2 out = D1 = 0x120
    //   D4 &= 0x8000 → 0; D4 |= 0xBB → 0xBB
    //   D0 = 0 + s8(0x02) = 2; D0 = (2<<5) & 0x3FE0 = 0x40; D0 |= 0xBB → 0xFB
    //   A3 out = 0xFB
    //   word = 0xABCD; A1 out = 0xABCD | 0x4000 = 0xEBCD
    //   A4 out = D7 = 1
    //   D7 = 2; D1 += 0x100 → 0x220
    expect(readWordSprite(s, 0xa02080)).toBe(0x0020);
    expect(readWordSprite(s, 0xa02082)).toBe(0x0120);

    expect(readWordSprite(s, 0xa02100)).toBe(0x00aa);
    expect(readWordSprite(s, 0xa02102)).toBe(0x00fb);

    expect(readWordSprite(s, 0xa02000)).toBe(0x5234);
    expect(readWordSprite(s, 0xa02002)).toBe(0xebcd);

    expect(readWordSprite(s, 0xa02180)).toBe(0x0000);
    expect(readWordSprite(s, 0xa02182)).toBe(0x0001);

    expect(readWordWorkRam(s, COUNTER_D7_ADDR)).toBe(2);
  });

  it("short branch with bit0=1 ⇒ D4 keeps 0x8000 across iters", () => {
    const s = emptyGameState();
    setupCursors(s, 0xa02000, 0xa02080, 0xa02100, 0xa02180, 0);

    const headerAbs = 0x401000;
    s.workRam[headerAbs - WORK_RAM_BASE] = 0;
    s.workRam[headerAbs - WORK_RAM_BASE + 1] = 0;
    // bit0=1 ⇒ D4 starts at 0x8000.
    writeLongWorkRam(s, headerAbs + 8, 0x00401041);

    s.workRam[0x1040] = 0xff; // short branch trigger
    s.workRam[0x1041] = 0x00;
    s.workRam[0x1042] = 0x01; // count = 1
    s.workRam[0x1043] = 0x00; // D1 delta = 0
    // triple 0
    s.workRam[0x1044] = 0x12; // byte_d4
    s.workRam[0x1045] = 0x00; // byte_d2_delta
    s.workRam[0x1046] = 0x00;
    s.workRam[0x1047] = 0x00;

    moBlockEmit1A8D2(s, headerAbs, 0, 0, 0);

    // D4 starts at 0x8000.
    // Iter 1: D4 &= 0x8000 → 0x8000; D4 |= 0x12 → 0x8012.
    // D0 = 0 + 0 = 0; D0 << 5 & 0x3FE0 = 0; D0 |= D4 = 0x8012.
    // A3 out = 0x8012.
    expect(readWordSprite(s, 0xa02100)).toBe(0x8012);
  });
});

describe("moBlockEmit1A8D2 — sign-ext byte arithmetic", () => {
  it("negative header byte (0xFF = -1) ⇒ D1 decrements", () => {
    const s = emptyGameState();
    setupCursors(s, 0xa02000, 0xa02080, 0xa02100, 0xa02180, 0);

    const headerAbs = 0x401000;
    // x_bias_byte = 0xFF (signed = -1)
    s.workRam[headerAbs - WORK_RAM_BASE] = 0xff;
    s.workRam[headerAbs - WORK_RAM_BASE + 1] = 0;
    writeLongWorkRam(s, headerAbs + 8, 0x00401040);

    s.workRam[0x1040] = 0x01; // count = 1
    s.workRam[0x1041] = 0x00;
    s.workRam[0x1042] = 0x00;
    s.workRam[0x1043] = 0x00;
    s.workRam[0x1044] = 0x00;
    s.workRam[0x1045] = 0x00;

    // arg1 = 0x10. After header: D1 = 0x10 + (-1) = 0xF.
    // body[1] = 0 → D1 unchanged = 0xF.
    // D1 << 5 = 0x1E0; & 0x3FE0 = 0x1E0.
    moBlockEmit1A8D2(s, headerAbs, 0x10, 0, 0);

    expect(readWordSprite(s, 0xa02080)).toBe(0x01e0);
  });
});

describe("moBlockEmit1A8D2 — count = 1 path (single iter)", () => {
  it("body count = 1 ⇒ exactly 1 iter (subq.b/bne ⇒ do/while)", () => {
    const s = emptyGameState();
    setupCursors(s, 0xa02000, 0xa02080, 0xa02100, 0xa02180, 0);

    const headerAbs = 0x401000;
    s.workRam[headerAbs - WORK_RAM_BASE] = 0;
    s.workRam[headerAbs - WORK_RAM_BASE + 1] = 0;
    writeLongWorkRam(s, headerAbs + 8, 0x00401040);

    s.workRam[0x1040] = 0x01; // count = 1 (exactly 1 iter)
    s.workRam[0x1041] = 0x00;
    s.workRam[0x1042] = 0x00;
    s.workRam[0x1043] = 0x00;
    s.workRam[0x1044] = 0xde;
    s.workRam[0x1045] = 0xad;

    moBlockEmit1A8D2(s, headerAbs, 0, 0, 0);

    // Exactly 1 word written in each buffer.
    expect(readWordSprite(s, 0xa02000)).toBe(0xdead);
    // Cursor advanced by exactly 2 bytes.
    expect(readLongWorkRam(s, CURSOR_A1_ADDR)).toBe(0xa02002);
    expect(readWordWorkRam(s, COUNTER_D7_ADDR)).toBe(1);
  });
});
