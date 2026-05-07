import { describe, expect, it } from "vitest";

import { emptyRomImage } from "../src/bus.js";
import { emptyGameState } from "../src/state.js";
import {
  PLAYER_SLOT_ITER_118D2_ADDR,
  playerSlotIter118D2,
} from "../src/player-slot-iter-118d2.js";

// Helpers
function rw(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}
function ww(s: ReturnType<typeof emptyGameState>, off: number, v: number): void {
  s.workRam[off] = (v >>> 8) & 0xff;
  s.workRam[off + 1] = v & 0xff;
}
function colorW(s: ReturnType<typeof emptyGameState>, off: number): number {
  return (((s.colorRam[off] ?? 0) << 8) | (s.colorRam[off + 1] ?? 0)) & 0xffff;
}

// workRam offset of slot N, field F
const SLOT_OFF = (n: number, f: number) => 0x18 + n * 0xe2 + f;

describe("playerSlotIter118D2 (FUN_118D2)", () => {
  it("exposes the binary entry address", () => {
    expect(PLAYER_SLOT_ITER_118D2_ADDR).toBe(0x000118d2);
  });

  it("produces correct color RAM final state with no active slots", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // slotCount = 0 → loops don't execute
    ww(s, 0x396, 0);

    playerSlotIter118D2(s, rom);

    // After full function: finalize overwrites everything.
    // Final-half values (finalize path):
    expect(colorW(s, 0x00)).toBe(0xafff);
    expect(colorW(s, 0x08)).toBe(0xafff);
    expect(colorW(s, 0x3a)).toBe(0xafff);
    expect(colorW(s, 0x06)).toBe(0xf00f);
    expect(colorW(s, 0x0e)).toBe(0xaf00);
    expect(colorW(s, 0x10)).toBe(0xafff);
    expect(colorW(s, 0x18)).toBe(0xafff);
    // 0x12 and 0x1a are cleared in finalize (after being written 0xAFFF in first half)
    expect(colorW(s, 0x12)).toBe(0x0000);
    expect(colorW(s, 0x1a)).toBe(0x0000);
    // 0x16 set to 0xF00F in first half, not touched in finalize → remains 0xF00F
    expect(colorW(s, 0x16)).toBe(0xf00f);
    // 0x1e set to 0xAF00 in first half, not touched in finalize → remains 0xAF00
    expect(colorW(s, 0x1e)).toBe(0xaf00);
  });

  it("applies full color RAM init+finalize pattern", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    ww(s, 0x396, 0);

    playerSlotIter118D2(s, rom);

    // After finalize: 0x12 and 0x1a are cleared back to 0
    expect(colorW(s, 0x12)).toBe(0x0000);
    expect(colorW(s, 0x1a)).toBe(0x0000);
    // Odd addresses that were not touched by either half remain 0
    expect(colorW(s, 0x14)).toBe(0x0000);
  });

  it("skips slot mutations when slotCount=0 (no loops)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    ww(s, 0x396, 0);
    // Set slot 0 state=3 — should NOT be mutated
    s.workRam[SLOT_OFF(0, 0x18)] = 3;
    s.workRam[SLOT_OFF(0, 0x71)] = 0xab;

    playerSlotIter118D2(s, rom);

    expect(s.workRam[SLOT_OFF(0, 0x71)]).toBe(0xab); // untouched
  });

  it("mutates slot fields (d8, 71, 70) only for slots with state==3", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    ww(s, 0x396, 2); // 2 slots
    // Slot 0: state=3 → should be mutated
    s.workRam[SLOT_OFF(0, 0x18)] = 3;
    s.workRam[SLOT_OFF(0, 0xd8)] = 0xbb;
    s.workRam[SLOT_OFF(0, 0x71)] = 0x00;
    s.workRam[SLOT_OFF(0, 0x70)] = 0xcc;
    // Slot 1: state=1 → should NOT be mutated
    s.workRam[SLOT_OFF(1, 0x18)] = 1;
    s.workRam[SLOT_OFF(1, 0xd8)] = 0xdd;
    s.workRam[SLOT_OFF(1, 0x71)] = 0xee;
    s.workRam[SLOT_OFF(1, 0x70)] = 0xff;

    playerSlotIter118D2(s, rom);

    // Slot 0 mutations
    expect(s.workRam[SLOT_OFF(0, 0xd8)]).toBe(0x00); // cleared in first loop
    expect(s.workRam[SLOT_OFF(0, 0x71)]).toBe(0xff); // set to 0xFF in first loop
    // slot[0x70]: cleared in first loop, then set to 0xFF again in second loop
    expect(s.workRam[SLOT_OFF(0, 0x70)]).toBe(0xff); // final value after second loop
    // Slot 1 untouched by field mutations
    expect(s.workRam[SLOT_OFF(1, 0xd8)]).toBe(0xdd);
    expect(s.workRam[SLOT_OFF(1, 0x71)]).toBe(0xee);
    expect(s.workRam[SLOT_OFF(1, 0x70)]).toBe(0xff);
  });

  it("second loop sets slot[0x70]=0xFF for state==3 slots", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    ww(s, 0x396, 1); // 1 slot
    s.workRam[SLOT_OFF(0, 0x18)] = 3;

    playerSlotIter118D2(s, rom);

    // After second loop: (0x70, a2) = 0xFF
    expect(s.workRam[SLOT_OFF(0, 0x70)]).toBe(0xff);
  });

  it("invokes fun_0142 with correct tileBase and textPtr", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    ww(s, 0x396, 2);
    s.workRam[SLOT_OFF(0, 0x18)] = 3; // slot 0 active
    s.workRam[SLOT_OFF(1, 0x18)] = 3; // slot 1 active

    const calls: Array<{ textPtr: number; tileBase: number }> = [];
    playerSlotIter118D2(s, rom, {
      fun_0142: (_state, textPtr, tileBase) => calls.push({ textPtr, tileBase }),
    });

    expect(calls).toHaveLength(2);
    // Slot 0 (d2==0): player 0 → tileBase=0x2000, textPtr=0x22b82
    expect(calls[0]).toEqual({ textPtr: 0x00022b82, tileBase: 0x2000 });
    // Slot 1 (d2==1): player 1 → tileBase=0x2400, textPtr=0x22b9a
    expect(calls[1]).toEqual({ textPtr: 0x00022b9a, tileBase: 0x2400 });
  });

  it("invokes fun_28db8 with 0x28 frames", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    ww(s, 0x396, 0);

    const frames: number[] = [];
    playerSlotIter118D2(s, rom, {
      fun_28db8: (_state, f) => frames.push(f),
    });

    expect(frames).toEqual([0x28]);
  });

  it("invokes fun_158ac with ROM sound table lookup", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    ww(s, 0x396, 0);

    // *0x400394 = 3 → index = (3-1)*4 = 8 → ROM[0x1ef92+8]
    // ROM table at 0x1ef92: [0x09, 0x0b, 0x0d, 0x12, 0x17, 0x19, 0x1c, 0x1d]
    // index 2 (3-1=2) → entry[2] = 0x0000000d = 13
    ww(s, 0x394, 3);
    // Write ROM table entry for level 3 (index 2 = (3-1)*4 = 8 bytes in)
    const tableOff = 0x1ef92 + 2 * 4;
    rom.program[tableOff] = 0x00;
    rom.program[tableOff + 1] = 0x00;
    rom.program[tableOff + 2] = 0x00;
    rom.program[tableOff + 3] = 0xab; // fake sound cmd ptr

    const cmds: number[] = [];
    playerSlotIter118D2(s, rom, {
      fun_158ac: (_state, cmd) => { cmds.push(cmd); return 1; },
    });

    expect(cmds).toEqual([0xab]);
  });

  it("invokes fun_16ec6 when levelSigned < 6", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    ww(s, 0x396, 0);

    // *0x400394 = 5 → 5 < 6 → invoke
    ww(s, 0x394, 5);
    let called = 0;
    playerSlotIter118D2(s, rom, { fun_16ec6: () => { called++; } });
    expect(called).toBe(1);

    // *0x400394 = 6 → 6 >= 6 → skip
    called = 0;
    ww(s, 0x394, 6);
    playerSlotIter118D2(s, rom, { fun_16ec6: () => { called++; } });
    expect(called).toBe(0);

    // *0x400394 = 7 → skip
    called = 0;
    ww(s, 0x394, 7);
    playerSlotIter118D2(s, rom, { fun_16ec6: () => { called++; } });
    expect(called).toBe(0);
  });

  it("invokes fun_28608 for state==3 slots in second loop with correct args", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    ww(s, 0x396, 2);
    s.workRam[SLOT_OFF(0, 0x18)] = 3;
    // slot[0x6A] = 50 → clamped=50, accumVal=5000
    s.workRam[SLOT_OFF(0, 0x6a)] = 0;
    s.workRam[SLOT_OFF(0, 0x6b)] = 50;
    s.workRam[SLOT_OFF(1, 0x18)] = 0; // not active

    const calls28608: Array<{ slotPtr: number; value: number }> = [];
    playerSlotIter118D2(s, rom, {
      fun_28608: (_state, slotPtr, value) => calls28608.push({ slotPtr, value }),
    });

    expect(calls28608).toHaveLength(1);
    expect(calls28608[0]!.slotPtr).toBe(0x00400018);
    expect(calls28608[0]!.value).toBe(5000); // 50 * 100
  });

  it("clamps score to 99 before accumulation", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    ww(s, 0x396, 1);
    s.workRam[SLOT_OFF(0, 0x18)] = 3;
    // slot[0x6A] = 200 (> 99) → clamped = 99 → accumVal = 9900
    s.workRam[SLOT_OFF(0, 0x6a)] = 0;
    s.workRam[SLOT_OFF(0, 0x6b)] = 200;

    const vals: number[] = [];
    playerSlotIter118D2(s, rom, {
      fun_28608: (_state, _ptr, val) => vals.push(val),
    });

    expect(vals).toEqual([9900]);
  });

  it("does not invoke fun_16ec6 or sound/vblank sub when slotCount=0, level=6", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    ww(s, 0x396, 0);
    ww(s, 0x394, 6);

    const called = { ec6: 0, db8: 0 };
    playerSlotIter118D2(s, rom, {
      fun_16ec6: () => { called.ec6++; },
      fun_28db8: () => { called.db8++; },
    });

    expect(called.ec6).toBe(0); // 6 >= 6 → skip
    expect(called.db8).toBe(1); // always called
  });
});
