/**
 * state-sub-15670.test.ts — smoke tests per `stateSub15670` (FUN_15670).
 *
 * `cli/src/test-state-sub-15670-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  stateSub15670,
  OBJ_ARRAY_BASE,
  OBJ_STRIDE,
  OBJ_COUNT_ADDR,
  SLOT_ARRAY_BASE,
  SLOT_STRIDE,
  SLOT_COUNT,
} from "../src/state-sub-15670.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x00400000;

function writeU16BE(s: Uint8Array, off: number, v: number): void {
  s[off] = (v >>> 8) & 0xff;
  s[off + 1] = v & 0xff;
}

function writeS32BE(s: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  s[off] = (u >>> 24) & 0xff;
  s[off + 1] = (u >>> 16) & 0xff;
  s[off + 2] = (u >>> 8) & 0xff;
  s[off + 3] = u & 0xff;
}

function readU16BE(s: Uint8Array, off: number): number {
  return ((s[off] ?? 0) << 8) | (s[off + 1] ?? 0);
}

describe("stateSub15670 (FUN_15670)", () => {
  it("count == 0 → epilog senza side effect", () => {
    const s = emptyGameState();
    // Arg struct in workRam (e.g. @ 0x401500). count word @ 0x400396 = 0.
    writeU16BE(s.workRam, 0x396, 0);
    const argAbs = 0x00401500;
    // Pre-write per detectare side effect su (0x56,A2)
    writeU16BE(s.workRam, 0x1500 + 0x56, 0xabcd);
    s.workRam[0x1500 + 0x1a] = 0x42;

    const calls15460: number[] = [];
    stateSub15670(s, argAbs, {
      fun_15460: (p) => calls15460.push(p),
    });

    // count == 0 → D2.b = byte @ 0x397 = 0; signExt(0).w = 0; cmp.w 0,0 → equal
    expect(readU16BE(s.workRam, 0x1500 + 0x56)).toBe(0xabcd);
    expect(s.workRam[0x1500 + 0x1a]).toBe(0x42);
    expect(calls15460).toHaveLength(0);

    expect(OBJ_ARRAY_BASE).toBe(0x00400018);
    expect(OBJ_STRIDE).toBe(0xe2);
    expect(OBJ_COUNT_ADDR).toBe(0x00400396);
    expect(SLOT_ARRAY_BASE).toBe(0x00401302);
    expect(SLOT_STRIDE).toBe(0x60);
    expect(SLOT_COUNT).toBe(4);
  });

  it("no candidato qualificato → solo epilog (D2 invariato == count.w)", () => {
    const s = emptyGameState();
    writeU16BE(s.workRam, 0x396, 1);
    // Obj 0 @ 0x400018: state byte = 0 (default, not 1) → skip.
    const objOff0 = 0x18;
    s.workRam[objOff0 + 0x18] = 0; // not 1 → skip filter
    // Pos x/y irrilevanti.
    const argAbs = 0x00401500;
    writeU16BE(s.workRam, 0x1500 + 0x56, 0x1234);
    s.workRam[0x1500 + 0x1a] = 0x99;

    const calls15460: number[] = [];
    stateSub15670(s, argAbs, {
      fun_15460: (p) => calls15460.push(p),
    });
    // D2.b = byte @ 0x397 = 1 (LSB of word 0x0001). signExt(1).w = 1. cmp.w
    expect(readU16BE(s.workRam, 0x1500 + 0x56)).toBe(0x1234);
    expect(s.workRam[0x1500 + 0x1a]).toBe(0x99);
    expect(calls15460).toHaveLength(0);
  });

  it("1 candidato valido, distanza outside range → writes solo (0x56,A2)", () => {
    const s = emptyGameState();
    // count = 1
    writeU16BE(s.workRam, 0x396, 1);
    // Obj 0 @ 0x400018: state=1, kind=0, zorder=0xAA, field36=0,
    //   x = 0x10000, y = 0x10000 (sum = 0x20000 > 0xC000 ✓), flag19 = 0.
    const o0 = 0x18;
    writeS32BE(s.workRam, o0 + 0x00, 0x10000); // x
    writeS32BE(s.workRam, o0 + 0x04, 0x10000); // y
    s.workRam[o0 + 0x18] = 1;
    s.workRam[o0 + 0x19] = 0;
    s.workRam[o0 + 0x1a] = 0;
    s.workRam[o0 + 0x1b] = 0xaa;
    s.workRam[o0 + 0x36] = 0;

    // (default zero, OK)

    // Arg struct @ 0x00401500: zorder = 0xAA (match), x/y = 0 → distanza grande.
    const argOff = 0x1500;
    s.workRam[argOff + 0x1b] = 0xaa;
    writeS32BE(s.workRam, argOff + 0x0c, 0x00000000); // arg.x
    writeS32BE(s.workRam, argOff + 0x10, 0x00000000); // arg.y
    s.workRam[argOff + 0x1a] = 0x77; // pre-write (must restare 0x77)
    writeU16BE(s.workRam, argOff + 0x56, 0xdead); // pre

    const calls15460: number[] = [];
    stateSub15670(s, 0x00400000 + argOff, {
      fun_15460: (p) => calls15460.push(p),
    });

    // D2: start byte @ 0x397 = 1 (LSB of count word 0x0001).
    // 1 candidate passes filters -> D2.b -= 1 = 0. signExt(0).w = 0 != count.w.
    // = signExt(0).w = 0
    expect(readU16BE(s.workRam, argOff + 0x56)).toBe(0x0000);

    // Distance: a1 = obj0 @ 0x400018. argX=0, a1X = (0xC, 0x400018)
    //   = long @ 0x400024. Default 0. dx = 0 - 0 = 0.
    //   a1Y at 0x400028 = 0. dy = 0. dist = 0 < 0x180+1 → no trigger.
    expect(s.workRam[argOff + 0x1a]).toBe(0x77); // not mutated
    expect(calls15460).toHaveLength(0);
  });

  it("trigger: 1 candidato and distanza in range (0x180,0x280) → mutate kind + jsr fun_15460", () => {
    const s = emptyGameState();
    writeU16BE(s.workRam, 0x396, 1);
    const o0 = 0x18;
    // Obj0: state=1, kind=0, zorder=0xAA, field36=0
    s.workRam[o0 + 0x18] = 1;
    s.workRam[o0 + 0x19] = 0;
    s.workRam[o0 + 0x1a] = 0;
    s.workRam[o0 + 0x1b] = 0xaa;
    s.workRam[o0 + 0x36] = 0;
    // Sum |x|+|y| > 0xC000: x = 0x100000, y = 0x100000
    writeS32BE(s.workRam, o0 + 0x00, 0x00100000);
    writeS32BE(s.workRam, o0 + 0x04, 0x00100000);
    // Field 0xC and 0x10 of the obj (a1.x, a1.y per la distanza): obj+0xC, obj+0x10
    // (0xC,A1) and (0x10,A1) per la distanza (NOT are x/y "abs" filter, are
    //  separated). Diff with arg.0xC and arg.0x10. Set to 0x200 << 12 = 0x200000.
    writeS32BE(s.workRam, o0 + 0x0c, 0x00200000);
    writeS32BE(s.workRam, o0 + 0x10, 0x00000000); // dy = 0

    // dx=0x200, dy=0. d3W=0x200, d4W=0. d3 > d4: minor=0, major=0x200.
    // dist = (0 >> 3) * 3 + 0x200 = 0x200. 0x180 < 0x200 < 0x280 ✓

    const argOff = 0x1500;
    s.workRam[argOff + 0x1b] = 0xaa;
    writeS32BE(s.workRam, argOff + 0x0c, 0);
    writeS32BE(s.workRam, argOff + 0x10, 0);
    s.workRam[argOff + 0x1a] = 0x77;

    const calls15460: number[] = [];
    stateSub15670(s, 0x00400000 + argOff, {
      fun_15460: (p) => calls15460.push(p),
    });

    expect(readU16BE(s.workRam, argOff + 0x56)).toBe(0); // d2 = obj.flag19 = 0
    expect(s.workRam[argOff + 0x1a]).toBe(1); // mutate to TRIGGERED_KIND
    expect(calls15460).toEqual([0x00400000 + argOff]);
  });

  it("inner-loop collision: candidato is scartato se 1 marble-slot match", () => {
    const s = emptyGameState();
    writeU16BE(s.workRam, 0x396, 1);
    const o0 = 0x18;
    s.workRam[o0 + 0x18] = 1;
    s.workRam[o0 + 0x19] = 7; // signExt(7).w = 0x0007
    s.workRam[o0 + 0x1a] = 1;
    s.workRam[o0 + 0x1b] = 0;
    s.workRam[o0 + 0x36] = 0;
    writeS32BE(s.workRam, o0 + 0x00, 0x100000);
    writeS32BE(s.workRam, o0 + 0x04, 0x100000);

    // Slot 0 @ 0x401302: state=1, kind=1, field56.w = 7 → MATCH → collision
    const slot0 = 0x1302;
    s.workRam[slot0 + 0x18] = 1;
    s.workRam[slot0 + 0x1a] = 1;
    writeU16BE(s.workRam, slot0 + 0x56, 7);

    const argOff = 0x1500;
    s.workRam[argOff + 0x1b] = 0;
    s.workRam[argOff + 0x1a] = 0x42;
    writeU16BE(s.workRam, argOff + 0x56, 0x9999);

    const calls15460: number[] = [];
    stateSub15670(s, 0x00400000 + argOff, {
      fun_15460: (p) => calls15460.push(p),
    });
    expect(readU16BE(s.workRam, argOff + 0x56)).toBe(0x9999);
    expect(s.workRam[argOff + 0x1a]).toBe(0x42);
    expect(calls15460).toHaveLength(0);
  });

  it("(0x56,A2).w receives signExt(obj.flag19), non il D2 decrementato", () => {
    const s = emptyGameState();
    writeU16BE(s.workRam, 0x396, 1);
    const o0 = 0x18;
    s.workRam[o0 + 0x18] = 1;
    s.workRam[o0 + 0x19] = 0xfe; // signExt(0xFE).w = 0xFFFE
    s.workRam[o0 + 0x1a] = 0;
    s.workRam[o0 + 0x1b] = 0;
    s.workRam[o0 + 0x36] = 0;
    writeS32BE(s.workRam, o0 + 0x00, 0x100000);
    writeS32BE(s.workRam, o0 + 0x04, 0x100000);
    writeS32BE(s.workRam, o0 + 0x0c, 0);
    writeS32BE(s.workRam, o0 + 0x10, 0);

    const argOff = 0x1500;
    s.workRam[argOff + 0x1b] = 0;
    writeS32BE(s.workRam, argOff + 0x0c, 0);
    writeS32BE(s.workRam, argOff + 0x10, 0);

    stateSub15670(s, 0x00400000 + argOff);
    // signExt(0xFE) = 0xFFFE
    expect(readU16BE(s.workRam, argOff + 0x56)).toBe(0xfffe);
  });

  it("count == 2 and D2 == 0 → calls fun_15fe6 per scegliere between 2 oggetti", () => {
    const s = emptyGameState();
    writeU16BE(s.workRam, 0x396, 2); // count = 2
    for (let i = 0; i < 2; i++) {
      const oi = 0x18 + i * OBJ_STRIDE;
      s.workRam[oi + 0x18] = 1;
      s.workRam[oi + 0x19] = 0;
      s.workRam[oi + 0x1a] = 0;
      s.workRam[oi + 0x1b] = 0;
      s.workRam[oi + 0x36] = 0;
      writeS32BE(s.workRam, oi + 0x00, 0x100000);
      writeS32BE(s.workRam, oi + 0x04, 0x100000);
      writeS32BE(s.workRam, oi + 0x0c, 0); // pos at 0 → dist 0
      writeS32BE(s.workRam, oi + 0x10, 0);
    }
    const argOff = 0x1500;
    s.workRam[argOff + 0x1b] = 0;
    writeS32BE(s.workRam, argOff + 0x0c, 0);
    writeS32BE(s.workRam, argOff + 0x10, 0);

    const calls15fe6: Array<[number, number]> = [];
    stateSub15670(s, 0x00400000 + argOff, {
      fun_15fe6: (a, b) => {
        calls15fe6.push([a, b]);
        return 0; // ret==0 → A1 = obj0 (= a)
      },
    });
    expect(calls15fe6).toEqual([[0x00400018, 0x00400018 + OBJ_STRIDE]]);
  });
});
