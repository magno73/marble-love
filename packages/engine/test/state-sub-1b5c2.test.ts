/**
 * state-sub-1b5c2.test.ts — smoke tests per `FUN_0001B5C2` (838 byte).
 *
 * "Position-steering applicator": applica absLong / negateIfPositive a D3/D4
 * (coord X/Y di un struct) in base a 8 blocchi condizionali pilotati da flag
 * cardinali, gate word e direction bitmap.
 *
 * Bit-perfect verificato vs binary tramite
 * `packages/cli/src/test-state-sub-1b5c2-parity.ts` (500/500 cases).
 */

import { describe, it, expect } from "vitest";
import {
  stateSub1B5C2,
  CHG_X_OFF,
  CHG_Y_OFF,
  FLAG_PX_OFF,
  FLAG_PY_OFF,
  FLAG_NX_OFF,
  FLAG_NY_OFF,
  GATE_PX_OFF,
  GATE_PY_OFF,
  GATE_NX_OFF,
  GATE_NY_OFF,
  GATE_7C_OFF,
  GATE_7E_OFF,
  GATE_80_OFF,
  GATE_82_OFF,
  STRUCT_X_SRC_OFF,
  STRUCT_Y_SRC_OFF,
  GATE_A0_OFF,
  TRACK_X_CUR_OFF,
  TRACK_X_BASE_OFF,
  TRACK_Y_CUR_OFF,
  TRACK_Y_BASE_OFF,
  SOUND_CMD,
} from "../src/state-sub-1b5c2.js";
import { emptyGameState } from "../src/state.js";

/** M68k absolute address for the test struct (must be in workRam range). */
const STRUCT_ADDR = 0x400100 as const;
/** M68k absolute address for the direction bitmap byte. */
const BITMAP_ADDR = 0x400200 as const;
/** M68k absolute address for the D2 word (rotation-like index). */
const D2W_ADDR = 0x400300 as const;

function wOff(addr: number): number {
  return addr - 0x400000;
}

type State = ReturnType<typeof emptyGameState>;

function wl(s: State, off: number, v: number): void {
  const x = v >>> 0;
  s.workRam[off] = (x >>> 24) & 0xff;
  s.workRam[off + 1] = (x >>> 16) & 0xff;
  s.workRam[off + 2] = (x >>> 8) & 0xff;
  s.workRam[off + 3] = x & 0xff;
}

