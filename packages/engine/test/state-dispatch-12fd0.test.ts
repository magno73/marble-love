/**
 * state-dispatch-12fd0.test.ts — smoke per FUN_12FD0.
 *
 * `cli/src/test-state-dispatch-12fd0-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  stateDispatch12FD0,
  OBJ_ARRAY_BASE,
  OBJ_STRIDE,
  OBJ_ACTIVE_OFF,
  OBJ_STATE_OFF,
  OBJ_STATE_DISPATCH_A,
  OBJ_STATE_DISPATCH_B,
  ROM_SCRIPT_PTR,
  SLOT_ARRAY_BASE,
  SLOT_STRIDE,
  SLOT_COUNT,
  GAME_MODE_INNER,
  STATE_DISPATCH_12FD0_ADDR,
} from "../src/state-dispatch-12fd0.js";
import type { StateDispatch12FD0Subs } from "../src/state-dispatch-12fd0.js";
import { emptyGameState } from "../src/state.js";

const WRAM = 0x00400000;

function wb(state: ReturnType<typeof emptyGameState>, addr: number, val: number): void {
  state.workRam[addr - WRAM] = val & 0xff;
}
function ww(state: ReturnType<typeof emptyGameState>, addr: number, val: number): void {
  state.workRam[addr - WRAM] = (val >>> 8) & 0xff;
  state.workRam[addr - WRAM + 1] = val & 0xff;
}

function setGameMode(state: ReturnType<typeof emptyGameState>, mode: number): void {
  ww(state, 0x400394, mode);
}
function setObjCount(state: ReturnType<typeof emptyGameState>, count: number): void {
  ww(state, 0x400396, count);
}
function setFlag75e(state: ReturnType<typeof emptyGameState>, val: number): void {
  wb(state, 0x40075e, val);
}
function setFlag75c(state: ReturnType<typeof emptyGameState>, val: number): void {
  wb(state, 0x40075c, val);
}
function setObj(state: ReturnType<typeof emptyGameState>, idx: number, active: number, stateVal: number): void {
  const base = OBJ_ARRAY_BASE + idx * OBJ_STRIDE;
  wb(state, base + OBJ_ACTIVE_OFF, active);
  wb(state, base + OBJ_STATE_OFF, stateVal);
}

describe("stateDispatch12FD0 (FUN_12FD0)", () => {
  it("exports STATE_DISPATCH_12FD0_ADDR = 0x12FD0", () => {
    expect(STATE_DISPATCH_12FD0_ADDR).toBe(0x00012fd0);
  });

  it("gameMode != 2 → blocco 1 skipped, fun_12d46 non chiamata", () => {
    const s = emptyGameState();
    setGameMode(s, 0); // not 2
    setObjCount(s, 3);
    setFlag75e(s, 1);
    setObj(s, 0, 1, OBJ_STATE_DISPATCH_A); // would dispatch if mode==2
    setFlag75c(s, 0);

    let calls12d46 = 0;
    let calls13068 = 0;
    stateDispatch12FD0(s, {
      fun_12d46: () => { calls12d46++; },
      fun_13068: () => { calls13068++; },
    });
    expect(calls12d46).toBe(0);
    expect(calls13068).toBe(SLOT_COUNT);
  });

  it("gameMode == 2, active obj with state 0x09 → fun_12d46(ROM_SCRIPT_PTR) chiamata", () => {
    const s = emptyGameState();
    setGameMode(s, GAME_MODE_INNER);
    setObjCount(s, 3);
    setFlag75e(s, 1);
    setObj(s, 0, 1, OBJ_STATE_DISPATCH_A); // state 9, active

    let capturedPtr: number | null = null;
    stateDispatch12FD0(s, {
      fun_12d46: (ptr) => { capturedPtr = ptr; },
    });
    expect(capturedPtr).toBe(ROM_SCRIPT_PTR);
    expect(ROM_SCRIPT_PTR).toBe(0x0001d854);
  });

  it("gameMode == 2, active obj with state 0x0a → fun_12d46 chiamata", () => {
    const s = emptyGameState();
    setGameMode(s, GAME_MODE_INNER);
    setObjCount(s, 5);
    setFlag75e(s, 1);
    setObj(s, 2, 1, OBJ_STATE_DISPATCH_B); // 3rd object (idx 2), state 0xa

    let calls = 0;
    stateDispatch12FD0(s, {
      fun_12d46: () => { calls++; },
    });
    expect(calls).toBe(1);
  });

  it("gameMode == 2, fun_12d46 chiamata SOLO una volta (break dopo primo match)", () => {
    const s = emptyGameState();
    setGameMode(s, GAME_MODE_INNER);
    setObjCount(s, 5);
    setFlag75e(s, 1);
    // Two active objects that would dispatch
    setObj(s, 0, 1, OBJ_STATE_DISPATCH_A);
    setObj(s, 1, 1, OBJ_STATE_DISPATCH_B);

    let calls = 0;
    stateDispatch12FD0(s, {
      fun_12d46: () => { calls++; },
    });
    expect(calls).toBe(1); // only first match
  });

  it("gameMode == 2, flag75e == 0 → fun_12d46 non chiamata anche se obj è attivo", () => {
    const s = emptyGameState();
    setGameMode(s, GAME_MODE_INNER);
    setObjCount(s, 3);
    setFlag75e(s, 0); // flag off
    setObj(s, 0, 1, OBJ_STATE_DISPATCH_A);

    let calls = 0;
    stateDispatch12FD0(s, {
      fun_12d46: () => { calls++; },
    });
    expect(calls).toBe(0);
  });

  it("gameMode == 2, obj+0x18 == 0 (inactive) → non dispatchato", () => {
    const s = emptyGameState();
    setGameMode(s, GAME_MODE_INNER);
    setObjCount(s, 3);
    setFlag75e(s, 1);
    setObj(s, 0, 0, OBJ_STATE_DISPATCH_A); // inactive

    let calls = 0;
    stateDispatch12FD0(s, {
      fun_12d46: () => { calls++; },
    });
    expect(calls).toBe(0);
  });

  it("gameMode == 2, obj state != 9 e != 10 → non dispatchato", () => {
    const s = emptyGameState();
    setGameMode(s, GAME_MODE_INNER);
    setObjCount(s, 3);
    setFlag75e(s, 1);
    setObj(s, 0, 1, 0x05); // active, but state != 9/10

    let calls = 0;
    stateDispatch12FD0(s, {
      fun_12d46: () => { calls++; },
    });
    expect(calls).toBe(0);
  });

  it("objCount == 0 → inner loop not entered", () => {
    const s = emptyGameState();
    setGameMode(s, GAME_MODE_INNER);
    setObjCount(s, 0); // loop limit = 0, counter starts at 0 → bne not taken
    setFlag75e(s, 1);
    setObj(s, 0, 1, OBJ_STATE_DISPATCH_A);

    let calls = 0;
    stateDispatch12FD0(s, {
      fun_12d46: () => { calls++; },
    });
    expect(calls).toBe(0);
  });

  it("flag75c != 0 → fun_11ac2 chiamata", () => {
    const s = emptyGameState();
    setFlag75c(s, 1);

    let calls = 0;
    stateDispatch12FD0(s, {
      fun_11ac2: () => { calls++; },
    });
    expect(calls).toBe(1);
  });

  it("flag75c == 0 → fun_11ac2 non chiamata", () => {
    const s = emptyGameState();
    setFlag75c(s, 0);

    let calls = 0;
    stateDispatch12FD0(s, {
      fun_11ac2: () => { calls++; },
    });
    expect(calls).toBe(0);
  });

  it("fun_13068 chiamata 25 volte con ptr corretti", () => {
    const s = emptyGameState();
    const ptrs: number[] = [];
    stateDispatch12FD0(s, {
      fun_13068: (ptr) => { ptrs.push(ptr); },
    });

    expect(ptrs).toHaveLength(SLOT_COUNT);
    for (let i = 0; i < SLOT_COUNT; i++) {
      expect(ptrs[i]).toBe((SLOT_ARRAY_BASE + i * SLOT_STRIDE) >>> 0);
    }
  });

  it("fun_13068 ptr[0] == 0x400a9c, stride 0x56, 25 elementi", () => {
    const s = emptyGameState();
    const ptrs: number[] = [];
    stateDispatch12FD0(s, {
      fun_13068: (ptr) => { ptrs.push(ptr); },
    });

    expect(ptrs[0]).toBe(0x400a9c);
    expect(ptrs[1]).toBe(0x400af2);
    expect(ptrs[24]).toBe(0x400a9c + 24 * 0x56);
    expect(ptrs).toHaveLength(25);
  });

  it("blocco 3 sempre eseguito indipendentemente dai blocchi precedenti", () => {
    const s = emptyGameState();
    setGameMode(s, 0); // gameMode != 2, blocco 1 skipped
    setFlag75c(s, 0); // flag off, blocco 2 skipped

    let calls13068 = 0;
    stateDispatch12FD0(s, {
      fun_13068: () => { calls13068++; },
    });
    expect(calls13068).toBe(SLOT_COUNT);
  });

  it("subs undefined → non-throw", () => {
    const s = emptyGameState();
    setGameMode(s, GAME_MODE_INNER);
    setObjCount(s, 2);
    setFlag75e(s, 1);
    setObj(s, 0, 1, OBJ_STATE_DISPATCH_A);
    setFlag75c(s, 1);
    expect(() => stateDispatch12FD0(s)).not.toThrow();
  });

  it("blocco 1 + blocco 2 + blocco 3: tutti chiamati con valori corretti", () => {
    const s = emptyGameState();
    setGameMode(s, GAME_MODE_INNER);
    setObjCount(s, 3);
    setFlag75e(s, 0xff); // non-zero
    setObj(s, 1, 1, OBJ_STATE_DISPATCH_B); // 2nd object triggers
    setFlag75c(s, 0xff);

    const log: string[] = [];
    stateDispatch12FD0(s, {
      fun_12d46: (ptr) => { log.push(`12d46:${ptr.toString(16)}`); },
      fun_11ac2: () => { log.push("11ac2"); },
      fun_13068: (ptr) => { log.push(`13068:${ptr.toString(16)}`); },
    });

    expect(log[0]).toBe(`12d46:${ROM_SCRIPT_PTR.toString(16)}`);
    expect(log[1]).toBe("11ac2");
    expect(log.filter(l => l.startsWith("13068:"))).toHaveLength(SLOT_COUNT);
    // Total: 1 dispatch + 1 sound + 25 slot calls = 27
    expect(log).toHaveLength(27);
  });

  it("OBJ_STRIDE, SLOT_STRIDE, SLOT_COUNT exported correctly", () => {
    expect(OBJ_STRIDE).toBe(0xe2);
    expect(SLOT_STRIDE).toBe(0x56);
    expect(SLOT_COUNT).toBe(25);
  });
});
