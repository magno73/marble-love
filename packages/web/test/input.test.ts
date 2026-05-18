import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initInput,
  isCoinKey,
  isStartKey,
  mapLiveScreenDeltaToTrackballDelta,
  normalizeKeyboardTrackballStep,
  rotateMarbleTrackballDelta,
} from "../src/input.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser input mapping", () => {
  it("rotates raw browser deltas into Marble trackball MMIO axes", () => {
    expect(rotateMarbleTrackballDelta(8, 0)).toEqual({ x: 8, y: 8 });
    expect(rotateMarbleTrackballDelta(0, 8)).toEqual({ x: 8, y: -8 });
    expect(rotateMarbleTrackballDelta(-8, 0)).toEqual({ x: -8, y: -8 });
    expect(rotateMarbleTrackballDelta(4, -6)).toEqual({ x: -2, y: 10 });
  });

  it("maps live screen-space controls onto direct MMIO axes", () => {
    expect(mapLiveScreenDeltaToTrackballDelta(8, 0)).toEqual({ x: -8, y: 0 });
    expect(mapLiveScreenDeltaToTrackballDelta(-8, 0)).toEqual({ x: 8, y: 0 });
    expect(mapLiveScreenDeltaToTrackballDelta(0, -8)).toEqual({ x: 0, y: 8 });
    expect(mapLiveScreenDeltaToTrackballDelta(0, 8)).toEqual({ x: 0, y: -8 });
    expect(mapLiveScreenDeltaToTrackballDelta(4, -6)).toEqual({ x: -4, y: 6 });
  });

  it("maps arcade coin/start keys separately from trackball movement", () => {
    expect(isCoinKey("5")).toBe(true);
    expect(isCoinKey("c")).toBe(true);
    expect(isCoinKey("ArrowLeft")).toBe(false);

    expect(isStartKey("Enter")).toBe(true);
    expect(isStartKey(" ")).toBe(true);
    expect(isStartKey("5")).toBe(false);
  });

  it("normalizes keyboard trackball step for debug tuning", () => {
    expect(normalizeKeyboardTrackballStep(undefined)).toBe(8);
    expect(normalizeKeyboardTrackballStep(16.4)).toBe(16);
    expect(normalizeKeyboardTrackballStep(0)).toBe(1);
    expect(normalizeKeyboardTrackballStep(999)).toBe(64);
  });

  it("uses configured keyboard step for live input", () => {
    type KeyHandler = (event: { key: string; repeat?: boolean; preventDefault(): void }) => void;
    const listeners: Record<string, KeyHandler[]> = {};
    vi.stubGlobal("window", {
      addEventListener(type: string, handler: KeyHandler) {
        listeners[type] ??= [];
        listeners[type].push(handler);
      },
    });
    vi.stubGlobal("document", {
      pointerLockElement: null,
      body: { requestPointerLock: undefined },
    });
    vi.stubGlobal("navigator", {
      getGamepads: () => [],
    });

    const input = initInput({ keyboardTrackballStep: 16 });
    for (const handler of listeners.keydown ?? []) {
      handler({ key: "ArrowRight", repeat: false, preventDefault() {} });
    }

    expect(input.consumeP1X()).toBe(0xef);
    expect(input.consumeP1Y()).toBe(0xff);
  });

  it("latches coin and start as frame-safe pulses", () => {
    type KeyHandler = (event: { key: string; repeat?: boolean; preventDefault(): void }) => void;
    const listeners: Record<string, KeyHandler[]> = {};
    vi.stubGlobal("window", {
      addEventListener(type: string, handler: KeyHandler) {
        listeners[type] ??= [];
        listeners[type].push(handler);
      },
    });
    vi.stubGlobal("document", {
      pointerLockElement: null,
      body: { requestPointerLock: undefined },
    });
    vi.stubGlobal("navigator", {
      getGamepads: () => [],
    });

    const input = initInput();
    const dispatchKey = (type: "keydown" | "keyup", key: string): void => {
      for (const handler of listeners[type] ?? []) {
        handler({ key, repeat: false, preventDefault() {} });
      }
    };

    dispatchKey("keydown", "5");
    dispatchKey("keyup", "5");
    expect(input.consumeCoinPulses()).toBe(1);
    expect(input.consumeCoinPulses()).toBe(0);

    dispatchKey("keydown", "Enter");
    dispatchKey("keyup", "Enter");
    expect(input.consumeStartPulses()).toBe(1);
    expect(input.consumeStartPulses()).toBe(0);
  });
});
