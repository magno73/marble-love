/**
 * waypoint-list-step-1815a.test.ts — smoke tests per `FUN_0001815A`.
 *
 */

import { describe, it, expect } from "vitest";
import {
  waypointListStep1815A,
  GLOBAL_LIST_PTR_ADDR,
  GLOBAL_EXHAUSTED_FLAG_ADDR,
  ENTITY_X_OFFSET,
  ENTITY_Y_OFFSET,
  ENTITY_Z_OFFSET,
  ENTITY_TARGET_X_OFFSET,
  ENTITY_TARGET_Y_OFFSET,
  ENTITY_GRAVITY_FLAG_OFFSET,
  ENTITY_LIST_END_OFFSET,
} from "../src/waypoint-list-step-1815a.js";
import { emptyGameState } from "../src/state.js";

const ENTITY_BASE = 0x401e00;
const ENTITY_OFF = ENTITY_BASE - 0x400000;
const LIST_BASE = 0x401f80;
const LIST_OFF = LIST_BASE - 0x400000;
const PTR_OFF = GLOBAL_LIST_PTR_ADDR - 0x400000;
const FLAG_OFF = GLOBAL_EXHAUSTED_FLAG_ADDR - 0x400000;

function setLongBE(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  const u = v >>> 0;
  s.workRam[off] = (u >>> 24) & 0xff;
  s.workRam[off + 1] = (u >>> 16) & 0xff;
  s.workRam[off + 2] = (u >>> 8) & 0xff;
  s.workRam[off + 3] = u & 0xff;
}

