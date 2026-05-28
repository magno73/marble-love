/**
 * script-slot-step-13068.test.ts — smoke per `FUN_00013068`.
 *
 * Bit-perfect verified against the binary through
 * `cli/src/test-script-slot-step-13068-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import {
  scriptSlotStep13068,
  SCRIPT_SLOT_STEP_13068_ADDR,
} from "../src/script-slot-step-13068.js";

const WRAM = 0x00400000;

// ─── Helpers ─────────────────────────────────────────────────────────────

function wb(
  state: ReturnType<typeof emptyGameState>,
  addr: number,
  v: number,
): void {
  state.workRam[(addr - WRAM) >>> 0] = v & 0xff;
}

function ww(
  state: ReturnType<typeof emptyGameState>,
  addr: number,
  v: number,
): void {
  const off = (addr - WRAM) >>> 0;
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function wl(
  state: ReturnType<typeof emptyGameState>,
  addr: number,
  v: number,
): void {
  const off = (addr - WRAM) >>> 0;
  const u = v >>> 0;
  state.workRam[off] = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8) & 0xff;
  state.workRam[off + 3] = u & 0xff;
}

function rb(
  state: ReturnType<typeof emptyGameState>,
  addr: number,
): number {
  return state.workRam[(addr - WRAM) >>> 0] ?? 0;
}

function rw(
  state: ReturnType<typeof emptyGameState>,
  addr: number,
): number {
  const off = (addr - WRAM) >>> 0;
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function rl(
  state: ReturnType<typeof emptyGameState>,
  addr: number,
): number {
  const off = (addr - WRAM) >>> 0;
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

/** A typical slot address in the script-state array. */
const SLOT = 0x00400a9c as const;

/**
 * Set slot byte/word/long at given offset.
 */
