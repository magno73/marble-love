/**
 * Test objectScanDispatch251DE (FUN_000251DE) — smoke tests on the orchestrator
 *
 * count = `*0x400396`), for each obj: skip if +0x18==0 (D2++), gate
 * +0x6A.w > 400 -> FUN_2822E, run FUN_253EC, then group state==2 (D2++)
 * / state==3 (D3++) / respawn-block (other state + count==2 + X/0x36 filters/
 * 0x1A). Post-loop: if D3==count or D2==count-1 (with D3!=0), set
 * `*0x400390.w = 3` (if != 1).
 *
 * `cli/src/test-object-scan-dispatch-251de-parity.ts` (500/500 cases).
 */

import { describe, it, expect } from "vitest";
import {
  objectScanDispatch251DE,
  OBJECT_SCAN_DISPATCH_251DE_ADDR,
  OBJECT_SCAN_DISPATCH_251DE_SUB_ADDRS,
  GLOBAL_OBJ_BASE_ADDR,
  GLOBAL_OBJ_COUNT_ADDR,
  GLOBAL_GS_FLAG_ADDR,
  OBJ_STRIDE,
  type ObjectScanDispatch251DESubs,
} from "../src/object-scan-dispatch-251de.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";

const WORK_RAM_BASE = 0x00400000;

const STUB_ROM = emptyRomImage();

function writeU16BE(wr: Uint8Array, off: number, v: number): void {
  wr[off + 0] = (v >>> 8) & 0xff;
  wr[off + 1] = v & 0xff;
}

function readU16BE(wr: Uint8Array, off: number): number {
  return (((wr[off] ?? 0) << 8) | (wr[off + 1] ?? 0)) & 0xffff;
}

