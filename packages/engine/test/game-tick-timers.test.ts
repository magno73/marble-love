/**
 * Test gameTickTimers (FUN_28A96) — root game-logic timer dispatcher.
 *
 * `cli/src/test-game-tick-timers-parity.ts`.
 *
 */

import { describe, it, expect, vi } from "vitest";
import {
  gameTickTimers,
  OBJECTS_BASE_OFF,
  OBJECT_STRIDE,
  OBJECT_COUNT_OFF,
  GAME_STATE_WORD_OFF,
  GLOBAL_TIMER_OFF,
} from "../src/game-tick-timers.js";
import { emptyGameState } from "../src/state.js";

function setCount(s: ReturnType<typeof emptyGameState>, count: number): void {
  s.workRam[OBJECT_COUNT_OFF] = (count >>> 8) & 0xff;
  s.workRam[OBJECT_COUNT_OFF + 1] = count & 0xff;
}

function setupTimer(
  s: ReturnType<typeof emptyGameState>,
  baseOff: number,
  outer: number, medium: number, inner: number,
): void {
  s.workRam[baseOff] = (outer >>> 8) & 0xff;
  s.workRam[baseOff + 1] = outer & 0xff;
  s.workRam[baseOff + 2] = medium;
  s.workRam[baseOff + 4] = inner;
}

describe("gameTickTimers (FUN_28A96)", () => {
  it("count=0: no iterazione, but global timer ticka", () => {
    const s = emptyGameState();
    setCount(s, 0);
    // Disable global timer (inner = 0xFF) → no-op
    s.workRam[GLOBAL_TIMER_OFF + 4] = 0xFF;
    gameTickTimers(s);
    expect(s.workRam[GLOBAL_TIMER_OFF + 4]).toBe(0xFF); // unchanged
  });

  it("obj type=8 is saltato (no tick) but calls HUD", () => {
    const s = emptyGameState();
    setCount(s, 1);
    s.workRam[OBJECTS_BASE_OFF + 0x1A] = 8; // type=8
    s.workRam[OBJECTS_BASE_OFF + 0x6E] = 5; // inner=5 (would tick)
    s.workRam[GLOBAL_TIMER_OFF + 4] = 0xFF;

    const hud = vi.fn();
    gameTickTimers(s, hud);

    expect(s.workRam[OBJECTS_BASE_OFF + 0x6E]).toBe(5);
    expect(hud).toHaveBeenCalledOnce();
  });

  it("timer cascade bit 0 (full wrap) → reset + palette FX", () => {
    const s = emptyGameState();
    setCount(s, 1);
    // Setup timer: outer=0, medium=0, inner=0 → tick decrements inner to 0xFF →
    setupTimer(s, OBJECTS_BASE_OFF + 0x6A, 0, 0, 0);
    s.workRam[OBJECTS_BASE_OFF + 0x19] = 1; // flag != 0 → palette FX A
    s.workRam[GLOBAL_TIMER_OFF + 4] = 0xFF;

    gameTickTimers(s);

    // obj +0x18 must be 2.
    expect(s.workRam[OBJECTS_BASE_OFF + 0x18]).toBe(2);
    // Timer struct reset
    expect(s.workRam[OBJECTS_BASE_OFF + 0x6A]).toBe(0);
    expect(s.workRam[OBJECTS_BASE_OFF + 0x6B]).toBe(0);
    expect(s.workRam[OBJECTS_BASE_OFF + 0x6C]).toBe(0);
    expect(s.workRam[OBJECTS_BASE_OFF + 0x6E]).toBe(0xFF);
    expect(s.workRam[OBJECTS_BASE_OFF + 0x71]).toBe(0xFF);
    // Palette FX A written @ 0xB0001E.
    expect(s.colorRam[0x1E]).toBe(0xAF);
    expect(s.colorRam[0x1F]).toBe(0x00);
    // Game state word @ 0x400390 = 4 (anyExpired triggers Block 2)
    expect(s.workRam[GAME_STATE_WORD_OFF]).toBe(0);
    expect(s.workRam[GAME_STATE_WORD_OFF + 1]).toBe(4);
  });

  it("flag obj +0x19 = 0 → palette FX B (0xB00016 = 0xF00F)", () => {
    const s = emptyGameState();
    setCount(s, 1);
    setupTimer(s, OBJECTS_BASE_OFF + 0x6A, 0, 0, 0);
    s.workRam[OBJECTS_BASE_OFF + 0x19] = 0;
    s.workRam[GLOBAL_TIMER_OFF + 4] = 0xFF;

    gameTickTimers(s);

    expect(s.colorRam[0x16]).toBe(0xF0);
    expect(s.colorRam[0x17]).toBe(0x0F);
  });

  it("inner=5: no cascade, HUD non chiamato", () => {
    const s = emptyGameState();
    setCount(s, 1);
    setupTimer(s, OBJECTS_BASE_OFF + 0x6A, 0x100, 5, 5);
    s.workRam[GLOBAL_TIMER_OFF + 4] = 0xFF;

    const hud = vi.fn();
    gameTickTimers(s, hud);

    // inner decremented to 4
    expect(s.workRam[OBJECTS_BASE_OFF + 0x6E]).toBe(4);
    expect(hud).not.toHaveBeenCalled();
  });

  it("global timer bit 0: writes 0xFF a +0x4", () => {
    const s = emptyGameState();
    setCount(s, 0);
    setupTimer(s, GLOBAL_TIMER_OFF, 0, 0, 0);
    gameTickTimers(s);
    expect(s.workRam[GLOBAL_TIMER_OFF + 4]).toBe(0xFF);
  });
});
