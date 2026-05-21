/**
 * refresh-frame-10fce.test.ts — smoke tests for `FUN_00010FCE`
 * (idle/refresh frame handler).
 *
 * Verifica:
 *   1. Tutte le 12 callback vengono invocate nell'ordine esatto del disasm.
 *   2. I due `addq.b #1, (0x4003F0)` avvengono nelle posizioni corrette
 *      (dopo JSR #5 e dopo JSR #10).
 *   3. La funzione è idempotente rispetto al frame-counter (incrementa di 2
 *      per chiamata).
 */

import { describe, it, expect } from "vitest";
import {
  refreshFrame10FCE,
  REFRESH_FRAME_10FCE_ADDR,
  FRAME_CTR_ADDR,
  fun253ECDispatch,
} from "../src/refresh-frame-10fce.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const WRAM = 0x00400000;
function frameCtrOff(): number {
  return FRAME_CTR_ADDR - WRAM;
}

function writeU16BE(bytes: Uint8Array, off: number, value: number): void {
  bytes[off] = (value >>> 8) & 0xff;
  bytes[off + 1] = value & 0xff;
}

function readU32BE(bytes: Uint8Array, off: number): number {
  return (
    (((bytes[off] ?? 0) << 24) |
      ((bytes[off + 1] ?? 0) << 16) |
      ((bytes[off + 2] ?? 0) << 8) |
      (bytes[off + 3] ?? 0)) >>>
    0
  );
}

function writeU32BE(bytes: Uint8Array, off: number, value: number): void {
  const v = value >>> 0;
  bytes[off] = (v >>> 24) & 0xff;
  bytes[off + 1] = (v >>> 16) & 0xff;
  bytes[off + 2] = (v >>> 8) & 0xff;
  bytes[off + 3] = v & 0xff;
}

function writeRomU32BE(rom: ReturnType<typeof emptyRomImage>, off: number, value: number): void {
  const v = value >>> 0;
  rom.program[off] = (v >>> 24) & 0xff;
  rom.program[off + 1] = (v >>> 16) & 0xff;
  rom.program[off + 2] = (v >>> 8) & 0xff;
  rom.program[off + 3] = v & 0xff;
}

function noOpRefreshFrameSubs(): Parameters<typeof refreshFrame10FCE>[2] {
  return {
    fun13EE6: () => undefined,
    objectScanDispatch251DE: () => undefined,
    processAllSprites189E2: () => undefined,
    objectUpdatePair158CC: () => undefined,
    slotArrayTick1493C: () => undefined,
    dispatchStrings17230: () => undefined,
    stateSub19BAA: () => undefined,
    stateSub1844A: () => undefined,
    stateDispatch12FD0: () => undefined,
    objDirtyDispatch28624: () => undefined,
  };
}

