import { describe, expect, it } from "vitest";
import { emptyRomImage } from "../src/bus.js";
import { postStateChange13966 } from "../src/post-state-change-13966.js";
import { refreshFrame10FCE } from "../src/refresh-frame-10fce.js";
import { emptyGameState, type GameState } from "../src/state.js";

const WORK_RAM_BASE = 0x00400000;
const OBJ_BASE = 0x00400018;
const SLOT_TABLE = 0x00401650;

function ww(state: GameState, abs: number, value: number): void {
  const off = abs - WORK_RAM_BASE;
  state.workRam[off] = (value >>> 8) & 0xff;
  state.workRam[off + 1] = value & 0xff;
}

function rw(state: GameState, abs: number): number {
  const off = abs - WORK_RAM_BASE;
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function rb(state: GameState, abs: number): number {
  return (state.workRam[abs - WORK_RAM_BASE] ?? 0) & 0xff;
}

function makeMode3ArmedState(): GameState {
  const state = emptyGameState();
  ww(state, 0x00400394, 3);
  ww(state, 0x00400396, 1);
  state.workRam[OBJ_BASE - WORK_RAM_BASE + 0x18] = 1;
  state.workRam[OBJ_BASE - WORK_RAM_BASE + 0x1b] = 4;
  return state;
}

describe("postStateChange13966 (FUN_00013966)", () => {
  it("mode 3 arms the secondary slot table through FUN_186AC", () => {
    const state = makeMode3ArmedState();
    const rom = emptyRomImage();

    const result = postStateChange13966(state, rom, OBJ_BASE);

    expect(result.gameMode).toBe(3);
    expect(result.stateSub186ACCalled).toBe(true);
    expect(rb(state, 0x00400760)).toBe(1);
    expect(rb(state, SLOT_TABLE)).toBe(0);
    expect(rb(state, SLOT_TABLE + 0x10)).toBe(1);
  });

  it("refresh default 1844A wiring inserts armed entries into the draw list", () => {
    const state = makeMode3ArmedState();
    const rom = emptyRomImage();
    state.workRam[0x3bc] = 0xff;

    postStateChange13966(state, rom, OBJ_BASE);
    expect(rw(state, SLOT_TABLE + 2)).toBe(0);

    refreshFrame10FCE(state, rom, {
      fun13EE6: () => undefined,
      objectScanDispatch251DE: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => undefined,
      dispatchStrings17230: () => undefined,
      fun1912C: () => undefined,
      stateSub19BAA: () => undefined,
      stateDispatch12FD0: () => undefined,
      objDirtyDispatch28624: () => undefined,
    });

    expect(rw(state, SLOT_TABLE + 2)).toBe(0xffff);
    expect(rb(state, 0x004001dc)).toBe(0x29);
    expect(rb(state, 0x004001dd)).toBe(0);
    expect(rb(state, 0x004003bc)).toBe(0);
  });
});
