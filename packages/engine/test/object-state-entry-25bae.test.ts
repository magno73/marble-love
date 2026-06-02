/**
 * Test objectStateEntry25BAE (FUN_00025BAE) — smoke tests on the dispatcher
 *
 * `FUN_00025BAE` (198 bytes) takes objPtr + subStateCode and performs writes
 * common effects (clear longs @ +0x0/+0x4 + conditional +0x18 if +0x1A==6),
 * then dispatches on 3 cases (2/9/4) that call FUN_158AC (sound) and/or
 * FUN_2591A (object init).
 *
 * `cli/src/test-object-state-entry-25bae-parity.ts` (500/500 cases).
 */

import { describe, it, expect } from "vitest";
import {
  objectStateEntry25BAE,
  OBJECT_STATE_ENTRY_25BAE_ADDR,
  OBJECT_STATE_ENTRY_25BAE_CODES,
  OBJECT_STATE_ENTRY_25BAE_SOUND_IDS,
  OBJECT_STATE_ENTRY_25BAE_SUB_ADDRS,
  SPRITE_PTR_CASE2,
  SPRITE_PTR_CASE9,
  FIELD_57_MATCH_VALUE,
  type ObjectStateEntry25BAESubs,
} from "../src/object-state-entry-25bae.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x400000;

function readU32BE(wr: Uint8Array, off: number): number {
  return (
    (((wr[off] ?? 0) << 24) |
      ((wr[off + 1] ?? 0) << 16) |
      ((wr[off + 2] ?? 0) << 8) |
      (wr[off + 3] ?? 0)) >>>
    0
  );
}

function readU16BE(wr: Uint8Array, off: number): number {
  return (((wr[off] ?? 0) << 8) | (wr[off + 1] ?? 0)) & 0xffff;
}

function writeU16BE(wr: Uint8Array, off: number, v: number): void {
  const u = v & 0xffff;
  wr[off] = (u >>> 8) & 0xff;
  wr[off + 1] = u & 0xff;
}

