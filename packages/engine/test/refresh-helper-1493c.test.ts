/**
 * Test refreshHelper1493C (FUN_1493C) — smoke tests on the main branches.
 *
 * `cli/src/test-refresh-helper-1493c-parity.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import {
  refreshHelper1493C,
  REFRESH_HELPER_1493C_ADDR,
  SLOT_BASE_ADDR,
  SLOT_STRIDE,
  SLOT_COUNT,
} from "../src/refresh-helper-1493c.js";
import { emptyGameState } from "../src/state.js";

describe("refreshHelper1493C (FUN_1493C)", () => {
  it("calls fun14966 exactly 4 times", () => {
    const state = emptyGameState();
    const calls: number[] = [];

    refreshHelper1493C(state, (_s, slotAddr) => {
      calls.push(slotAddr);
    });

    expect(calls.length).toBe(SLOT_COUNT);
  });

  it("calls fun14966 con the 4 indirizzi slot corretti (base + stride*i)", () => {
    const state = emptyGameState();
    const calls: number[] = [];

    refreshHelper1493C(state, (_s, slotAddr) => {
      calls.push(slotAddr);
    });

    expect(calls[0]).toBe(SLOT_BASE_ADDR);
    expect(calls[1]).toBe(SLOT_BASE_ADDR + SLOT_STRIDE);
    expect(calls[2]).toBe(SLOT_BASE_ADDR + SLOT_STRIDE * 2);
    expect(calls[3]).toBe(SLOT_BASE_ADDR + SLOT_STRIDE * 3);
  });

  it("default stub (no fun14966): no side effect su workRam", () => {
    const state = emptyGameState();
    // Snapshot workRam
    const before = Uint8Array.from(state.workRam);

    refreshHelper1493C(state);

    for (let i = 0; i < state.workRam.length; i++) {
      expect(state.workRam[i]).toBe(before[i]);
    }
  });

  it("passa lo same oggetto state a each chiamata", () => {
    const state = emptyGameState();
    const seenStates: GameState[] = [];

    refreshHelper1493C(state, (s, _addr) => {
      seenStates.push(s);
    });

    expect(seenStates.length).toBe(SLOT_COUNT);
    for (const s of seenStates) {
      expect(s).toBe(state);
    }
  });

  it("le costanti esportate hanno i values attesi", () => {
    expect(REFRESH_HELPER_1493C_ADDR).toBe(0x0001493c);
    expect(SLOT_BASE_ADDR).toBe(0x00401302);
    expect(SLOT_STRIDE).toBe(0x60);
    expect(SLOT_COUNT).toBe(4);
  });

  it("i side effects of fun14966 are applicati in ordine (slot 0 first)", () => {
    const state = emptyGameState();
    const order: number[] = [];

    refreshHelper1493C(state, (_s, slotAddr) => {
      order.push(slotAddr - SLOT_BASE_ADDR);
    });

    expect(order).toStrictEqual([0x00, 0x60, 0xc0, 0x120]);
  });

  it("fun14966 può mutare workRam — le modifiche are visibili al chiamante", () => {
    const WRAM_BASE = 0x00400000;
    const state = emptyGameState();
    const written: number[] = [];

    refreshHelper1493C(state, (s, slotAddr) => {
      const off = slotAddr - WRAM_BASE;
      s.workRam[off] = 0xAB;
      written.push(off);
    });

    for (const off of written) {
      expect(state.workRam[off]).toBe(0xAB);
    }
  });
});
