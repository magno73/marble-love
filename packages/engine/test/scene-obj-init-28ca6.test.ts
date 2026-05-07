import { describe, expect, it } from "vitest";
import { bus as busNs } from "../src/index.js";
import {
  sceneObjInit28CA6,
  SCENE_OBJ_FRAME_BYTE,
  SCENE_OBJ_INDEX_BASE,
  SCENE_OBJ_INIT_28CA6_ADDR,
  SCENE_OBJ_READY_FLAG,
  SCENE_OBJ_SLOT_BASE,
  SCENE_OBJ_SLOT_COUNT,
  SCENE_OBJ_SLOT_STRIDE,
  type SceneObjInit28CA6Subs,
} from "../src/scene-obj-init-28ca6.js";
import { emptyGameState } from "../src/state.js";

const WRAM = 0x00400000;

function off(abs: number): number {
  return abs - WRAM;
}

describe("sceneObjInit28CA6 (FUN_00028CA6)", () => {
  it("clears 31 slot heads and fills 31 index sentinels", () => {
    const s = emptyGameState();
    s.workRam.fill(0x55);
    const rom = busNs.emptyRomImage();

    sceneObjInit28CA6(s, rom);

    for (let i = 0; i < SCENE_OBJ_SLOT_COUNT; i++) {
      expect(s.workRam[off(SCENE_OBJ_SLOT_BASE + i * SCENE_OBJ_SLOT_STRIDE)]).toBe(0);
      expect(s.workRam[off(SCENE_OBJ_INDEX_BASE + i)]).toBe(0xff);
    }
    expect(s.workRam[off(SCENE_OBJ_SLOT_BASE + SCENE_OBJ_SLOT_COUNT * SCENE_OBJ_SLOT_STRIDE)]).toBe(0x55);
    expect(s.workRam[off(SCENE_OBJ_INDEX_BASE + SCENE_OBJ_SLOT_COUNT)]).toBe(0x55);
  });

  it("calls sub hooks in binary order with slot pointers", () => {
    const s = emptyGameState();
    const rom = busNs.emptyRomImage();
    const calls: string[] = [];
    const slots: number[] = [];
    const subs: SceneObjInit28CA6Subs = {
      fun_1b12a: (_state, slotAbs) => {
        calls.push("1b12a");
        slots.push(slotAbs);
      },
      fun_26f3e: () => calls.push("26f3e"),
      fun_28dea: () => calls.push("28dea"),
    };

    sceneObjInit28CA6(s, rom, subs);

    expect(slots).toHaveLength(SCENE_OBJ_SLOT_COUNT);
    expect(slots[0]).toBe(SCENE_OBJ_SLOT_BASE);
    expect(slots[30]).toBe(SCENE_OBJ_SLOT_BASE + 30 * SCENE_OBJ_SLOT_STRIDE);
    expect(calls.slice(0, SCENE_OBJ_SLOT_COUNT)).toEqual(Array.from({ length: SCENE_OBJ_SLOT_COUNT }, () => "1b12a"));
    expect(calls.slice(SCENE_OBJ_SLOT_COUNT)).toEqual(["26f3e", "26f3e", "28dea"]);
  });

  it("increments frame byte twice, wraps as byte, and sets ready flag", () => {
    const s = emptyGameState();
    const rom = busNs.emptyRomImage();
    s.workRam[off(SCENE_OBJ_FRAME_BYTE)] = 0xff;

    sceneObjInit28CA6(s, rom);

    expect(s.workRam[off(SCENE_OBJ_FRAME_BYTE)]).toBe(1);
    expect(s.workRam[off(SCENE_OBJ_READY_FLAG)]).toBe(1);
  });

  it("exposes the binary entry address", () => {
    expect(SCENE_OBJ_INIT_28CA6_ADDR).toBe(0x28ca6);
  });
});
