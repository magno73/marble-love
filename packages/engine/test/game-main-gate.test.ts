/**
 * Test gameMainGate (FUN_28972) — root main-gate of the game loop.
 *
 * Bit-perfect verified against the binary (1000+1000 random cases) through
 * `cli/src/test-game-main-gate-parity.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import {
  gameMainGate,
  debounceInput,
  PREV_INPUT_OFF,
  DEBOUNCED_INPUT_OFF,
  FALLING_EDGES_OFF,
  GAME_STATE_WORD_OFF,
  OBJECT_COUNT_OFF,
  CONTROL_BYTE_OFF,
} from "../src/game-main-gate.js";
import type { GameStateWithHang } from "../src/game-main-gate.js";
import { emptyGameState } from "../src/state.js";

describe("debounceInput (FUN_2893C)", () => {
  it("first sample: prev=0, curr=0xFF, debounced stays 0", () => {
    const s = emptyGameState();
    s.workRam[PREV_INPUT_OFF] = 0;
    s.workRam[DEBOUNCED_INPUT_OFF] = 0;
    debounceInput(s, 0xFF);
    // (0 | (0 & 0xFF)) & (0 | 0xFF) = 0
    expect(s.workRam[DEBOUNCED_INPUT_OFF]).toBe(0);
    expect(s.workRam[PREV_INPUT_OFF]).toBe(0xFF);
  });

  it("second sample stable HIGH: bit becomes set in debounced", () => {
    const s = emptyGameState();
    s.workRam[PREV_INPUT_OFF] = 0xFF;
    s.workRam[DEBOUNCED_INPUT_OFF] = 0;
    debounceInput(s, 0xFF);
    expect(s.workRam[DEBOUNCED_INPUT_OFF]).toBe(0xFF);
  });

  it("falling edge: stable HIGH then LOW → bit goes to 0, falling-edges set", () => {
    const s = emptyGameState();
    s.workRam[PREV_INPUT_OFF] = 0xFF;
    s.workRam[DEBOUNCED_INPUT_OFF] = 0xFF;
    s.workRam[FALLING_EDGES_OFF] = 0;
    debounceInput(s, 0);
    // newDeb = (0xFF | (0xFF & 0)) & (0xFF | 0) = 0xFF & 0xFF = 0xFF
    // Hmm, that's not what I expect. Let me re-trace.
    // Actually: prev=0xFF, curr=0. newDeb = (oldDeb | (prev & curr)) & (prev | curr)
    //   = (0xFF | (0xFF & 0)) & (0xFF | 0) = 0xFF & 0xFF = 0xFF
    // So debounced stays 0xFF after one LOW sample (hysteresis).
    expect(s.workRam[DEBOUNCED_INPUT_OFF]).toBe(0xFF);
    // No falling edge yet (debounced unchanged)
    expect(s.workRam[FALLING_EDGES_OFF]).toBe(0);

    // Second LOW sample: now prev = 0 too
    debounceInput(s, 0);
    // newDeb = (0xFF | (0 & 0)) & (0 | 0) = 0xFF & 0 = 0
    expect(s.workRam[DEBOUNCED_INPUT_OFF]).toBe(0);
    // falling edge: (new ^ old) & old = (0 ^ 0xFF) & 0xFF = 0xFF
    expect(s.workRam[FALLING_EDGES_OFF]).toBe(0xFF);
  });
});

describe("gameMainGate (FUN_28972)", () => {
  it("MMIO bit 6 = 1: early exit, no Block C side effects", () => {
    const s = emptyGameState();
    // Pre-write to *0x4003B2 to verify it's NOT touched
    s.workRam[CONTROL_BYTE_OFF] = 0x12;
    gameMainGate(s, { mmioInput: 0x40 });
    // *0x4003B2 unchanged
    expect(s.workRam[CONTROL_BYTE_OFF]).toBe(0x12);
  });

  it("MMIO bit 6 = 0: Block C runs, sets *0x4003B2 = 0x40", () => {
    const s = emptyGameState();
    gameMainGate(s, { mmioInput: 0 });
    expect(s.workRam[CONTROL_BYTE_OFF]).toBe(0x40);
  });

  it("Block A: bit 0 of fallingEdges + state==1 + gateCheck=1 → count=1, state=5", () => {
    const s = emptyGameState();
    s.workRam[FALLING_EDGES_OFF] = 0x01;
    s.workRam[GAME_STATE_WORD_OFF + 1] = 1; // state=1
    const gateCheck = vi.fn().mockReturnValue(1);
    gameMainGate(s, { mmioInput: 0x40, gateCheck });
    expect(gateCheck).toHaveBeenCalledWith(1);
    // count = 1 (low byte)
    expect(s.workRam[OBJECT_COUNT_OFF + 1]).toBe(1);
    // state = 5
    expect(s.workRam[GAME_STATE_WORD_OFF + 1]).toBe(5);
    // Bit 0 of fallingEdges cleared
    expect(s.workRam[FALLING_EDGES_OFF] & 0x01).toBe(0);
  });

  it("Block A: gateCheck returns 0 → no commit", () => {
    const s = emptyGameState();
    s.workRam[FALLING_EDGES_OFF] = 0x01;
    s.workRam[GAME_STATE_WORD_OFF + 1] = 1;
    s.workRam[OBJECT_COUNT_OFF + 1] = 0xAB; // sentinel
    gameMainGate(s, { mmioInput: 0x40, gateCheck: () => 0 });
    // count unchanged
    expect(s.workRam[OBJECT_COUNT_OFF + 1]).toBe(0xAB);
    // But bit was still cleared (gate runs before result check)
    expect(s.workRam[FALLING_EDGES_OFF] & 0x01).toBe(0);
  });

  it("Hang: bit 0 + bit 1 of *0x4003AA set (preserved from the debounce) + MMIO bit 6 = 0 → hangRequested", () => {
    const s = emptyGameState() as GameStateWithHang;
    // To preserve bits 0+1 after debounce: prev=0x03, mmio=0x03 (both set).
    s.workRam[PREV_INPUT_OFF] = 0x03;
    s.workRam[DEBOUNCED_INPUT_OFF] = 0x03;
    gameMainGate(s, { mmioInput: 0x03 });
    expect(s.hangRequested).toBe(true);
  });

  it("Block C timer increment: state=1, outer < 360, += 60", () => {
    const s = emptyGameState();
    // obj[0]: state=1, outer=100
    s.workRam[0x18 + 0x18] = 1; // state=1 at obj[0]+0x18
    s.workRam[0x18 + 0x6a] = 0;
    s.workRam[0x18 + 0x6b] = 100;
    gameMainGate(s, { mmioInput: 0 });
    const newOuter = (s.workRam[0x18 + 0x6a] << 8) | (s.workRam[0x18 + 0x6b] ?? 0);
    expect(newOuter).toBe(160); // 100 + 60
  });

  it("Block C timer clamp: state=1, outer > 300, clamps to 360", () => {
    const s = emptyGameState();
    s.workRam[0x18 + 0x18] = 1;
    s.workRam[0x18 + 0x6a] = 1; // outer = 0x140 = 320
    s.workRam[0x18 + 0x6b] = 0x40;
    gameMainGate(s, { mmioInput: 0 });
    const newOuter = (s.workRam[0x18 + 0x6a] << 8) | (s.workRam[0x18 + 0x6b] ?? 0);
    expect(newOuter).toBe(0x168); // 360 (clamp)
  });
});