function rl(s: State, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function ww(s: State, off: number, v: number): void {
  const x = v & 0xffff;
  s.workRam[off] = (x >>> 8) & 0xff;
  s.workRam[off + 1] = x & 0xff;
}

/** Set struct fields: x = A2[0], y = A2[4]. */
function setStruct(s: State, x: number, y: number): void {
  wl(s, wOff(STRUCT_ADDR), x);
  wl(s, wOff(STRUCT_ADDR) + 4, y);
}

/** Set the direction bitmap byte @ BITMAP_ADDR. */
function setBitmap(s: State, bits: number): void {
  s.workRam[wOff(BITMAP_ADDR)] = bits & 0xff;
}

/** Set the D2 word (rotation index) @ D2W_ADDR. */
function setD2Word(s: State, v: number): void {
  ww(s, wOff(D2W_ADDR), v);
}

/** Set delta globals so D5 = cur-base. */
function setDeltaX(s: State, delta: number): void {
  const d = delta & 0xffff;
  // base=0, cur=delta
  ww(s, TRACK_X_BASE_OFF, 0);
  ww(s, TRACK_X_CUR_OFF, d);
}

function setDeltaY(s: State, delta: number): void {
  const d = delta & 0xffff;
  ww(s, TRACK_Y_BASE_OFF, 0);
  ww(s, TRACK_Y_CUR_OFF, d);
}

// ─── Helpers: construct a "gate active" condition ─────────────────────────

/** Set all cardinal gates ≥ 4 (active). */
function setGatesActive(s: State): void {
  ww(s, GATE_PX_OFF, 5);
  ww(s, GATE_PY_OFF, 5);
  ww(s, GATE_NX_OFF, 5);
  ww(s, GATE_NY_OFF, 5);
  ww(s, GATE_7C_OFF, 5);
  ww(s, GATE_7E_OFF, 5);
  ww(s, GATE_80_OFF, 5);
  ww(s, GATE_82_OFF, 5);
}

describe("stateSub1B5C2 (FUN_0001B5C2)", () => {

  it("no-op: all flags zero, no bitmap bits, no change", () => {
    const s = emptyGameState();
    setStruct(s, 0xdeadbeef, 0xcafebabe);
    setBitmap(s, 0);
    setD2Word(s, 0);
    setDeltaX(s, 0);
    setDeltaY(s, 0);
    // All direction flags = 0, no bitmap bits.
    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    // D3 and D4 unchanged → no write-back.
    expect(r.xChanged).toBe(false);
    expect(r.yChanged).toBe(false);
    expect(r.soundFired).toBe(false);
    expect(rl(s, wOff(STRUCT_ADDR))).toBe(0xdeadbeef);
    expect(rl(s, wOff(STRUCT_ADDR) + 4)).toBe(0xcafebabe);
  });

  it("block1 path A: absLong(D3) via flagPX∈[1,2] + wd2<4 + gPX≥4", () => {
    const s = emptyGameState();
    // D3 = negative value: absLong should make it positive.
    setStruct(s, 0xffff8000, 0x00001234); // x = -32768 signed, y = 0x1234
    setBitmap(s, 0);
    setD2Word(s, 2);       // wd2 = 2 < 4 ✓
    setDeltaX(s, 0);
    setDeltaY(s, 0);
    setGatesActive(s);     // gPX = 5 ≥ 4 ✓
    s.workRam[FLAG_PX_OFF] = 1; // flagPX = 1 ∈ [1,2] ✓
    // D2 is also < 4, gPX is 5 (both conditions met for path A).

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    // absLong(0xffff8000) = 0x8000 (positive 32768)
    expect(r.d3Out).toBe(0x00008000);
    expect(r.xChanged).toBe(true);
    // D4 (y = 0x1234) not changed by block1.
    // Verify y unchanged (since no condition fires for y here with delta=0, fPY=0, fNY=0).
    expect(r.yChanged).toBe(false);
  });

  it("block1 path B: absLong(D3) via flagNX>2 + D5==1 + gNX≥4", () => {
    const s = emptyGameState();
    setStruct(s, 0xfffffff0, 0x00000001); // x = -16 signed
    setBitmap(s, 0);
    setD2Word(s, 0);
    setDeltaX(s, 1);       // D5 = 1 ✓
    setDeltaY(s, 0);
    setGatesActive(s);     // gNX = 5 ≥ 4 ✓
    s.workRam[FLAG_NX_OFF] = 3; // flagNX = 3 > 2 ✓

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    // absLong(-16) = 16 = 0x10
    expect(r.d3Out).toBe(0x10);
    expect(r.xChanged).toBe(true);
  });

  it("block2 path B: negateIfPositive(D4) via flagNY>2 + D6==-1 + gNY≥4", () => {
    const s = emptyGameState();
    setStruct(s, 0x00000001, 0x00000040); // x=1, y=0x40 (positive)
    setBitmap(s, 0);
    setD2Word(s, 0);
    setDeltaX(s, 0);
    setDeltaY(s, 0xffff);  // D6 = -1 (signed word 0xFFFF) ✓
    setGatesActive(s);     // gNY = 5 ≥ 4 ✓
    s.workRam[FLAG_NY_OFF] = 3; // flagNY = 3 > 2 ✓

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    // negateIfPositive(0x40) = -0x40 = 0xffffffc0
    expect(r.d4Out).toBe(0xffffffc0 >>> 0);
    expect(r.yChanged).toBe(true);
  });

  it("block3 path A: negateIfPositive(D3) via flagNX∈[1,2] + wd2>4 + gNX≥4", () => {
    const s = emptyGameState();
    setStruct(s, 0x00000100, 0x00000001); // x = 0x100 (positive)
    setBitmap(s, 0);
    setD2Word(s, 6);       // wd2 = 6 > 4 ✓
    setDeltaX(s, 0);
    setDeltaY(s, 0);
    setGatesActive(s);     // gNX = 5 ≥ 4 ✓
    s.workRam[FLAG_NX_OFF] = 2; // flagNX = 2 ∈ [1,2] ✓

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    // negateIfPositive(0x100) = -0x100 = 0xffffff00
    expect(r.d3Out).toBe(0xffffff00 >>> 0);
    expect(r.xChanged).toBe(true);
  });

  it("block4 path B: absLong(D4) via flagPY>2 + D6==1 + gPY≥4", () => {
    const s = emptyGameState();
    setStruct(s, 0x00000001, 0xffff0000); // x=1, y = -65536 signed (negative)
    setBitmap(s, 0);
    setD2Word(s, 0);
    setDeltaX(s, 0);
    setDeltaY(s, 1);       // D6 = 1 ✓
    setGatesActive(s);     // gPY = 5 ≥ 4 ✓
    s.workRam[FLAG_PY_OFF] = 3; // flagPY = 3 > 2 ✓

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    // absLong(0xffff0000) = 0x00010000 (65536)
    expect(r.d4Out).toBe(0x00010000);
    expect(r.yChanged).toBe(true);
  });

  it("block5 path B (btst#6): negateIfPositive(D4)+absLong(D3) via bit6+D5!=0+D6!=0+g80≥4", () => {
    const s = emptyGameState();
    // D3 = negative, D4 = positive.
    setStruct(s, 0xffffff80, 0x00001000); // x = -128, y = 0x1000
    setBitmap(s, 0x40); // bit 6 ✓
    setD2Word(s, 0);
    setDeltaX(s, 5);    // D5 = 5 ≠ 0 ✓
    setDeltaY(s, 2);    // D6 = 2 ≠ 0 ✓
    ww(s, GATE_80_OFF, 5); // g80 = 5 ≥ 4 ✓

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    // negateIfPositive(0x1000) = -0x1000 = 0xfffff000
    // absLong(0xffffff80) = 0x80 (128)
    expect(r.d4Out).toBe(0xfffff000 >>> 0);
    expect(r.d3Out).toBe(0x80);
    expect(r.xChanged).toBe(true);
    expect(r.yChanged).toBe(true);
  });

  it("block8 path B (btst#5): absLong(D4)+absLong(D3) via bit5+D5!=0+D6!=0+g7E≥4", () => {
    const s = emptyGameState();
    setStruct(s, 0xffff0001, 0xfffffffe); // both negative
    setBitmap(s, 0x20); // bit 5 ✓
    setD2Word(s, 0);
    setDeltaX(s, 1);   // D5 = 1 ≠ 0 ✓
    setDeltaY(s, 1);   // D6 = 1 ≠ 0 ✓
    ww(s, GATE_7E_OFF, 5); // g7E = 5 ≥ 4 ✓

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    // absLong(0xffff0001) = 0x0000ffff
    // absLong(0xfffffffe) = 0x00000002
    expect(r.d3Out).toBe(0x0000ffff);
    expect(r.d4Out).toBe(0x00000002);
    expect(r.xChanged).toBe(true);
    expect(r.yChanged).toBe(true);
  });

  it("write-back: sound fires when at least one changed flag is set", () => {
    const s = emptyGameState();
    setStruct(s, 0xffff8000, 0x00001000);
    setBitmap(s, 0);
    setD2Word(s, 2);       // wd2 = 2 < 4
    setGatesActive(s);
    s.workRam[FLAG_PX_OFF] = 1; // trigger block1 path A → absLong(D3)

    let soundCmd = -1;
    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR, {
      fun_158ac: (_st, cmd) => { soundCmd = cmd; },
    });
    expect(r.xChanged).toBe(true);
    expect(r.soundFired).toBe(true);
    expect(soundCmd).toBe(SOUND_CMD);
    expect(SOUND_CMD).toBe(0x34);
  });

  it("treats direction flag bytes as signed comparisons", () => {
    const s = emptyGameState();
    setStruct(s, 0xffff8000, 0x00001000);
    setBitmap(s, 0x00);
    setD2Word(s, 2);
    ww(s, GATE_PX_OFF, 5);
    s.workRam[FLAG_PX_OFF] = 0xfa; // -6 as signed byte: non-zero and < 3

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);

    expect(r.xChanged).toBe(true);
    expect(r.d3Out).toBe(0x00008000);
  });

  it("block8 path A skips when the D2 word is >= 4", () => {
    const s = emptyGameState();
    setStruct(s, 0xfffde759, 0x00013d8e); // bridge slot: vx negative, vy positive
    setBitmap(s, 0x08); // bit 3 set
    setD2Word(s, 6); // wd2 >= 4 skips path A in the binary
    setDeltaX(s, 1); // D5 != -1
    setDeltaY(s, 0); // D6 != -1
    ww(s, GATE_A0_OFF, 2); // wa0 < 4
    ww(s, GATE_82_OFF, 15); // g82 >= 4

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);

    expect(r.xChanged).toBe(false);
    expect(r.yChanged).toBe(false);
    expect(r.d3Out).toBe(0xfffde759);
    expect(r.d4Out).toBe(0x00013d8e);
    expect(s.workRam[CHG_X_OFF]).toBe(0);
    expect(s.workRam[CHG_Y_OFF]).toBe(0);
  });

  it("block8 path A fires when the D2 word is < 4", () => {
    const s = emptyGameState();
    setStruct(s, 0xfffde759, 0xffff0000);
    setBitmap(s, 0x08); // bit 3 set
    setD2Word(s, 3); // wd2 < 4 lets path A continue
    setDeltaX(s, 1);
    setDeltaY(s, 0);
    ww(s, GATE_A0_OFF, 2);
    ww(s, GATE_82_OFF, 15);

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);

    expect(r.xChanged).toBe(true);
    expect(r.yChanged).toBe(true);
    expect(r.d3Out).toBe(0x000218a7);
    expect(r.d4Out).toBe(0x00010000);
  });

  it("write-back: STRUCT_X_SRC written to A2+0xC when x changes", () => {
    const s = emptyGameState();
    setStruct(s, 0xffff8000, 0x00001000);
    setBitmap(s, 0);
    setD2Word(s, 2);
    setGatesActive(s);
    s.workRam[FLAG_PX_OFF] = 1;
    // Set STRUCT_X_SRC_OFF to a known value.
    wl(s, STRUCT_X_SRC_OFF, 0xaabbccdd);

    stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    // A2+0xC should have been written with long@STRUCT_X_SRC_OFF.
    expect(rl(s, wOff(STRUCT_ADDR) + 0xc)).toBe(0xaabbccdd);
  });

  it("write-back: STRUCT_Y_SRC written to A2+0x10 when y changes", () => {
    const s = emptyGameState();
    setStruct(s, 0x00000001, 0xffff0000); // y negative
    setBitmap(s, 0);
    setD2Word(s, 0);
    setDeltaY(s, 1);
    setGatesActive(s);
    s.workRam[FLAG_PY_OFF] = 3; // flagPY > 2, triggers block4 path B
    wl(s, STRUCT_Y_SRC_OFF, 0x11223344);

    stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    expect(rl(s, wOff(STRUCT_ADDR) + 0x10)).toBe(0x11223344);
  });

  it("sound fires if CHG_X flag was already set before call (even without new change)", () => {
    const s = emptyGameState();
    // Struct unchanged → no new change from this call.
    setStruct(s, 0x00000010, 0x00000020);
    setBitmap(s, 0);
    setD2Word(s, 0);
    // Pre-set CHG_X flag.
    s.workRam[CHG_X_OFF] = 1;

    let soundFired = false;
    stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR, {
      fun_158ac: () => { soundFired = true; },
    });
    expect(soundFired).toBe(true);
  });

  it("gate deactivated (value < 4): block1 path A does NOT fire", () => {
    const s = emptyGameState();
    setStruct(s, 0xffff8000, 0x00000001);
    setBitmap(s, 0);
    setD2Word(s, 2); // wd2 < 4 ✓ but gate is off
    ww(s, GATE_PX_OFF, 3); // gPX = 3 < 4 → block1 path A does NOT fire
    s.workRam[FLAG_PX_OFF] = 1;

    const r = stateSub1B5C2(s, STRUCT_ADDR, BITMAP_ADDR, D2W_ADDR);
    // Neither path fires (pathB also inactive: flagNX=0).
    expect(r.xChanged).toBe(false);
    expect(r.d3Out).toBe(0xffff8000);
  });
});