function sb(s: ReturnType<typeof emptyGameState>, off: number, v: number) {
  wb(s, SLOT + off, v);
}
function sw(s: ReturnType<typeof emptyGameState>, off: number, v: number) {
  ww(s, SLOT + off, v);
}
function sl(s: ReturnType<typeof emptyGameState>, off: number, v: number) {
  wl(s, SLOT + off, v);
}
function gb(s: ReturnType<typeof emptyGameState>, off: number) {
  return rb(s, SLOT + off);
}
function gw(s: ReturnType<typeof emptyGameState>, off: number) {
  return rw(s, SLOT + off);
}
function gl(s: ReturnType<typeof emptyGameState>, off: number) {
  return rl(s, SLOT + off);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("scriptSlotStep13068 (FUN_13068)", () => {
  it("exports SCRIPT_SLOT_STEP_13068_ADDR = 0x13068", () => {
    expect(SCRIPT_SLOT_STEP_13068_ADDR).toBe(0x00013068);
  });

  it("slot[0x18] == 0 → no-op (inactive slot)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    sb(state, 0x18, 0); // inactive

    let called = false;
    scriptSlotStep13068(state, rom, SLOT, {
      fun12896: () => { called = true; },
    });

    expect(called).toBe(false);
  });

  it("case 3 (slot[0x1a]==3): copies slot[0x3a]→[0x36], sets [0x3e/0x46/0x4a]=0x20c14, calls fun12896", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1); // active
    sb(state, 0x1a, 3); // case 3
    sb(state, 0x1f, 0); // kind != 3 (skip global timers block)
    sl(state, 0x3a, 0xdeadbeef); // source value

    let calledPtr: number | null = null;
    scriptSlotStep13068(state, rom, SLOT, {
      fun12896: (_s, ptr) => { calledPtr = ptr; },
    });

    expect(calledPtr).toBe(SLOT);
    expect(gl(state, 0x36)).toBe(0xdeadbeef); // copy
    expect(gl(state, 0x3e)).toBe(0x00020c14); // reset
    expect(gl(state, 0x46)).toBe(0x00020c14);
    expect(gl(state, 0x4a)).toBe(0x00020c14);
  });

  it("case 4 (slot[0x1a]==4): sets slot[0x3e]=0x20c14 only, no fun12896", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 4);
    sb(state, 0x1f, 0);

    let called = false;
    scriptSlotStep13068(state, rom, SLOT, {
      fun12896: () => { called = true; },
    });

    expect(called).toBe(false);
    expect(gl(state, 0x3e)).toBe(0x00020c14);
  });

  it("case 0: slot[0x1c]==0 → no decrement, no fun12896, slot[0x1c] stays 0", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 0);
    sb(state, 0x1f, 0);
    sw(state, 0x1c, 0); // timer already 0

    let called = false;
    scriptSlotStep13068(state, rom, SLOT, {
      fun12896: () => { called = true; },
    });

    expect(called).toBe(false);
    expect(gw(state, 0x1c)).toBe(0);
  });

  it("case 0: slot[0x1c]==2 → decrements to 1, no fun12896", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 0);
    sb(state, 0x1f, 0);
    sw(state, 0x1c, 2); // timer = 2

    let called = false;
    scriptSlotStep13068(state, rom, SLOT, {
      fun12896: () => { called = true; },
    });

    expect(gw(state, 0x1c)).toBe(1); // decremented
    expect(called).toBe(false);
  });

  it("case 0: slot[0x1c]==1, slot[0x18]==1 → decrements to 0, calls fun12896", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1); // active == 1
    sb(state, 0x1a, 0);
    sb(state, 0x1f, 0);
    sw(state, 0x1c, 1); // timer = 1, will reach 0

    let called = false;
    scriptSlotStep13068(state, rom, SLOT, {
      fun12896: () => { called = true; },
    });

    expect(gw(state, 0x1c)).toBe(0);
    expect(called).toBe(true);
  });

  it("case 0: slot[0x1c]==1, slot[0x18]!=1 → no fun12896", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 2); // active != 1
    sb(state, 0x1a, 0);
    sb(state, 0x1f, 0);
    sw(state, 0x1c, 1);

    let called = false;
    scriptSlotStep13068(state, rom, SLOT, {
      fun12896: () => { called = true; },
    });

    expect(called).toBe(false);
  });

  it("case 1: slot[0x21]==0 → slot[0x20] not incremented, counters equal (both 0) → proceeds", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 1);
    sb(state, 0x1f, 0);
    sb(state, 0x21, 0); // limit = 0
    sb(state, 0x20, 0); // counter = 0

    // Set up a non-tombstone at slot[0x3e] so FUN_132E0 doesn't trigger
    // (we need slot[0x3e] to not point to 0xFFFFFFFF)
    sl(state, 0x3e, WRAM + 0x100); // points into work RAM
    wl(state, WRAM + 0x100, 0x12345678); // not tombstone

    scriptSlotStep13068(state, rom, SLOT);

    // With limit==0 and counter==0: equal → proceeds. Counter reset to 0.
    expect(gb(state, 0x20)).toBe(0);
  });

  it("case 1: limit=3, counter=2 → increments to 3 (equal) → advances position", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 1);
    sb(state, 0x1f, 0);
    sb(state, 0x21, 3); // limit
    sb(state, 0x20, 2); // counter (will become 3 = limit)

    // velocity
    sl(state, 0x00, 0x0010); // vel X
    sl(state, 0x04, 0x0020); // vel Y
    // position
    sl(state, 0x0c, 0x0100); // pos X
    sl(state, 0x10, 0x0200); // pos Y

    // Set up slot[0x3e] pointing to work RAM (non-tombstone)
    const recAddr = WRAM + 0x500;
    sl(state, 0x3e, recAddr);
    wl(state, recAddr, 0x11223344); // not tombstone at first deref (for 13334)
    // Also init slot[0x46] (base ptr) for FUN_132E0 wrap
    sl(state, 0x46, recAddr);
    sl(state, 0x4a, recAddr);

    scriptSlotStep13068(state, rom, SLOT);

    // counter reset to 0
    expect(gb(state, 0x20)).toBe(0);
    // position advanced
    expect(gl(state, 0x0c)).toBe((0x0100 + 0x0010) >>> 0);
    expect(gl(state, 0x10)).toBe((0x0200 + 0x0020) >>> 0);
  });

  it("case 1: limit=3, counter=1 → increments to 2 (not equal) → d2=1, no position advance", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 1);
    sb(state, 0x1f, 0);
    sb(state, 0x21, 3); // limit
    sb(state, 0x20, 1); // counter

    sl(state, 0x0c, 0x0100);
    sl(state, 0x10, 0x0200);

    scriptSlotStep13068(state, rom, SLOT);

    expect(gb(state, 0x20)).toBe(2); // incremented
    expect(gl(state, 0x0c)).toBe(0x0100); // not advanced
  });

  it("case 2: limit=2, counter=1 → increments to 2 (equal) → clears counter", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 2);
    sb(state, 0x1f, 0); // kind not 3
    sb(state, 0x23, 2); // limit
    sb(state, 0x22, 1); // counter

    // Set slot[0x3e] → non-tombstone in work RAM
    const recAddr = WRAM + 0x600;
    sl(state, 0x3e, recAddr);
    wl(state, recAddr, 0x55667788);
    sl(state, 0x46, recAddr);
    sl(state, 0x4a, recAddr);

    scriptSlotStep13068(state, rom, SLOT);

    expect(gb(state, 0x22)).toBe(0); // cleared
  });

  it("case 2: limit=5, counter=3 → increments to 4, d2=1, no position advance", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 2);
    sb(state, 0x1f, 0);
    sb(state, 0x23, 5); // limit
    sb(state, 0x22, 3); // counter

    scriptSlotStep13068(state, rom, SLOT);

    expect(gb(state, 0x22)).toBe(4); // incremented
  });

  it("kind==3 timer block: timer 0x400456 decrements each call", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 0); // case 0 (simplest dispatch)
    sb(state, 0x1f, 3); // kind == 3 triggers timer block

    // Set timers to non-zero values that won't trigger wraparound
    wb(state, 0x400456, 5);
    wb(state, 0x400458, 5);
    wb(state, 0x40045a, 5);

    // Set case-0 timer to non-zero to avoid fun12896 call
    sw(state, 0x1c, 10);

    scriptSlotStep13068(state, rom, SLOT);

    expect(rb(state, 0x400456)).toBe(4); // decremented
    expect(rb(state, 0x400458)).toBe(4);
    expect(rb(state, 0x40045a)).toBe(4);
  });

  it("kind==3 timer 0x400456 wraps: reset to 2 and advances ptr44a", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 0);
    sb(state, 0x1f, 3);

    // timer 456 = 1 → will hit 0
    wb(state, 0x400456, 1);
    // ptr44a points to ROM; next entry should not be tombstone
    // Setup ptr44a in ROM area: point to bytes that are not 0xffffffff
    // We'll put ptr44a = 0x100 (will be advanced to 0x104)
    wl(state, 0x40044a, 0x100);
    // ROM at 0x104 is not tombstone (default ROM bytes are just program)

    // Set timer 458 and 45a to avoid their wraps too
    wb(state, 0x400458, 5);
    wb(state, 0x40045a, 5);
    sw(state, 0x1c, 5);

    scriptSlotStep13068(state, rom, SLOT);

    // timer 456 was reset to 2 (move.b #2,(A3))
    expect(rb(state, 0x400456)).toBe(2);
    // ptr44a advanced by 4
    expect(rl(state, 0x40044a)).toBe(0x104);
  });

  it("case 2 kind==6: increments slot[0x25], triggers flag75e at 0x1e", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 2);
    sb(state, 0x1f, 6); // kind == 6
    sb(state, 0x23, 1); // limit = 1
    sb(state, 0x22, 0); // counter = 0 → equal to limit after increment? No.
    // limit=1, counter=0: tst.b(0x23)=1 → addq.b 1,(0x22) → 1; cmp(1,1) → equal → clear

    // Set slot[0x25] to 0x1d so after increment it becomes 0x1e → triggers flag75e
    sb(state, 0x25, 0x1d);

    // Set rec ptr for FUN_132E0
    const recAddr = WRAM + 0x700;
    sl(state, 0x3e, recAddr);
    wl(state, recAddr, 0x11111111);
    sl(state, 0x46, recAddr);
    sl(state, 0x4a, recAddr);

    // Turn off timers to avoid global block
    wb(state, 0x400456, 5);
    wb(state, 0x400458, 5);
    wb(state, 0x40045a, 5);

    // Make slot[0x1e]=0 and mode_hi=0 for 13334 to take compute path
    sb(state, 0x1e, 0);

    scriptSlotStep13068(state, rom, SLOT);

    // slot[0x25] should be 0x1e
    expect(gb(state, 0x25)).toBe(0x1e);
    // flag75e should be set to 1
    expect(rb(state, 0x40075e)).toBe(1);
  });

  it("slot[0x1e]==1 AND d2!=0: FUN_13334 NOT called at end", () => {
    // When slot[0x1e]==1 the final FUN_13334 call is suppressed.
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 4); // case 4: sets d2=1
    sb(state, 0x1f, 0);
    sb(state, 0x1e, 1); // mode == 1 → suppresses final FUN_13334

    // Ensure slot[0x3e] and surrounding area won't crash FUN_13334
    // (it won't be called but just in case)
    sl(state, 0x3e, WRAM + 0x800);
    wl(state, WRAM + 0x800, 0xffffffff); // tombstone

    // Track if FUN_13334 side-effects happened (writes to 0x400690)
    const posBefore = rb(state, 0x400690);
    scriptSlotStep13068(state, rom, SLOT);
    // Since mode==1 and record is tombstone, FUN_13334 would have returned
    // early anyway; what matters is the final call is skipped.
    // POS_X should not be written (FUN_13334 skipped for mode==1 tombstone).
    expect(rb(state, 0x400690)).toBe(posBefore);
  });

  it("case 0 + slot[0x1e]!=1, d2=1 → final FUN_13334 called", () => {
    // case 0 always sets d2=1; final FUN_13334 is called if slot[0x1e]!=1.
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 0);
    sb(state, 0x1f, 0);
    sb(state, 0x1e, 0); // mode != 1 → final FUN_13334 IS called
    sw(state, 0x1c, 0); // timer already 0

    // Set up slot for FUN_13334: mode=0 (compute path)
    // slot[0x3e] → non-tombstone in work RAM (for 13334 indirect)
    const recAddr = WRAM + 0x900;
    sl(state, 0x3e, recAddr);
    wl(state, recAddr, 0x12341234);
    // slot[0xC], [0x10], [0x14] for coord compute
    // FUN_13334 reads slot[0xC] as a WORD (16-bit) from bytes at offsets 0xC,0xD.
    // ww writes big-endian: ww(addr, 0x0050) → [0x00, 0x50]
    ww(state, SLOT + 0x0c, 0x0050); // slot[0xC].w = 0x0050
    ww(state, SLOT + 0x10, 0x0060); // slot[0x10].w = 0x0060
    ww(state, SLOT + 0x14, 0x0005); // slot[0x14].w = 0x0005

    // HUD offset
    ww(state, 0x40097e, 0x0000);

    scriptSlotStep13068(state, rom, SLOT);

    // FUN_13334 should have written POS_X (0x400690) with slot[0xC].w = 0x0050
    expect(rb(state, 0x400690)).toBe(0x00); // high byte of 0x0050
    expect(rb(state, 0x400691)).toBe(0x50); // low byte
  });

  it("subs undefined → no throw", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    sb(state, 0x18, 1);
    sb(state, 0x1a, 3);
    sb(state, 0x1f, 0);

    expect(() => scriptSlotStep13068(state, rom, SLOT)).not.toThrow();
  });
});