describe("objectScanDispatch251DE (FUN_000251DE)", () => {
  it("empty loop (count=0): calls only FUN_1BBAA; the post-loop check fires (D3==count==0) → sets global=3", () => {
    const s = emptyGameState();
    const calls: string[] = [];

    // count = 0 @ 0x400396
    writeU16BE(s.workRam, 0x396, 0);
    // overwritten). Note: with count=0, D3==count==0 -> setFlag true.
    writeU16BE(s.workRam, 0x390, 0xaaaa);

    const subs: ObjectScanDispatch251DESubs = {
      fun_1BBAA: () => calls.push("1BBAA"),
      fun_253EC: () => calls.push("253EC"),
      soundCommand: (_st, cmd) => calls.push(`snd:${cmd.toString(16)}`),
    };

    objectScanDispatch251DE(s, STUB_ROM, subs);

    expect(calls).toEqual(["1BBAA"]);
    // Post-loop: D3=0 == count=0 → setFlag → *0x400390 = 3 (pre was ≠ 1).
    expect(readU16BE(s.workRam, 0x390)).toBe(3);
  });

  it("count=2, both state=3 → sets global *0x400390 = 3", () => {
    const s = emptyGameState();

    // Setup: count=2, level=0 (irrelevant), state machine pre-flag = 0
    writeU16BE(s.workRam, 0x396, 2);
    writeU16BE(s.workRam, 0x394, 0);
    writeU16BE(s.workRam, 0x390, 0);

    // pre-state).
    const obj0 = GLOBAL_OBJ_BASE_ADDR - WORK_RAM_BASE; // 0x18
    const obj1 = obj0 + OBJ_STRIDE; // 0xFA
    s.workRam[obj0 + 0x18] = 3;
    s.workRam[obj1 + 0x18] = 3;

    objectScanDispatch251DE(s, STUB_ROM);

    // *0x400390 = 3
    expect(readU16BE(s.workRam, 0x390)).toBe(3);
  });

  it("count=2, 1 state=3 + 1 state=2 (D2 == count-1=1, D3=1) → sets global=3", () => {
    const s = emptyGameState();
    writeU16BE(s.workRam, 0x396, 2);
    writeU16BE(s.workRam, 0x394, 0);
    writeU16BE(s.workRam, 0x390, 0);

    const obj0 = GLOBAL_OBJ_BASE_ADDR - WORK_RAM_BASE;
    const obj1 = obj0 + OBJ_STRIDE;
    s.workRam[obj0 + 0x18] = 3; // state-3 → D3=1
    s.workRam[obj1 + 0x18] = 2; // state-2 → D2=1

    objectScanDispatch251DE(s, STUB_ROM);

    // count-1=1 == D2=1, D3=1 != 0 → setFlag = true
    expect(readU16BE(s.workRam, 0x390)).toBe(3);
  });

  it("count=2, *0x400390 == 1 (game already in state 1): does NOT overwrite", () => {
    const s = emptyGameState();
    writeU16BE(s.workRam, 0x396, 2);
    writeU16BE(s.workRam, 0x390, 1);

    const obj0 = GLOBAL_OBJ_BASE_ADDR - WORK_RAM_BASE;
    const obj1 = obj0 + OBJ_STRIDE;
    s.workRam[obj0 + 0x18] = 3;
    s.workRam[obj1 + 0x18] = 3;

    objectScanDispatch251DE(s, STUB_ROM);

    // Pre = 1 → beq epilogue → stays 1
    expect(readU16BE(s.workRam, 0x390)).toBe(1);
  });

  it("respawn block: calls 5 subs in the correct order + writes 12 obj fields", () => {
    const s = emptyGameState();
    const calls: Array<{ name: string; args: readonly number[] }> = [];

    // count=2, level=0, X=0xF0 (>0xEC) → respawn (level != 4)
    writeU16BE(s.workRam, 0x396, 2);
    writeU16BE(s.workRam, 0x394, 0);

    const obj0 = GLOBAL_OBJ_BASE_ADDR - WORK_RAM_BASE;
    const obj1 = obj0 + OBJ_STRIDE;

    s.workRam[obj0 + 0x18] = 1;
    // X (+0x20) = 0x00F0 (= 240, signed > 0xEC)
    writeU16BE(s.workRam, obj0 + 0x20, 0x00f0);
    // 0x36 = 0 (!= 2)
    s.workRam[obj0 + 0x36] = 0;
    // 0x1A = 0 (in {0,1,5})
    s.workRam[obj0 + 0x1a] = 0;
    // 0x6A = 100 (≤ 0x190, no FUN_2822E)
    writeU16BE(s.workRam, obj0 + 0x6a, 100);
    // 0xD2 word pre = 0x0010 (to check the increment)
    writeU16BE(s.workRam, obj0 + 0xd2, 0x0010);

    // Obj1: state=3 (skipped in filter, just D3++)
    s.workRam[obj1 + 0x18] = 3;

    // Globals 0x400462, 0x400466 (long), 0x400472 (byte) for obj writes.
    s.workRam[0x462] = 0xaa;
    s.workRam[0x463] = 0xbb;
    s.workRam[0x464] = 0xcc;
    s.workRam[0x465] = 0xdd;
    s.workRam[0x466] = 0x11;
    s.workRam[0x467] = 0x22;
    s.workRam[0x468] = 0x33;
    s.workRam[0x469] = 0x44;
    s.workRam[0x472] = 0x77;

    const subs: ObjectScanDispatch251DESubs = {
      fun_1BBAA: () => calls.push({ name: "1BBAA", args: [] }),
      fun_253EC: (_, p) => calls.push({ name: "253EC", args: [p] }),
      fun_17934: (_, p) => calls.push({ name: "17934", args: [p] }),
      fun_1BAB2: (_, p) => calls.push({ name: "1BAB2", args: [p] }),
      fun_1CC62: (_, z) => {
        calls.push({ name: "1CC62", args: [z] });
        return 0xdeadbeef;
      },
      fun_1B9CC: (_, p, f) =>
        calls.push({ name: "1B9CC", args: [p, f] }),
      soundCommand: (_, cmd) =>
        calls.push({ name: "snd", args: [cmd] }),
      fun_285B0: (_, p, m) =>
        calls.push({ name: "285B0", args: [p, m] }),
    };

    objectScanDispatch251DE(s, STUB_ROM, subs);

    // Pre-loop: 1BBAA. Iter0 (obj0): 253EC, 17934, 1BAB2, 1CC62, 1B9CC, snd, 285B0.
    // Iter1 (obj1, state=3): 253EC.
    expect(calls.map((c) => c.name)).toEqual([
      "1BBAA",
      "253EC", // obj0
      "17934",
      "1BAB2",
      "1CC62",
      "1B9CC",
      "snd",
      "285B0",
      "253EC", // obj1
    ]);

    // sound cmd = 0x3C
    const snd = calls.find((c) => c.name === "snd")!;
    expect(snd.args).toEqual([0x3c]);
    // 285B0 args: (objPtr, 0x0F)
    const _285b0 = calls.find((c) => c.name === "285B0")!;
    expect(_285b0.args).toEqual([WORK_RAM_BASE + obj0, 0x0000000f]);

    // Key writes in the respawn block:
    // A2[+0xC] = (0xAABBCCDD << 16) >>> 0 = 0xCCDD0000
    expect(
      (((s.workRam[obj0 + 0x0c] ?? 0) << 24) |
        ((s.workRam[obj0 + 0x0d] ?? 0) << 16) |
        ((s.workRam[obj0 + 0x0e] ?? 0) << 8) |
        (s.workRam[obj0 + 0x0f] ?? 0)) >>>
        0,
    ).toBe(0xccdd0000 >>> 0);

    // A2[+0x14] = FUN_1CC62 ret = 0xDEADBEEF
    expect(
      (((s.workRam[obj0 + 0x14] ?? 0) << 24) |
        ((s.workRam[obj0 + 0x15] ?? 0) << 16) |
        ((s.workRam[obj0 + 0x16] ?? 0) << 8) |
        (s.workRam[obj0 + 0x17] ?? 0)) >>>
        0,
    ).toBe(0xdeadbeef);

    // A2[+0x1B] = (*0x400472).b = 0x77
    expect(s.workRam[obj0 + 0x1b]).toBe(0x77);

    // A2[+0x1A] = 4 (post respawn override)
    expect(s.workRam[obj0 + 0x1a]).toBe(0x04);

    // A2[+0x57] = 0x65 (post respawn override)
    expect(s.workRam[obj0 + 0x57]).toBe(0x65);

    // A2[+0xD2] += 1 → 0x0010 + 1 = 0x0011
    expect(readU16BE(s.workRam, obj0 + 0xd2)).toBe(0x0011);

    expect(readU16BE(s.workRam, 0x696)).toBe(0xffff);
    expect(readU16BE(s.workRam, 0x698)).toBe(0xffff);
  });

  it("gate FUN_2822E: called iff obj+0x6A.w > 400 (signed)", () => {
    const s = emptyGameState();
    let count2822E = 0;

    writeU16BE(s.workRam, 0x396, 3);
    writeU16BE(s.workRam, 0x394, 0);

    const o0 = GLOBAL_OBJ_BASE_ADDR - WORK_RAM_BASE;
    const o1 = o0 + OBJ_STRIDE;
    const o2 = o1 + OBJ_STRIDE;

    // o0: state=1, 0x6A = 100 (no gate)
    s.workRam[o0 + 0x18] = 1;
    writeU16BE(s.workRam, o0 + 0x6a, 100);
    // o1: state=1, 0x6A = 0x190 = 400 (boundary: ble — NO gate)
    s.workRam[o1 + 0x18] = 1;
    writeU16BE(s.workRam, o1 + 0x6a, 0x190);
    // o2: state=1, 0x6A = 0x191 = 401 (gate triggers)
    s.workRam[o2 + 0x18] = 1;
    writeU16BE(s.workRam, o2 + 0x6a, 0x191);

    objectScanDispatch251DE(s, STUB_ROM, {
      fun_2822E: () => count2822E++,
    });

    expect(count2822E).toBe(1);
  });

  it("count != 2 does NOT trigger respawn block (even with state 1)", () => {
    const s = emptyGameState();
    let respawnHits = 0;

    writeU16BE(s.workRam, 0x396, 1); // count=1 ≠ 2
    writeU16BE(s.workRam, 0x394, 0);

    const o0 = GLOBAL_OBJ_BASE_ADDR - WORK_RAM_BASE;
    s.workRam[o0 + 0x18] = 1;
    writeU16BE(s.workRam, o0 + 0x20, 0x00f0); // X=0xF0 > 0xEC

    objectScanDispatch251DE(s, STUB_ROM, {
      fun_17934: () => respawnHits++,
    });

    expect(respawnHits).toBe(0);
  });

  it("exposed constants: correct binary addresses", () => {
    expect(OBJECT_SCAN_DISPATCH_251DE_ADDR).toBe(0x251de);
    expect(OBJECT_SCAN_DISPATCH_251DE_SUB_ADDRS).toEqual([
      0x1bbaa, 0x2822e, 0x253ec, 0x17934, 0x1bab2, 0x1cc62, 0x1b9cc, 0x158ac,
      0x285b0,
    ]);
    expect(OBJECT_SCAN_DISPATCH_251DE_SUB_ADDRS).toHaveLength(9);
    expect(GLOBAL_OBJ_BASE_ADDR).toBe(0x400018);
    expect(GLOBAL_OBJ_COUNT_ADDR).toBe(0x400396);
    expect(GLOBAL_GS_FLAG_ADDR).toBe(0x400390);
    expect(OBJ_STRIDE).toBe(0xe2);
  });

  it("default subs={}: does not throw, performs only the standalone writes (count=0)", () => {
    const s = emptyGameState();
    writeU16BE(s.workRam, 0x396, 0);
    expect(() => objectScanDispatch251DE(s, STUB_ROM)).not.toThrow();
    expect(() => objectScanDispatch251DE(s, STUB_ROM, {})).not.toThrow();
  });
});
