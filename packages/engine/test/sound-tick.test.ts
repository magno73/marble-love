/**
 * sound-tick.test.ts — smoke + corner case of soundTick (wrapper FUN_4CA0).
 *
 * Bit-perfect parity verified vs binary via test-sound-tick-parity.ts
 * (requires deterministic stubs for FUN_4DCC, FUN_3E1A, FUN_4C3E).
 */

import { describe, it, expect } from "vitest";
import { soundTick } from "../src/sound-tick.js";
import { emptyGameState } from "../src/state.js";

describe("soundTick (FUN_4CA0 wrapper)", () => {
  it("non solleva eccezioni con state vuoto", () => {
    const s = emptyGameState();
    expect(() => soundTick(s)).not.toThrow();
  });

  it("cmd < 0x40 con last_sent bit 7 set: dispatch and mark sent", () => {
    const s = emptyGameState();
    s.workRam[0x1f44] = 0x10; // cmd
    s.workRam[0x1f45] = 0x82; // last_sent (bit 7 set, value 0x02)
    s.workRam[0x1ff4] = 0x99; // retry counter (should be reset)

    const calls: number[] = [];
    soundTick(s, { fun_3e1a: (arg) => calls.push(arg) });

    expect(s.workRam[0x1ff4]).toBe(0); // retry reset
    expect(calls).toEqual([(0x10 << 8) | 0x02]); // dispatch
    expect(s.workRam[0x1f45]).toBe(0x10 | 0x80); // last_sent updated + flag
    // 0x1f44 cleared by simulated sound-CPU ack in default fun_4dcc
    // (M6502 reads mailbox and acks; without sound CPU emulation, simulate ack
    // immediato per matchare frame-done dump MAME). Pre-fix era 0x10|0x80.
    expect(s.workRam[0x1f44]).toBe(0); // cmd ack-cleared from the sound CPU sim
  });

  it("cmd >= 0x40: skip queue dispatch, solo mark sent", () => {
    const s = emptyGameState();
    s.workRam[0x1f44] = 0x80; // cmd >= 0x40 (bit 7 already set)
    s.workRam[0x1f45] = 0x12;
    s.workRam[0x1ff4] = 0x33;

    const calls: number[] = [];
    soundTick(s, { fun_3e1a: (arg) => calls.push(arg) });

    expect(calls.length).toBe(0); // no dispatch
    expect(s.workRam[0x1ff4]).toBe(0x33); // retry NOT reset
    expect(s.workRam[0x1f45]).toBe(0x12); // last_sent unchanged
    // 0x1f44 cleared by simulated sound-CPU ack (default fun_4dcc).
    expect(s.workRam[0x1f44]).toBe(0); // ack-cleared
  });

  it("cmd < 0x40 con last_sent bit 7 zero: no dispatch but update last_sent", () => {
    const s = emptyGameState();
    s.workRam[0x1f44] = 0x10;
    s.workRam[0x1f45] = 0x05; // bit 7 zero

    const calls: number[] = [];
    soundTick(s, { fun_3e1a: (arg) => calls.push(arg) });

    expect(calls.length).toBe(0); // no dispatch (last_sent bit 7 zero)
    expect(s.workRam[0x1f45]).toBe(0x10 | 0x80); // last_sent = cmd
  });

  it("cmd == last_sent (post-mask): no dispatch", () => {
    const s = emptyGameState();
    s.workRam[0x1f44] = 0x10;
    s.workRam[0x1f45] = 0x90; // last_sent bit 7 set, value 0x10 (= cmd)

    const calls: number[] = [];
    soundTick(s, { fun_3e1a: (arg) => calls.push(arg) });

    expect(calls.length).toBe(0); // skip dispatch (cmd == last)
    expect(s.workRam[0x1f45]).toBe(0x10 | 0x80); // ancora 0x90
  });

  it("FUN_4DCC sub is invocata", () => {
    const s = emptyGameState();
    let called = false;
    soundTick(s, { fun_4dcc: () => { called = true; } });
    expect(called).toBe(true);
  });

  it("cmd >= 0x40 + FUN_4C3E returns 0: increments retry counter", () => {
    const s = emptyGameState();
    s.workRam[0x1f44] = 0x80; // cmd >= 0x40 → no reset
    s.workRam[0x1ff4] = 0xfe;
    soundTick(s, { fun_4c3e: () => 0 });
    expect(s.workRam[0x1ff4]).toBe(0xff); // 0xfe+1 = 0xff
  });

  it("cmd >= 0x40 + FUN_4C3E returns 0 con retry overflow: satura a 0xff", () => {
    const s = emptyGameState();
    s.workRam[0x1f44] = 0x80; // cmd >= 0x40 → no reset
    s.workRam[0x1ff4] = 0xff;
    soundTick(s, { fun_4c3e: () => 0 });
    expect(s.workRam[0x1ff4]).toBe(0xff); // saturate (overflow → -1 = 0xff)
  });

  it("cmd >= 0x40 + FUN_4C3E returns 1: retry counter unchanged", () => {
    const s = emptyGameState();
    s.workRam[0x1f44] = 0x80; // cmd >= 0x40 → no reset
    s.workRam[0x1ff4] = 0x42;
    soundTick(s); // default fun_4c3e returns 1
    expect(s.workRam[0x1ff4]).toBe(0x42); // unchanged
  });

  it("cmd < 0x40: retry counter reset a 0", () => {
    const s = emptyGameState();
    s.workRam[0x1f44] = 0x10; // cmd < 0x40 → reset
    s.workRam[0x1ff4] = 0xab;
    soundTick(s);
    expect(s.workRam[0x1ff4]).toBe(0); // reset
  });
});
