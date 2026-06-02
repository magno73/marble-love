/**
 * Test waitVblankStateGated (FUN_28DB8) — smoke tests on the main branches.
 *
 * Bit-perfect verified against the binary through
 * `cli/src/test-wait-vblank-state-gated-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  waitVblankStateGated,
  GAME_STATE_LO_BYTE_OFF,
  VBLANK_TICK_COUNTER_OFF,
  VBLANK_MAILBOX_OFF,
} from "../src/wait-vblank-state-gated.js";
import { emptyGameState } from "../src/state.js";

describe("waitVblankStateGated (FUN_28DB8)", () => {
  it("count <= 0: no iterazione, no side effects, D0w == arg word", () => {
    const s = emptyGameState();
    s.workRam[VBLANK_TICK_COUNTER_OFF] = 0x42;
    s.workRam[VBLANK_MAILBOX_OFF] = 0x99;

    // count = 0
    const r0 = waitVblankStateGated(s, 0);
    expect(r0.iterations).toBe(0);
    expect(r0.d0w).toBe(0);
    expect(r0.aborted).toBe(false);
    expect(s.workRam[VBLANK_TICK_COUNTER_OFF]).toBe(0x42); // unchanged
    expect(s.workRam[VBLANK_MAILBOX_OFF]).toBe(0x99); // unchanged

    // count signed negative (e.g. 0xFFFF = -1)
    const rNeg = waitVblankStateGated(s, 0xffff);
    expect(rNeg.iterations).toBe(0);
    expect(rNeg.d0w).toBe(0xffff); // count word returned as-is
    expect(s.workRam[VBLANK_TICK_COUNTER_OFF]).toBe(0x42); // still unchanged
  });

  it("count > 0, no abort: increments 0x3F0 of N, mailbox cleared, D0w = sext(loByte)", () => {
    const s = emptyGameState();
    s.workRam[VBLANK_TICK_COUNTER_OFF] = 0x10;
    s.workRam[GAME_STATE_LO_BYTE_OFF] = 0x05; // bit 7 = 0 → sext_w = 0x0005

    const r = waitVblankStateGated(s, 7);

    expect(r.iterations).toBe(7);
    expect(r.aborted).toBe(false);
    expect(r.d0w).toBe(0x0005);
    expect(s.workRam[VBLANK_TICK_COUNTER_OFF]).toBe(0x17); // 0x10 + 7
    expect(s.workRam[VBLANK_MAILBOX_OFF]).toBe(0); // final clr.b
  });

  it("counter wrap mod 256 (addq.b semantica)", () => {
    const s = emptyGameState();
    s.workRam[VBLANK_TICK_COUNTER_OFF] = 0xfd;
    s.workRam[GAME_STATE_LO_BYTE_OFF] = 0x00;

    const r = waitVblankStateGated(s, 5);

    expect(r.iterations).toBe(5);
    // 0xFD + 5 = 0x102 → byte = 0x02
    expect(s.workRam[VBLANK_TICK_COUNTER_OFF]).toBe(0x02);
  });

  it("loByte con bit 7 set: sign-extend produce 0xFFxx in D0w", () => {
    const s = emptyGameState();
    s.workRam[GAME_STATE_LO_BYTE_OFF] = 0x80; // bit 7 = 1

    const r = waitVblankStateGated(s, 1);

    expect(r.iterations).toBe(1);
    expect(r.d0w).toBe(0xff80); // sext_w(0x80) = 0xFF80
  });

  it("abortAtIter == k runs exactly k iterazioni, aborted=true", () => {
    const s = emptyGameState();
    s.workRam[VBLANK_TICK_COUNTER_OFF] = 0x00;
    s.workRam[GAME_STATE_LO_BYTE_OFF] = 0x07;

    const r = waitVblankStateGated(s, 10, /*abortAtIter*/ 3);

    expect(r.iterations).toBe(3);
    expect(r.aborted).toBe(true);
    expect(s.workRam[VBLANK_TICK_COUNTER_OFF]).toBe(0x03);
  });

  it("abortAtIter > countWord: ignorato (no abort)", () => {
    const s = emptyGameState();
    s.workRam[GAME_STATE_LO_BYTE_OFF] = 0x00;

    const r = waitVblankStateGated(s, 4, /*abortAtIter*/ 99);

    expect(r.iterations).toBe(4);
    expect(r.aborted).toBe(false);
  });

  it("abortAtIter == 1: minimo number of iterazioni eseguite (1)", () => {
    const s = emptyGameState();
    s.workRam[GAME_STATE_LO_BYTE_OFF] = 0x00;

    const r = waitVblankStateGated(s, 50, /*abortAtIter*/ 1);

    expect(r.iterations).toBe(1);
    expect(r.aborted).toBe(true);
    expect(s.workRam[VBLANK_TICK_COUNTER_OFF]).toBe(0x01);
  });
});
