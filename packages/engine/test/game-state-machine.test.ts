/**
 * Test gameStateMachineTick (FUN_2E18) — root state-machine dispatcher.
 *
 * Bit-perfect verified against the binary (9000/9000 random cases in 3 suites)
 * via `cli/src/test-game-state-machine-parity.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import {
  gameStateMachineTick,
  STATE_BASE_OFF,
  THRESHOLD_BASE_OFF,
  COUNTER_BASE_OFF,
  FRAME_COUNTER_OFF,
  MODE_OFF,
  DATA_PTR_BASE_OFF,
  WORD16_BASE_OFF,
  FLAG30_BASE_OFF,
  FLAG34_BASE_OFF,
  SPECIAL_INNER_OFF,
  SPECIAL_TARGET_OFF,
  SPECIAL_TICK_OFF,
} from "../src/game-state-machine.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

describe("gameStateMachineTick (FUN_2E18) — Branch B (mode=0)", () => {
  it("frame counter sempre incrementato", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[FRAME_COUNTER_OFF] = 0;
    s.workRam[FRAME_COUNTER_OFF + 1] = 0;
    gameStateMachineTick(s, rom);
    const fc = (s.workRam[FRAME_COUNTER_OFF] << 8) | (s.workRam[FRAME_COUNTER_OFF + 1] ?? 0);
    expect(fc).toBe(1);
  });

  it("tutti state=0: nessun dispatch, no callback", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const fun_2678 = vi.fn();
    gameStateMachineTick(s, rom, { fun_2678 });
    expect(fun_2678).not.toHaveBeenCalled();
  });

  it("state=1, counter raggiunge threshold → FUN_2678(data[0])", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[STATE_BASE_OFF] = 1;
    // threshold = 5
    s.workRam[THRESHOLD_BASE_OFF] = 0; s.workRam[THRESHOLD_BASE_OFF + 1] = 5;
    // counter = 4 (next tick → 5 = threshold)
    s.workRam[COUNTER_BASE_OFF] = 0; s.workRam[COUNTER_BASE_OFF + 1] = 4;
    // data ptr = 0xDEADBEEF
    s.workRam[DATA_PTR_BASE_OFF + 0] = 0xDE;
    s.workRam[DATA_PTR_BASE_OFF + 1] = 0xAD;
    s.workRam[DATA_PTR_BASE_OFF + 2] = 0xBE;
    s.workRam[DATA_PTR_BASE_OFF + 3] = 0xEF;

    const fun_2678 = vi.fn();
    gameStateMachineTick(s, rom, { fun_2678 });

    expect(fun_2678).toHaveBeenCalledWith(0xDEADBEEF);
    // Counter resettato a 0
    expect(s.workRam[COUNTER_BASE_OFF + 1]).toBe(0);
  });

  it("state=2 toggle: prima call → FUN_2572 + flag30=1; seconda call → FUN_2ABC + flag30=0", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[STATE_BASE_OFF] = 2;
    s.workRam[THRESHOLD_BASE_OFF + 1] = 1; // threshold=1
    s.workRam[COUNTER_BASE_OFF + 1] = 0;    // counter=0 → +1 = 1 = threshold
    s.workRam[FLAG30_BASE_OFF] = 0;          // flag30 = 0 (else branch)

    const fun_2572 = vi.fn();
    const fun_2abc = vi.fn();
    gameStateMachineTick(s, rom, { fun_2572, fun_2abc });

    expect(fun_2572).toHaveBeenCalledOnce();
    expect(fun_2abc).not.toHaveBeenCalled();
    expect(s.workRam[FLAG30_BASE_OFF]).toBe(1);

    // Reset counter for second tick
    s.workRam[COUNTER_BASE_OFF + 1] = 0;
    fun_2572.mockClear();
    fun_2abc.mockClear();
    gameStateMachineTick(s, rom, { fun_2572, fun_2abc });
    expect(fun_2572).not.toHaveBeenCalled();
    expect(fun_2abc).toHaveBeenCalledOnce();
    expect(s.workRam[FLAG30_BASE_OFF]).toBe(0);
  });

  it("state=3: result=0 → state→0 + FUN_2BDA se *(data+8) != 0", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[STATE_BASE_OFF] = 3;
    s.workRam[THRESHOLD_BASE_OFF + 1] = 1;
    s.workRam[COUNTER_BASE_OFF + 1] = 0;
    // data ptr → 0x401D00 (workRam scratch); next ptr at +8 = 0x12345678 (non-zero)
    s.workRam[DATA_PTR_BASE_OFF + 0] = 0; s.workRam[DATA_PTR_BASE_OFF + 1] = 0x40;
    s.workRam[DATA_PTR_BASE_OFF + 2] = 0x1D; s.workRam[DATA_PTR_BASE_OFF + 3] = 0x00;
    s.workRam[0x1D08] = 0x12; s.workRam[0x1D09] = 0x34;
    s.workRam[0x1D0A] = 0x56; s.workRam[0x1D0B] = 0x78;

    const fun_2cd4 = vi.fn().mockReturnValue(0);
    const fun_2bda = vi.fn();
    gameStateMachineTick(s, rom, { fun_2cd4, fun_2bda });

    expect(fun_2cd4).toHaveBeenCalledOnce();
    expect(s.workRam[STATE_BASE_OFF]).toBe(0); // state→0
    expect(fun_2bda).toHaveBeenCalledWith(0x12345678, expect.any(Number), expect.any(Number));
    // FLAG34 incrementato
    expect(s.workRam[FLAG34_BASE_OFF]).toBe(1);
  });

  it("state=3: result=2 → state→2 (no transition)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[STATE_BASE_OFF] = 3;
    s.workRam[THRESHOLD_BASE_OFF + 1] = 1;
    s.workRam[COUNTER_BASE_OFF + 1] = 0;

    const fun_2cd4 = vi.fn().mockReturnValue(2);
    const fun_2bda = vi.fn();
    gameStateMachineTick(s, rom, { fun_2cd4, fun_2bda });

    expect(s.workRam[STATE_BASE_OFF]).toBe(2);
    expect(fun_2bda).not.toHaveBeenCalled();
  });

  it("state=5 → FUN_2766(data[0])", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[STATE_BASE_OFF] = 5;
    s.workRam[THRESHOLD_BASE_OFF + 1] = 1;
    const fun_2766 = vi.fn();
    gameStateMachineTick(s, rom, { fun_2766 });
    expect(fun_2766).toHaveBeenCalledOnce();
  });

  it("state=6 → FUN_2818(data[0])", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[STATE_BASE_OFF] = 6;
    s.workRam[THRESHOLD_BASE_OFF + 1] = 1;
    const fun_2818 = vi.fn();
    gameStateMachineTick(s, rom, { fun_2818 });
    expect(fun_2818).toHaveBeenCalledOnce();
  });

  it("counter < threshold: skip dispatch", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[STATE_BASE_OFF] = 1;
    s.workRam[THRESHOLD_BASE_OFF + 1] = 10;
    s.workRam[COUNTER_BASE_OFF + 1] = 3; // → 4, not 10

    const fun_2678 = vi.fn();
    gameStateMachineTick(s, rom, { fun_2678 });
    expect(fun_2678).not.toHaveBeenCalled();
    // Counter incrementato ma non resettato
    expect(s.workRam[COUNTER_BASE_OFF + 1]).toBe(4);
  });
});

describe("gameStateMachineTick (FUN_2E18) — Branch A (mode!=0)", () => {
  it("inner != target: early exit", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[MODE_OFF + 1] = 1;
    s.workRam[SPECIAL_INNER_OFF + 1] = 5;
    s.workRam[SPECIAL_TARGET_OFF + 1] = 10;

    const fun_295a = vi.fn();
    gameStateMachineTick(s, rom, { fun_295a });
    // Inner incrementato
    expect(s.workRam[SPECIAL_INNER_OFF + 1]).toBe(6);
    // FUN_295A not called.
    expect(fun_295a).not.toHaveBeenCalled();
  });

  it("inner == target: chiama FUN_295A, reset inner, tick++", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[MODE_OFF + 1] = 1;
    s.workRam[SPECIAL_INNER_OFF + 1] = 7;
    s.workRam[SPECIAL_TARGET_OFF + 1] = 7;
    s.workRam[SPECIAL_TICK_OFF + 1] = 0;

    const fun_295a = vi.fn();
    gameStateMachineTick(s, rom, { fun_295a });
    expect(fun_295a).toHaveBeenCalledOnce();
    expect(s.workRam[SPECIAL_INNER_OFF + 1]).toBe(0);
    expect(s.workRam[SPECIAL_TICK_OFF + 1]).toBe(1);
  });
});