describe("objectStateEntry25BAE (FUN_00025BAE)", () => {
  it("case 2: writes sprite/state/sound + clears + invoca soundCommand(0x38)", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1000;
    const objOff = objPtr - WORK_RAM_BASE;

    // Pre-fill obj with non-zero sentinel to verify clear/overwrite.
    for (let k = 0; k < 0x80; k++) s.workRam[objOff + k] = 0x55;
    // A2[+0x1A] != 6 -> does not trigger the +0x18 conditional.
    s.workRam[objOff + 0x1a] = 0x00;
    s.workRam[objOff + 0x18] = 0xee;

    const sounds: number[] = [];
    objectStateEntry25BAE(s, objPtr, OBJECT_STATE_ENTRY_25BAE_CODES.state2, {
      soundCommand: (cmd) => sounds.push(cmd),
    });

    // Clears common: +0x0..3, +0x4..7 ← 0
    expect(readU32BE(s.workRam, objOff + 0x00)).toBe(0);
    expect(readU32BE(s.workRam, objOff + 0x04)).toBe(0);
    // +0x18 not touched (pre-state was not 6).
    expect(s.workRam[objOff + 0x18]).toBe(0xee);
    // Scritture case 2
    expect(s.workRam[objOff + 0x5f]).toBe(0);
    expect(s.workRam[objOff + 0x60]).toBe(0x02);
    expect(readU32BE(s.workRam, objOff + 0x5a)).toBe(SPRITE_PTR_CASE2);
    expect(s.workRam[objOff + 0x56]).toBe(0x02);
    expect(s.workRam[objOff + 0x1a]).toBe(0x02);
    // Sound 0x38 invoked.
    expect(sounds).toEqual([OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case2]);
  });

  it("case 9: writes sprite/state, NESSUNA chiamata soundCommand", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1100;
    const objOff = objPtr - WORK_RAM_BASE;

    s.workRam[objOff + 0x1a] = 0x77;
    const sounds: number[] = [];
    objectStateEntry25BAE(s, objPtr, OBJECT_STATE_ENTRY_25BAE_CODES.state9, {
      soundCommand: (cmd) => sounds.push(cmd),
    });

    // Clears common
    expect(readU32BE(s.workRam, objOff + 0x00)).toBe(0);
    expect(readU32BE(s.workRam, objOff + 0x04)).toBe(0);
    // Scritture case 9
    expect(s.workRam[objOff + 0x5f]).toBe(0);
    expect(s.workRam[objOff + 0x60]).toBe(0x04);
    expect(readU32BE(s.workRam, objOff + 0x5a)).toBe(SPRITE_PTR_CASE9);
    expect(s.workRam[objOff + 0x1a]).toBe(0x09);
    expect(s.workRam[objOff + 0x56]).toBe(0);
    expect(sounds).toEqual([]);
  });

  it("case 4 con A2[+0x57] == 0x65: invoca FUN_2591A + soundCommand(0x3C) + counter+1", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1200;
    const objOff = objPtr - WORK_RAM_BASE;

    // Pre-condition per branch match
    s.workRam[objOff + 0x57] = FIELD_57_MATCH_VALUE;
    // Counter pre = 0x00FE → +1 = 0x00FF
    writeU16BE(s.workRam, objOff + 0xd2, 0x00fe);

    const sounds: number[] = [];
    let fun2591ACalled = false;
    let fun2591AObjPtr = -1;
    objectStateEntry25BAE(s, objPtr, OBJECT_STATE_ENTRY_25BAE_CODES.state4, {
      soundCommand: (cmd) => sounds.push(cmd),
      fun_2591A: (_st, p) => {
        fun2591ACalled = true;
        fun2591AObjPtr = p;
      },
    });

    expect(fun2591ACalled).toBe(true);
    expect(fun2591AObjPtr).toBe(objPtr);
    expect(sounds).toEqual([OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case4_match65]);
    // +0x5A clear long
    expect(readU32BE(s.workRam, objOff + 0x5a)).toBe(0);
    // +0x1A = 4
    expect(s.workRam[objOff + 0x1a]).toBe(0x04);
    // counter incremented
    expect(readU16BE(s.workRam, objOff + 0xd2)).toBe(0x00ff);
  });

  it("case 4 con A2[+0x57] != 0x65: invoca soundCommand(0x3D)", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1300;
    const objOff = objPtr - WORK_RAM_BASE;

    s.workRam[objOff + 0x57] = 0x42;
    const sounds: number[] = [];
    objectStateEntry25BAE(s, objPtr, OBJECT_STATE_ENTRY_25BAE_CODES.state4, {
      soundCommand: (cmd) => sounds.push(cmd),
      fun_2591A: () => {
        /* no-op */
      },
    });

    expect(sounds).toEqual([OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case4_otherwise]);
  });

  it("conditional +0x18: A2[+0x1A]==6 → A2[+0x18]=3 (executed first of the dispatch)", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1400;
    const objOff = objPtr - WORK_RAM_BASE;

    s.workRam[objOff + 0x1a] = 0x06;
    s.workRam[objOff + 0x18] = 0x99;

    // but the +0x18 conditional must still run.
    objectStateEntry25BAE(s, objPtr, 0x00);

    expect(s.workRam[objOff + 0x18]).toBe(0x03);
    expect(s.workRam[objOff + 0x1a]).toBe(0x06);
    // Clears common
    expect(readU32BE(s.workRam, objOff + 0x00)).toBe(0);
    expect(readU32BE(s.workRam, objOff + 0x04)).toBe(0);
  });

  it("default (subStateCode out-of-set): solo clears + conditional, no sound, no fun_2591A", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1500;
    const objOff = objPtr - WORK_RAM_BASE;

    // Pre-fill some target bytes that should not be touched in the default path.
    s.workRam[objOff + 0x5a] = 0xaa;
    s.workRam[objOff + 0x5b] = 0xbb;
    s.workRam[objOff + 0x5c] = 0xcc;
    s.workRam[objOff + 0x5d] = 0xdd;
    s.workRam[objOff + 0x5f] = 0xee;
    s.workRam[objOff + 0x60] = 0xff;
    s.workRam[objOff + 0x56] = 0x77;

    let soundCalls = 0;
    let fun2591ACalls = 0;
    objectStateEntry25BAE(s, objPtr, 0x05, {
      soundCommand: () => soundCalls++,
      fun_2591A: () => fun2591ACalls++,
    });

    expect(soundCalls).toBe(0);
    expect(fun2591ACalls).toBe(0);
    // Solo clears common applicati
    expect(readU32BE(s.workRam, objOff + 0x00)).toBe(0);
    expect(readU32BE(s.workRam, objOff + 0x04)).toBe(0);
    expect(s.workRam[objOff + 0x5a]).toBe(0xaa);
    expect(s.workRam[objOff + 0x5b]).toBe(0xbb);
    expect(s.workRam[objOff + 0x5c]).toBe(0xcc);
    expect(s.workRam[objOff + 0x5d]).toBe(0xdd);
    expect(s.workRam[objOff + 0x5f]).toBe(0xee);
    expect(s.workRam[objOff + 0x60]).toBe(0xff);
    expect(s.workRam[objOff + 0x56]).toBe(0x77);
  });

  it("default subs={}: non solleva, scritture dirette comunque applicate", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1600;
    const objOff = objPtr - WORK_RAM_BASE;

    expect(() =>
      objectStateEntry25BAE(s, objPtr, OBJECT_STATE_ENTRY_25BAE_CODES.state2),
    ).not.toThrow();
    expect(() =>
      objectStateEntry25BAE(s, objPtr, OBJECT_STATE_ENTRY_25BAE_CODES.state9),
    ).not.toThrow();
    expect(() =>
      objectStateEntry25BAE(s, objPtr, OBJECT_STATE_ENTRY_25BAE_CODES.state4),
    ).not.toThrow();
    // Last call (state4) writes
    expect(s.workRam[objOff + 0x1a]).toBe(0x04);
  });

  it("addq.w #1 wrap a 16 bit: 0xFFFF → 0x0000", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1700;
    const objOff = objPtr - WORK_RAM_BASE;

    writeU16BE(s.workRam, objOff + 0xd2, 0xffff);
    s.workRam[objOff + 0x57] = 0x00;

    objectStateEntry25BAE(s, objPtr, OBJECT_STATE_ENTRY_25BAE_CODES.state4);

    expect(readU16BE(s.workRam, objOff + 0xd2)).toBe(0x0000);
  });

  it("non muta byte near ai fields scritti (case 2 specifico)", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1800;
    const objOff = objPtr - WORK_RAM_BASE;

    //   +0x5A..5D (long); +0x56 (byte); +0x1A (byte).
    // Free neighbors: +0x08, +0x09, +0x55, +0x57, +0x58, +0x59, +0x5E, +0x61.
    const neighbors: Record<number, number> = {
      0x08: 0xb0,
      0x09: 0xb1,
      0x55: 0xb2,
      0x57: 0xb3,
      0x58: 0xb4,
      0x59: 0xb5,
      0x5e: 0xb6,
      0x61: 0xb7,
    };
    for (const [off, v] of Object.entries(neighbors)) {
      s.workRam[objOff + Number(off)] = v;
    }
    s.workRam[objOff + 0x1a] = 0x00; // no conditional

    objectStateEntry25BAE(s, objPtr, OBJECT_STATE_ENTRY_25BAE_CODES.state2);

    for (const [off, v] of Object.entries(neighbors)) {
      expect(s.workRam[objOff + Number(off)]).toBe(v);
    }
  });

  it("costanti exposed: indirizzi binary + codici corretti", () => {
    expect(OBJECT_STATE_ENTRY_25BAE_ADDR).toBe(0x25bae);
    expect(OBJECT_STATE_ENTRY_25BAE_SUB_ADDRS.fun_158AC).toBe(0x158ac);
    expect(OBJECT_STATE_ENTRY_25BAE_SUB_ADDRS.fun_2591A).toBe(0x2591a);
    expect(OBJECT_STATE_ENTRY_25BAE_CODES.state2).toBe(0x02);
    expect(OBJECT_STATE_ENTRY_25BAE_CODES.state9).toBe(0x09);
    expect(OBJECT_STATE_ENTRY_25BAE_CODES.state4).toBe(0x04);
    expect(OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case2).toBe(0x38);
    expect(OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case4_match65).toBe(0x3c);
    expect(OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case4_otherwise).toBe(0x3d);
    expect(SPRITE_PTR_CASE2).toBe(0x20fde);
    expect(SPRITE_PTR_CASE9).toBe(0x21062);
    expect(FIELD_57_MATCH_VALUE).toBe(0x65);
  });

  it("subStateCode high bits ignorati: solo LSB selettivo (0x102 → case 2)", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1900;
    const objOff = objPtr - WORK_RAM_BASE;

    s.workRam[objOff + 0x1a] = 0x00;
    const sounds: number[] = [];
    // 0x102 & 0xFF = 0x02 → case 2
    objectStateEntry25BAE(s, objPtr, 0x102, {
      soundCommand: (cmd) => sounds.push(cmd),
    });
    expect(sounds).toEqual([OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case2]);
    expect(s.workRam[objOff + 0x1a]).toBe(0x02);
  });

  it("subs typing: ObjectStateEntry25BAESubs accetta solo soundCommand o solo fun_2591A", () => {
    const s = emptyGameState();
    const objPtr = WORK_RAM_BASE + 0x1a00;

    const subsOnlySound: ObjectStateEntry25BAESubs = {
      soundCommand: () => {
        /* no-op */
      },
    };
    const subsOnly2591A: ObjectStateEntry25BAESubs = {
      fun_2591A: () => {
        /* no-op */
      },
    };
    expect(() =>
      objectStateEntry25BAE(s, objPtr, 0x02, subsOnlySound),
    ).not.toThrow();
    expect(() =>
      objectStateEntry25BAE(s, objPtr, 0x04, subsOnly2591A),
    ).not.toThrow();
  });
});
