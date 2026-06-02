/**
 * state-dispatch-15460.test.ts — smoke for FUN_15460.
 *
 * `cli/src/test-state-dispatch-15460-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  stateDispatch15460,
  KIND_BYTE_OFF,
  CURR_ANIM_OFF,
  PREV_ANIM_OFF,
  FLAG_24_OFF,
  FLAG_25_OFF,
  FLAG_26_OFF,
  FLAG_27_OFF,
  VEL_X_OFF,
  VEL_Y_OFF,
  POS_X_OFF,
  POS_Y_OFF,
  TARGET_PTR_OFF,
  FIELD_1C_OFF,
  FIELD_20_OFF,
  ANIM_IDLE,
  ANIM_RIGHT,
  ANIM_LEFT,
  ANIM_UP,
  ANIM_DOWN,
  ANIM_CASE1,
  ANIM_CASE2_FINAL,
  ANIM_CASE5,
  ANIM_CASE6,
  ANIM_CASE4_X_POS,
  ANIM_CASE4_X_NEG,
  ANIM_CASE4_Y_POS,
  ANIM_CASE4_Y_NEG,
} from "../src/state-dispatch-15460.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x00400000;

function writeLong(s: ReturnType<typeof emptyGameState>, abs: number, v: number): void {
  const off = abs - WORK_RAM_BASE;
  const u = v >>> 0;
  s.workRam[off] = (u >>> 24) & 0xff;
  s.workRam[off + 1] = (u >>> 16) & 0xff;
  s.workRam[off + 2] = (u >>> 8) & 0xff;
  s.workRam[off + 3] = u & 0xff;
}

function readLong(s: ReturnType<typeof emptyGameState>, abs: number): number {
  const off = abs - WORK_RAM_BASE;
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

describe("stateDispatch15460 (FUN_15460)", () => {
  it("kind == 0 → caseTrackMarble: vel_x == 0 + cell aligned + Y diff → write d2 vel + ANIM_DOWN; epilog 0x25=2", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 0;
    // vel_x = 0 (X-priority path)
    writeLong(s, structPtr + VEL_X_OFF, 0);
    writeLong(s, structPtr + VEL_Y_OFF, 0);
    // pos_x = 0 → cellX = 0; pos_y = 0 → cellY = 0
    writeLong(s, structPtr + POS_X_OFF, 0);
    writeLong(s, structPtr + POS_Y_OFF, 0);
    // target ptr in workRam
    const targetAddr = 0x00401000;
    writeLong(s, structPtr + TARGET_PTR_OFF, targetAddr);
    // target.x = 0, target.y = +5 → cellY (0) < target.y (5) → d2 = +8 (DOWN)
    s.workRam[targetAddr - WORK_RAM_BASE] = 0;
    s.workRam[targetAddr - WORK_RAM_BASE + 1] = 5;

    stateDispatch15460(s, structPtr);

    // anim = ANIM_DOWN
    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_DOWN);
    // prev = current (epilog)
    expect(readLong(s, structPtr + PREV_ANIM_OFF)).toBe(ANIM_DOWN);
    // vel_x = 0 << 16 = 0, vel_y = 8 << 16 = 0x80000
    expect(readLong(s, structPtr + VEL_X_OFF)).toBe(0);
    expect(readLong(s, structPtr + VEL_Y_OFF)).toBe(0x80000);
    // (0x26) = 1 (case set), (0x24) = 0, (0x25) = 2 (kind 0)
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0x01);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_24_OFF]).toBe(0x00);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_25_OFF]).toBe(0x02);
  });

  it("kind == 0 → caseTrackMarble: cell == target both axes → ANIM_IDLE, vel = 0", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 0;
    writeLong(s, structPtr + VEL_X_OFF, 0);
    writeLong(s, structPtr + POS_X_OFF, 0);
    writeLong(s, structPtr + POS_Y_OFF, 0);
    const targetAddr = 0x00401000;
    writeLong(s, structPtr + TARGET_PTR_OFF, targetAddr);
    s.workRam[targetAddr - WORK_RAM_BASE] = 0;
    s.workRam[targetAddr - WORK_RAM_BASE + 1] = 0;

    stateDispatch15460(s, structPtr);

    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_IDLE);
    expect(readLong(s, structPtr + VEL_X_OFF)).toBe(0);
    expect(readLong(s, structPtr + VEL_Y_OFF)).toBe(0);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0x01);
  });

  it("kind == 1 → caseAnim20CD8: anim 0x20CD8, clear (0x27), (0x26)=1, (0x25)=1", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 1;
    s.workRam[structPtr - WORK_RAM_BASE + FLAG_27_OFF] = 0xab; // pre-load to verify clear

    stateDispatch15460(s, structPtr);

    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_CASE1);
    expect(readLong(s, structPtr + PREV_ANIM_OFF)).toBe(ANIM_CASE1);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_27_OFF]).toBe(0x00);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0x01);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_24_OFF]).toBe(0x00);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_25_OFF]).toBe(0x01);
  });

  it("kind == 2 → caseAnim20D64: curr == prev → write 0x20D64 + (0x26)=1", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 2;
    // curr == prev != 0x20D64 → final write 0x20D64 + flag (0x26)=1
    writeLong(s, structPtr + CURR_ANIM_OFF, 0x12345678);
    writeLong(s, structPtr + PREV_ANIM_OFF, 0x12345678);

    stateDispatch15460(s, structPtr);

    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_CASE2_FINAL);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0x01);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_25_OFF]).toBe(0x01);
  });

  it("kind == 2 → caseAnim20D64: curr == 0x20D64 → no-op in the case (epilog only); 0x26 intact", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 2;
    writeLong(s, structPtr + CURR_ANIM_OFF, ANIM_CASE2_FINAL);
    s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF] = 0x77;
    writeLong(s, structPtr + PREV_ANIM_OFF, 0xabcdef00);

    stateDispatch15460(s, structPtr);

    // Anim unchanged.
    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_CASE2_FINAL);
    // Prev = curr (epilog)
    expect(readLong(s, structPtr + PREV_ANIM_OFF)).toBe(ANIM_CASE2_FINAL);
    // (0x26) not touched by the case -> 0x77.
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0x77);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_25_OFF]).toBe(0x01);
  });

  it("kind == 2 → caseAnim20D64: delta path (4 > delta) → (0x26)=-1 (=0xFF byte)", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 2;
    // curr != 0x20D64, curr != prev, ((prev - curr) >> 2) low word < 4 → -1
    writeLong(s, structPtr + CURR_ANIM_OFF, 0x00021000);
    writeLong(s, structPtr + PREV_ANIM_OFF, 0x00021004); // delta = 4 >> 2 = 1; 4 > 1 → -1
    s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF] = 0x00;

    stateDispatch15460(s, structPtr);

    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0xff);
    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(0x00021000);
  });

  it("kind == 3 → alias of kind 0 (track marble) but 0x25 = 1 (kind != 0/4)", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 3;
    writeLong(s, structPtr + VEL_X_OFF, 0);
    writeLong(s, structPtr + POS_X_OFF, 0);
    writeLong(s, structPtr + POS_Y_OFF, 0);
    const targetAddr = 0x00401000;
    writeLong(s, structPtr + TARGET_PTR_OFF, targetAddr);
    s.workRam[targetAddr - WORK_RAM_BASE] = 5; // target.x = 5 > cellX (0) → d3 = +8 (RIGHT)
    s.workRam[targetAddr - WORK_RAM_BASE + 1] = 0;

    stateDispatch15460(s, structPtr);

    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_RIGHT);
    expect(readLong(s, structPtr + VEL_X_OFF)).toBe(0x80000); // 8 << 16
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_25_OFF]).toBe(0x01);
  });

  it("kind == 4 → caseVelocityMagnitude: |D1| > |D0|, D1 > 0 → ANIM_CASE4_X_POS; 0x25=2", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 4;
    writeLong(s, structPtr + FIELD_1C_OFF, 0x00000064); // D1 = 100
    writeLong(s, structPtr + FIELD_20_OFF, 0xffffffce); // D0 = -50 (|D0|=50)

    stateDispatch15460(s, structPtr);

    // |100| > |50| → X axis; D1 > 0 → X_POS
    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_CASE4_X_POS);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0x01);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_25_OFF]).toBe(0x02);
  });

  it("kind == 4 → caseVelocityMagnitude: |D1| < |D0|, D0 < 0 → ANIM_CASE4_Y_NEG", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 4;
    writeLong(s, structPtr + FIELD_1C_OFF, 0x00000005); // D1 = 5
    writeLong(s, structPtr + FIELD_20_OFF, 0xfffffe70); // D0 = -400 (|400|)

    stateDispatch15460(s, structPtr);

    // |5| <= |400| → Y axis; D0 < 0 → Y_NEG
    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_CASE4_Y_NEG);
  });

  it("kind == 5 → caseAnim20E28: anim 0x20E28, (0x26) NOT touched; (0x25)=1", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 5;
    s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF] = 0x42; // sentinel
    s.workRam[structPtr - WORK_RAM_BASE + FLAG_27_OFF] = 0x99; // sentinel

    stateDispatch15460(s, structPtr);

    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_CASE5);
    // (0x26) not written by case 5 -> unchanged.
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0x42);
    // (0x27) not written -> unchanged.
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_27_OFF]).toBe(0x99);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_25_OFF]).toBe(0x01);
  });

  it("kind == 6 → caseAnim20D6C: anim 0x20D6C, (0x26) NOT touched", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 6;
    s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF] = 0xaa;

    stateDispatch15460(s, structPtr);

    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_CASE6);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0xaa);
  });

  it("kind == 7 (out-of-range > 6) → epilog only: anim unchanged; 0x25=1; prev <- curr", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 7;
    writeLong(s, structPtr + CURR_ANIM_OFF, 0xdeadbeef);
    writeLong(s, structPtr + PREV_ANIM_OFF, 0xcafebabe);
    s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF] = 0x77;

    stateDispatch15460(s, structPtr);

    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(0xdeadbeef);
    expect(readLong(s, structPtr + PREV_ANIM_OFF)).toBe(0xdeadbeef);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0x77);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_24_OFF]).toBe(0x00);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_25_OFF]).toBe(0x01);
  });

  it("kind == 0xFF (signed -1, blt branch) → epilog only", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 0xff;
    writeLong(s, structPtr + CURR_ANIM_OFF, 0x11223344);
    s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF] = 0x55;

    stateDispatch15460(s, structPtr);

    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(0x11223344);
    expect(readLong(s, structPtr + PREV_ANIM_OFF)).toBe(0x11223344);
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_26_OFF]).toBe(0x55);
    // 0x25 = 1 (kind 0xFF != 0 and != 4)
    expect(s.workRam[structPtr - WORK_RAM_BASE + FLAG_25_OFF]).toBe(0x01);
  });

  it("epilog: prev_anim ← curr_anim (0x58 ← 0x5C) always, even with kind 5/6", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;

    s.workRam[structPtr - WORK_RAM_BASE + KIND_BYTE_OFF] = 5;
    writeLong(s, structPtr + CURR_ANIM_OFF, 0x11111111);
    writeLong(s, structPtr + PREV_ANIM_OFF, 0x99999999);

    stateDispatch15460(s, structPtr);

    expect(readLong(s, structPtr + CURR_ANIM_OFF)).toBe(ANIM_CASE5);
    expect(readLong(s, structPtr + PREV_ANIM_OFF)).toBe(ANIM_CASE5);
  });

  it("namespace exports compile: all constants accessible", () => {
    expect(KIND_BYTE_OFF).toBe(0x1a);
    expect(POS_X_OFF).toBe(0x0c);
    expect(ANIM_IDLE).toBe(0x00020c18);
    expect(ANIM_LEFT).toBe(0x00020cb4);
    expect(ANIM_UP).toBe(0x00020c90);
    expect(ANIM_CASE4_X_NEG).toBe(0x00020e14);
    expect(ANIM_CASE4_Y_POS).toBe(0x00020dec);
  });
});