function getLongBE(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function setRecord(
  s: ReturnType<typeof emptyGameState>,
  off: number,
  sx: number,
  sy: number,
  sm: number,
  snd: number,
): void {
  s.workRam[off] = sx & 0xff;
  s.workRam[off + 1] = sy & 0xff;
  s.workRam[off + 2] = sm & 0xff;
  s.workRam[off + 3] = snd & 0xff;
}

describe("waypointListStep1815A (FUN_0001815A)", () => {
  it("list_empty: pointer punta a terminator (byte 0) → exitMode=list_empty, no side effects", () => {
    const s = emptyGameState();
    // List: terminator only.
    s.workRam[LIST_OFF] = 0;
    setLongBE(s, PTR_OFF, LIST_BASE);

    const r = waypointListStep1815A(s, ENTITY_BASE);
    expect(r.exitMode).toBe("list_empty");
    expect(r.recordsConsumed).toBe(0);
    expect(r.soundDispatches).toBe(0);
    expect(r.fun26196Called).toBe(false);
    // pointer non advanced by
    expect(getLongBE(s, PTR_OFF)).toBe(LIST_BASE);
    // exhausted flag not touched.
    expect(s.workRam[FLAG_OFF]).toBe(0);
  });

  it("in_range advance: target sufficientemente vicino al record → consume + sound + loop", () => {
    const s = emptyGameState();
    // sx=1 → delta = (1<<19) - target_x + 0x40000. Per delta=0x40000 (in range
    // as abs(0x40000)>>12 = 0x40, NOT in range). Dobbiamo |delta|<(0x20<<12)=0x20000.
    // Scegliamo target_x = (1<<19) + 0x40000 = 0xC0000 → delta = 0x80000 - 0xC0000 + 0x40000 = 0
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_X_OFFSET, 0xc0000);
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_Y_OFFSET, 0xc0000);

    // Lista: 1 record + terminator. sx=sy=1 → byte non zero (no terminator).
    setRecord(s, LIST_OFF + 0, 1, 1, 0x10, 5); // sound_idx=5 (>=0)
    s.workRam[LIST_OFF + 4] = 0; // terminator
    setLongBE(s, PTR_OFF, LIST_BASE);

    let soundCalls = 0;
    let lastSoundArgs: [number, number, number] | null = null;
    const r = waypointListStep1815A(s, ENTITY_BASE, {
      fun_012a: (a, b, c) => {
        soundCalls++;
        lastSoundArgs = [a, b, c];
      },
      lookupSoundTable: idx => 0xdeadbeef + idx,
    });

    expect(r.exitMode).toBe("list_exhausted");
    expect(r.recordsConsumed).toBe(1);
    expect(r.soundDispatches).toBe(1);
    expect(soundCalls).toBe(1);
    expect(lastSoundArgs).toEqual([0x5a, 0x3400, (0xdeadbeef + 5) >>> 0]);
    expect(r.fun26196Called).toBe(false);
    expect(r.listEndMarkerSet).toBe(true);
    expect(s.workRam[ENTITY_OFF + ENTITY_LIST_END_OFFSET]).toBe(0xff);
    // exhausted flag word = 1
    expect(((s.workRam[FLAG_OFF]! << 8) | s.workRam[FLAG_OFF + 1]!) & 0xffff).toBe(1);
    // pointer advanced by of 4
    expect(getLongBE(s, PTR_OFF)).toBe(LIST_BASE + 4);
  });

  it("in_range advance, sound_idx<0 → no sound dispatch", () => {
    const s = emptyGameState();
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_X_OFFSET, 0xc0000);
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_Y_OFFSET, 0xc0000);
    setRecord(s, LIST_OFF + 0, 1, 1, 0x10, 0xff); // sound_idx = -1 (signed)
    s.workRam[LIST_OFF + 4] = 0;
    setLongBE(s, PTR_OFF, LIST_BASE);

    let soundCalls = 0;
    const r = waypointListStep1815A(s, ENTITY_BASE, {
      fun_012a: () => {
        soundCalls++;
      },
    });
    expect(soundCalls).toBe(0);
    expect(r.soundDispatches).toBe(0);
    expect(r.recordsConsumed).toBe(1);
    expect(r.exitMode).toBe("list_exhausted");
  });

  it("out_of_range: target far → applica accelerazione and calls fun_26196", () => {
    const s = emptyGameState();
    // sx=1, target_x=0 → delta = 0x80000 - 0 + 0x40000 = 0xC0000.
    // asr 12 = 0xC0 ≥ 0x20 → out of range.
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_X_OFFSET, 0);
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_Y_OFFSET, 0);
    setLongBE(s, ENTITY_OFF + ENTITY_X_OFFSET, 0);
    setLongBE(s, ENTITY_OFF + ENTITY_Y_OFFSET, 0);
    setRecord(s, LIST_OFF + 0, 1, 1, 0x10, 0x7f);
    s.workRam[LIST_OFF + 4] = 0;
    setLongBE(s, PTR_OFF, LIST_BASE);

    let fun26196Calls = 0;
    const r = waypointListStep1815A(s, ENTITY_BASE, {
      fun_26196: () => {
        fun26196Calls++;
      },
    });
    expect(r.exitMode).toBe("out_of_range");
    expect(r.recordsConsumed).toBe(0);
    expect(r.soundDispatches).toBe(0);
    expect(fun26196Calls).toBe(1);
    expect(r.fun26196Called).toBe(true);
    // pointer NOT advanced by
    expect(getLongBE(s, PTR_OFF)).toBe(LIST_BASE);
    expect(getLongBE(s, ENTITY_OFF + ENTITY_X_OFFSET)).not.toBe(0);
  });

  it("out_of_range + gravity flag: entity[0x8] decrementato and clampato a -0x50000", () => {
    const s = emptyGameState();
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_X_OFFSET, 0);
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_Y_OFFSET, 0);
    setLongBE(s, ENTITY_OFF + ENTITY_X_OFFSET, 0);
    setLongBE(s, ENTITY_OFF + ENTITY_Y_OFFSET, 0);
    // entity.z partendo da -0x4F000 → -0x4F000 + (-0x6000) = -0x55000 < -0x50000 → clamp
    setLongBE(s, ENTITY_OFF + ENTITY_Z_OFFSET, (-0x4f000) >>> 0);
    s.workRam[ENTITY_OFF + ENTITY_GRAVITY_FLAG_OFFSET] = 1;

    setRecord(s, LIST_OFF + 0, 1, 1, 0x10, 0x7f);
    s.workRam[LIST_OFF + 4] = 0;
    setLongBE(s, PTR_OFF, LIST_BASE);

    waypointListStep1815A(s, ENTITY_BASE);
    expect(getLongBE(s, ENTITY_OFF + ENTITY_Z_OFFSET)).toBe((-0x50000) >>> 0);
  });

  it("out_of_range + gravity flag, no clamp: -0x10000 - 0x6000 = -0x16000 (no clamp)", () => {
    const s = emptyGameState();
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_X_OFFSET, 0);
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_Y_OFFSET, 0);
    setLongBE(s, ENTITY_OFF + ENTITY_X_OFFSET, 0);
    setLongBE(s, ENTITY_OFF + ENTITY_Y_OFFSET, 0);
    setLongBE(s, ENTITY_OFF + ENTITY_Z_OFFSET, (-0x10000) >>> 0);
    s.workRam[ENTITY_OFF + ENTITY_GRAVITY_FLAG_OFFSET] = 1;

    setRecord(s, LIST_OFF + 0, 1, 1, 0x10, 0x7f);
    s.workRam[LIST_OFF + 4] = 0;
    setLongBE(s, PTR_OFF, LIST_BASE);

    waypointListStep1815A(s, ENTITY_BASE);
    expect(getLongBE(s, ENTITY_OFF + ENTITY_Z_OFFSET)).toBe((-0x16000) >>> 0);
  });

  it("subs assente → no crash; out_of_range path safe", () => {
    const s = emptyGameState();
    setLongBE(s, ENTITY_OFF + ENTITY_TARGET_X_OFFSET, 0);
    setRecord(s, LIST_OFF + 0, 1, 1, 0x10, 0x7f);
    s.workRam[LIST_OFF + 4] = 0;
    setLongBE(s, PTR_OFF, LIST_BASE);
    expect(() => waypointListStep1815A(s, ENTITY_BASE)).not.toThrow();
  });
});