describe("refreshFrame10FCE (FUN_00010FCE)", () => {
  it("REFRESH_FRAME_10FCE_ADDR is 0x00010FCE", () => {
    expect(REFRESH_FRAME_10FCE_ADDR).toBe(0x00010fce);
  });

  it("FRAME_CTR_ADDR is 0x004003F0", () => {
    expect(FRAME_CTR_ADDR).toBe(0x004003f0);
  });

  it("invokes all 12 callbacks in correct order", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const calls: string[] = [];

    refreshFrame10FCE(state, rom, {
      fun13EE6: (s) => { calls.push("13EE6"); void s; },
      objectScanDispatch251DE: (s) => { calls.push("251DE"); void s; },
      processAllSprites189E2: (s) => { calls.push("189E2"); void s; },
      objectUpdatePair158CC: (s) => { calls.push("158CC"); void s; },
      slotArrayTick1493C: (s) => { calls.push("1493C"); void s; },
      // addq.b #1 happens HERE (position 5)
      dispatchStrings17230: (s) => { calls.push("17230"); void s; },
      fun1912C: (s) => { calls.push("1912C"); void s; },
      stateSub19BAA: (s) => { calls.push("19BAA"); void s; },
      stateSub1844A: (s) => { calls.push("1844A"); void s; },
      stateDispatch12FD0: (s) => { calls.push("12FD0"); void s; },
      // addq.b #1 happens HERE (position 10)
      objDirtyDispatch28624: (s) => { calls.push("28624"); void s; },
    });

    expect(calls).toEqual([
      "13EE6",
      "251DE",
      "189E2",
      "158CC",
      "1493C",
      // addq.b #1 at 0x10FEC
      "17230",
      "1912C",
      "19BAA",
      "1844A",
      "12FD0",
      // addq.b #1 at 0x11010
      "28624",
    ]);
  });

  it("frame counter incremented by 2 total (2× addq.b #1)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    state.workRam[frameCtrOff()] = 0;

    refreshFrame10FCE(state, rom, {
      fun13EE6: () => undefined,
      objectScanDispatch251DE: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => undefined,
      dispatchStrings17230: () => undefined,
      fun1912C: () => undefined,
      stateSub19BAA: () => undefined,
      stateSub1844A: () => undefined,
      stateDispatch12FD0: () => undefined,
      objDirtyDispatch28624: () => undefined,
    });

    expect(state.workRam[frameCtrOff()]).toBe(2);
  });

  it("wires object-pair state-2 animation transitions through FUN_25FC2", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const slotOff = 0x0a20; // object-pair slot 1 @ 0x400A20.

    state.workRam[slotOff + 0x18] = 0x02; // FUN_158F6 state-2 branch.
    state.workRam[slotOff + 0x1a] = 0x02; // HELPER_25FC2 state-2 sentinel handler.
    state.workRam[slotOff + 0x56] = 0x01; // step1 -> objectStateEntry25BAE(code 2).
    state.workRam[slotOff + 0x60] = 0x00; // advance immediately.
    writeU32BE(state.workRam, slotOff + 0x5a, 0x00020fde);
    writeRomU32BE(rom, 0x00020fe2, 0xffffffff); // sentinel after one anim step.

    const subs = noOpRefreshFrameSubs();
    delete subs.objectUpdatePair158CC; // exercise the real default 158CC -> 158F6 wiring.

    refreshFrame10FCE(state, rom, subs);

    expect(state.workRam[slotOff + 0x1a]).toBe(0x02);
    expect(state.workRam[slotOff + 0x56]).toBe(0x02);
    expect(state.workRam[slotOff + 0x60]).toBe(0x02);
    expect(readU32BE(state.workRam, slotOff + 0x5a)).toBe(0x00020fde);
  });

  it("first addq.b #1 happens after 1493C (before 17230)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    state.workRam[frameCtrOff()] = 10;

    let ctrAfter1493C = -1;
    let ctrAfter17230 = -1;

    refreshFrame10FCE(state, rom, {
      fun13EE6: () => undefined,
      objectScanDispatch251DE: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => {
        // Before the first addq.b — counter is still at initial value (10)
        ctrAfter1493C = state.workRam[frameCtrOff()] ?? -1;
      },
      dispatchStrings17230: () => {
        // After the first addq.b — counter is 11
        ctrAfter17230 = state.workRam[frameCtrOff()] ?? -1;
      },
      fun1912C: () => undefined,
      stateSub19BAA: () => undefined,
      stateSub1844A: () => undefined,
      stateDispatch12FD0: () => undefined,
      objDirtyDispatch28624: () => undefined,
    });

    expect(ctrAfter1493C).toBe(10); // addq.b not yet
    expect(ctrAfter17230).toBe(11); // addq.b has fired
  });

  it("second addq.b #1 happens after 12FD0 (before 28624)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    state.workRam[frameCtrOff()] = 5;

    let ctrAfter12FD0 = -1;
    let ctrAfter28624 = -1;

    refreshFrame10FCE(state, rom, {
      fun13EE6: () => undefined,
      objectScanDispatch251DE: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => undefined,
      dispatchStrings17230: () => undefined,
      fun1912C: () => undefined,
      stateSub19BAA: () => undefined,
      stateSub1844A: () => undefined,
      stateDispatch12FD0: () => {
        // Before the second addq.b — counter is 6 (initial 5 + first addq.b)
        ctrAfter12FD0 = state.workRam[frameCtrOff()] ?? -1;
      },
      objDirtyDispatch28624: () => {
        // After the second addq.b — counter is 7
        ctrAfter28624 = state.workRam[frameCtrOff()] ?? -1;
      },
    });

    expect(ctrAfter12FD0).toBe(6); // first addq.b done, second not yet
    expect(ctrAfter28624).toBe(7); // second addq.b has fired
  });

  it("frame counter wraps at 0xFF (byte addq.b)", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    state.workRam[frameCtrOff()] = 0xff;

    refreshFrame10FCE(state, rom, {
      fun13EE6: () => undefined,
      objectScanDispatch251DE: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => undefined,
      dispatchStrings17230: () => undefined,
      fun1912C: () => undefined,
      stateSub19BAA: () => undefined,
      stateSub1844A: () => undefined,
      stateDispatch12FD0: () => undefined,
      objDirtyDispatch28624: () => undefined,
    });

    // 0xFF + 1 = 0x00, 0x00 + 1 = 0x01 (byte overflow)
    expect(state.workRam[frameCtrOff()]).toBe(1);
  });

  it("stub defaults (fun13EE6 and fun1912C) are no-ops", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();

    // Snapshot workRam before
    const before = Uint8Array.from(state.workRam);

    // Call with only the replicated functions stubbed out, letting the
    // no-op stubs run for fun13EE6 and fun1912C
    refreshFrame10FCE(state, rom, {
      objectScanDispatch251DE: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => undefined,
      dispatchStrings17230: () => undefined,
      stateSub19BAA: () => undefined,
      stateSub1844A: () => undefined,
      stateDispatch12FD0: () => undefined,
      objDirtyDispatch28624: () => undefined,
      // fun13EE6 and fun1912C left as undefined → default no-op
    });

    // Only the frame counter should have changed
    const changed: number[] = [];
    for (let i = 0; i < state.workRam.length; i++) {
      if (state.workRam[i] !== before[i]) changed.push(i);
    }
    expect(changed).toEqual([frameCtrOff()]);
    expect(state.workRam[frameCtrOff()]).toBe(2);
  });

  it("default FUN_1912C recomputes array-9 sprite coords via FUN_199D6", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    writeU16BE(state.workRam, 0x394, 4);
    writeU16BE(state.workRam, 0x396, 0);

    const entityOff = 0x1890;
    state.workRam[entityOff + 0x18] = 1;
    state.workRam[entityOff + 0x1a] = 0;
    state.workRam[entityOff + 0x24] = 0;
    writeU32BE(state.workRam, entityOff + 0x0c, 0x012c0000);
    writeU32BE(state.workRam, entityOff + 0x10, 0x01f40000);
    writeU32BE(state.workRam, entityOff + 0x14, 0x3fdc0000);
    writeU32BE(state.workRam, entityOff + 0x20, 0xdeadbeef);

    refreshFrame10FCE(state, rom, noOpRefreshFrameSubs());

    expect(readU32BE(state.workRam, entityOff + 0x20)).toBe(0x01503ea0);
  });

  it("default FUN_1912C wires FUN_194BA case 0 through FUN_1953E", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    writeU16BE(state.workRam, 0x394, 4);
    writeU16BE(state.workRam, 0x396, 0);

    const entityOff = 0x1890;
    state.workRam[entityOff + 0x18] = 1;
    state.workRam[entityOff + 0x1a] = 0;
    state.workRam[entityOff + 0x1b] = 3;
    state.workRam[entityOff + 0x24] = 2;
    state.workRam[entityOff + 0x25] = 7;
    state.workRam[entityOff + 0x26] = 0;
    writeU32BE(state.workRam, entityOff + 0x1c, 0xdeadbeef);

    refreshFrame10FCE(state, rom, noOpRefreshFrameSubs());

    expect(readU32BE(state.workRam, entityOff + 0x1c)).toBe(0x00021f72);
    expect(state.workRam[entityOff + 0x1b]).toBe(0);
  });

  it("models FUN_253EC state 7 as a settle-only object path", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const obj = 0x18;

    state.workRam[0x396] = 0;
    state.workRam[0x397] = 1;
    state.workRam[obj + 0x18] = 1;
    state.workRam[obj + 0x1a] = 7;
    state.workRam[obj + 0x1b] = 0x34;
    state.workRam[obj + 0x1c] = 0x55;
    state.workRam[obj + 0x36] = 0;

    state.workRam[obj + 0x0c] = 0x00;
    state.workRam[obj + 0x0d] = 0x90;
    state.workRam[obj + 0x0e] = 0x00;
    state.workRam[obj + 0x0f] = 0x00;
    state.workRam[obj + 0x10] = 0x00;
    state.workRam[obj + 0x11] = 0x50;
    state.workRam[obj + 0x12] = 0x00;
    state.workRam[obj + 0x13] = 0x00;
    state.workRam[obj + 0x14] = 0x12;
    state.workRam[obj + 0x15] = 0x34;
    state.workRam[obj + 0x16] = 0x56;
    state.workRam[obj + 0x17] = 0x78;

    refreshFrame10FCE(state, rom, {
      fun13EE6: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => undefined,
      dispatchStrings17230: () => undefined,
      fun1912C: () => undefined,
      stateSub19BAA: () => undefined,
      stateSub1844A: () => undefined,
      stateDispatch12FD0: () => undefined,
      objDirtyDispatch28624: () => undefined,
    });

    expect(state.workRam[obj + 0x1a]).toBe(7);
    expect(state.workRam[obj + 0x1c]).toBe(0);
    expect(state.workRam[obj + 0x1d]).toBe(0x34);
    expect(state.workRam[obj + 0x2a]).toBe(0x12);
    expect(state.workRam[obj + 0x2b]).toBe(0x34);
    expect(state.workRam[obj + 0x2c]).toBe(0x56);
    expect(state.workRam[obj + 0x2d]).toBe(0x78);
    expect((state.workRam[obj + 0x32] << 8) | state.workRam[obj + 0x33]).toBe(0x12);
    expect((state.workRam[obj + 0x34] << 8) | state.workRam[obj + 0x35]).toBe(0x0a);
  });

  it("models FUN_253EC state 3 catapult countdown release", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const obj = 0x18;

    state.workRam[0x396] = 0;
    state.workRam[0x397] = 1;
    state.workRam[obj + 0x18] = 1;
    state.workRam[obj + 0x1a] = 3;
    state.workRam[obj + 0x36] = 2;
    state.workRam[obj + 0x58] = 0x0a;
    state.workRam[obj + 0x59] = 1;
    state.workRam[obj + 0x22] = 0xde;
    state.workRam[obj + 0x23] = 0xad;
    state.workRam[obj + 0x24] = 0xbe;
    state.workRam[obj + 0x25] = 0xef;
    state.workRam[obj + 0x26] = 0xca;
    state.workRam[obj + 0x27] = 0xfe;
    state.workRam[obj + 0x28] = 0xba;
    state.workRam[obj + 0x29] = 0xbe;

    refreshFrame10FCE(state, rom, {
      fun13EE6: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => undefined,
      dispatchStrings17230: () => undefined,
      fun1912C: () => undefined,
      stateSub19BAA: () => undefined,
      stateSub1844A: () => undefined,
      stateDispatch12FD0: () => undefined,
      objDirtyDispatch28624: () => undefined,
    });

    expect(state.workRam[obj + 0x1a]).toBe(0);
    expect(state.workRam[obj + 0x36]).toBe(2);
    expect(state.workRam[obj + 0x58]).toBe(0);
    expect(state.workRam[obj + 0x59]).toBe(0);
    expect(state.workRam.slice(obj + 0x22, obj + 0x2a)).toEqual(new Uint8Array(8));
  });

  it("keeps FUN_253EC state 3 active while catapult countdown is nonzero", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const obj = 0x18;

    state.workRam[0x396] = 0;
    state.workRam[0x397] = 1;
    state.workRam[obj + 0x18] = 1;
    state.workRam[obj + 0x1a] = 3;
    state.workRam[obj + 0x08] = 0x00;
    state.workRam[obj + 0x09] = 0x0a;
    state.workRam[obj + 0x58] = 0x0a;
    state.workRam[obj + 0x59] = 2;

    refreshFrame10FCE(state, rom, {
      fun13EE6: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => undefined,
      dispatchStrings17230: () => undefined,
      fun1912C: () => undefined,
      stateSub19BAA: () => undefined,
      stateSub1844A: () => undefined,
      stateDispatch12FD0: () => undefined,
      objDirtyDispatch28624: () => undefined,
    });

    expect(state.workRam[obj + 0x1a]).toBe(3);
    expect(state.workRam[obj + 0x58]).toBe(0x0a);
    expect(state.workRam[obj + 0x59]).toBe(1);
    expect(
      ((state.workRam[obj + 0x08] ?? 0) << 24) |
        ((state.workRam[obj + 0x09] ?? 0) << 16) |
        ((state.workRam[obj + 0x0a] ?? 0) << 8) |
        (state.workRam[obj + 0x0b] ?? 0),
    ).toBe(0x000a0000);
  });

  it("models FUN_253EC state 8 countdown animation", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const obj = 0x18;

    state.workRam[0x396] = 0;
    state.workRam[0x397] = 1;
    state.workRam[obj + 0x18] = 1;
    state.workRam[obj + 0x1a] = 8;
    state.workRam[obj + 0x1c] = 1;
    state.workRam[obj + 0x56] = 1;
    state.workRam[obj + 0x57] = 3;
    state.workRam[obj + 0x6b] = 7;
    state.workRam[obj + 0xd0] = 1;
    state.workRam[obj + 0xcc] = 0x00;
    state.workRam[obj + 0xcd] = 0x00;
    state.workRam[obj + 0xce] = 0x12;
    state.workRam[obj + 0xcf] = 0x34;

    refreshFrame10FCE(state, rom, {
      fun13EE6: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => undefined,
      dispatchStrings17230: () => undefined,
      fun1912C: () => undefined,
      stateSub19BAA: () => undefined,
      stateSub1844A: () => undefined,
      stateDispatch12FD0: () => undefined,
      objDirtyDispatch28624: () => undefined,
    });

    expect(state.workRam[obj + 0x1a]).toBe(8);
    expect(state.workRam[obj + 0x56]).toBe(9);
    expect(state.workRam[obj + 0x57]).toBe(2);
    expect(((state.workRam[obj + 0x6a] ?? 0) << 8) | (state.workRam[obj + 0x6b] ?? 0)).toBe(8);
    expect(state.workRam[obj + 0xd0]).toBe(0);
    expect(
      ((state.workRam[obj + 0xcc] ?? 0) << 24) |
        ((state.workRam[obj + 0xcd] ?? 0) << 16) |
        ((state.workRam[obj + 0xce] ?? 0) << 8) |
        (state.workRam[obj + 0xcf] ?? 0),
    ).toBe(0x1238);
  });

  it("models FUN_253EC state 8 terminal score/state init", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const obj = 0x18;

    state.workRam[0x396] = 0;
    state.workRam[0x397] = 1;
    state.workRam[obj + 0x18] = 1;
    state.workRam[obj + 0x1a] = 8;
    state.workRam[obj + 0x1c] = 1;
    state.workRam[obj + 0x56] = 1;
    state.workRam[obj + 0x57] = 1;
    state.workRam[obj + 0xd1] = 0x7f;

    refreshFrame10FCE(state, rom, {
      fun13EE6: () => undefined,
      processAllSprites189E2: () => undefined,
      objectUpdatePair158CC: () => undefined,
      slotArrayTick1493C: () => undefined,
      dispatchStrings17230: () => undefined,
      fun1912C: () => undefined,
      stateSub19BAA: () => undefined,
      stateSub1844A: () => undefined,
      stateDispatch12FD0: () => undefined,
      objDirtyDispatch28624: () => undefined,
    });

    expect(state.workRam[obj + 0x1a]).toBe(0);
    expect(state.workRam[obj + 0x57]).toBe(0);
    expect(state.workRam[obj + 0xd1]).toBe(0);
    expect(state.workRam[obj + 0xd8]).toBe(1);
  });

  it("models FUN_253EC state 9 as the string-hit death target path", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const player = 0x400018;
    const obj = player - WRAM;
    const slot = 0x401482;
    const slotOff = slot - WRAM;
    const cursorAddr = 0x23f66;
    const bboxAddr = 0x24000;

    state.workRam[obj + 0x18] = 1;
    state.workRam[obj + 0x1a] = 9;
    state.workRam[obj + 0x58] = 0;
    writeU16BE(state.workRam, obj + 0x0c, 100);
    writeU16BE(state.workRam, obj + 0x10, 100);
    writeU16BE(state.workRam, obj + 0x20, 0x0100); // keep FUN_1281C inner bounded out for this unit test.
    writeU16BE(state.workRam, slotOff + 0x0c, 120);
    writeU16BE(state.workRam, slotOff + 0x10, 120);
    writeU32BE(state.workRam, slotOff + 0x3a, cursorAddr);
    writeU32BE(rom.program, cursorAddr, bboxAddr);
    rom.program[bboxAddr + 0x04] = (-30) & 0xff;
    rom.program[bboxAddr + 0x05] = (-30) & 0xff;
    rom.program[bboxAddr + 0x06] = 60;
    rom.program[bboxAddr + 0x07] = 60;

    fun253ECDispatch(state, rom, player);

    expect(readU32BE(state.workRam, obj + 0x0c)).toBe(0x00650000);
    expect(readU32BE(state.workRam, obj + 0x10)).toBe(0x00650000);
    expect(state.workRam[obj + 0x1a]).toBe(9);
    expect(state.workRam[obj + 0x1c]).toBe(0);
  });

  it("models FUN_253EC state 10 vacuum countdown while active", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const player = 0x400018;
    const obj = player - WRAM;
    const slot = 0x400b48;

    writeU32BE(rom.program, 0x1f016 + 2 * 4, slot);

    state.workRam[obj + 0x1a] = 10;
    state.workRam[obj + 0x57] = 2;
    state.workRam[obj + 0x58] = 2;

    fun253ECDispatch(state, rom, player);

    expect(state.workRam[obj + 0x1a]).toBe(10);
    expect(state.workRam[obj + 0x57]).toBe(1);
  });

  it("models FUN_253EC state 10 vacuum terminal transition", () => {
    const state = emptyGameState();
    const rom = emptyRomImage();
    const player = 0x400018;
    const obj = player - WRAM;
    const slot = 0x400b48;
    const slotOff = slot - WRAM;

    writeU32BE(rom.program, 0x1f016 + 2 * 4, slot);
    writeU32BE(rom.program, 0x1ef5a, 0x48);
    rom.program[0x1d752] = 0xff;
    rom.program[0x1d753] = 0xff;

    state.workRam[obj + 0x1a] = 10;
    state.workRam[obj + 0x57] = 1;
    state.workRam[obj + 0x58] = 2;
    writeU32BE(state.workRam, obj + 0x5a, 0x12345678);
    writeU16BE(state.workRam, obj + 0xd2, 7);

    state.workRam[slotOff + 0x1b] = 0x1e;
    state.workRam[slotOff + 0x1f] = 0x0b;

    fun253ECDispatch(state, rom, player);

    expect(state.workRam[obj + 0x1a]).toBe(4);
    expect(state.workRam[obj + 0x57]).toBe(0x65);
    expect(readU32BE(state.workRam, obj + 0x5a)).toBe(0);
    expect(((state.workRam[obj + 0xd2] ?? 0) << 8) | (state.workRam[obj + 0xd3] ?? 0)).toBe(8);
    expect(readU32BE(state.workRam, slotOff + 0x36)).toBe(0x0001d754);
  });
});
