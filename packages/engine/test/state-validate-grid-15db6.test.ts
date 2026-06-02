/**
 * state-validate-grid-15db6.test.ts — smoke for FUN_15DB6.
 *
 * Bit-perfect verified against the binary through
 * `cli/src/test-state-validate-grid-15db6-parity.ts` (500/500).
 */

import { describe, it, expect } from "vitest";
import {
  stateValidateGrid15DB6,
  FIELD_X_OFF,
  FIELD_Y_OFF,
  KIND_BYTE_OFF,
  CURRENT_PTR_OFF,
  KIND_FROM,
  KIND_TO,
  ASR_COUNT,
} from "../src/state-validate-grid-15db6.js";
import type { StateValidateGrid15DB6Subs } from "../src/state-validate-grid-15db6.js";
import { emptyGameState } from "../src/state.js";

const WORK_RAM_BASE = 0x00400000;

function writeLong(s: { workRam: Uint8Array }, abs: number, v: number): void {
  const off = (abs - WORK_RAM_BASE) >>> 0;
  const u = v >>> 0;
  s.workRam[off] = (u >>> 24) & 0xff;
  s.workRam[off + 1] = (u >>> 16) & 0xff;
  s.workRam[off + 2] = (u >>> 8) & 0xff;
  s.workRam[off + 3] = u & 0xff;
}

function asrL(v: number, c: number): number {
  return ((v | 0) >> (c & 0x3f)) | 0;
}

describe("stateValidateGrid15DB6 (FUN_15DB6)", () => {
  it("match (X+Y cells coincide) → fun_15e24(ptr, 1); original kind 0x10 unchanged", () => {
    const s = emptyGameState();
    const structPtr = 0x00400500;
    const currentPtr = 0x00401000;
    const so = structPtr - WORK_RAM_BASE;

    // field_x = byte_target * (1 << 19) → asr.l 19 = byte_target (long signed)
    const targetX = 5;
    const targetY = 7;
    writeLong(s, structPtr + FIELD_X_OFF, (targetX << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + FIELD_Y_OFF, (targetY << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + CURRENT_PTR_OFF, currentPtr);
    s.workRam[(currentPtr - WORK_RAM_BASE) + 0] = targetX;
    s.workRam[(currentPtr - WORK_RAM_BASE) + 1] = targetY;
    s.workRam[so + KIND_BYTE_OFF] = 0x10;

    const calls: { fn: string; args: number[] }[] = [];
    const subs: StateValidateGrid15DB6Subs = {
      fun_15d10: (p) => calls.push({ fn: "15d10", args: [p] }),
      fun_15e24: (p, f) => calls.push({ fn: "15e24", args: [p, f] }),
    };

    stateValidateGrid15DB6(s, structPtr, subs);

    expect(calls).toEqual([{ fn: "15e24", args: [structPtr, 1] }]);
    expect(s.workRam[so + KIND_BYTE_OFF]).toBe(0x10); // unchanged
  });

  it("match with original kind 0x23 → mutates kind to 0x20 + fun_15e24(ptr, 1)", () => {
    const s = emptyGameState();
    const structPtr = 0x00400600;
    const currentPtr = 0x00401100;
    const so = structPtr - WORK_RAM_BASE;

    writeLong(s, structPtr + FIELD_X_OFF, (3 << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + FIELD_Y_OFF, (4 << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + CURRENT_PTR_OFF, currentPtr);
    s.workRam[(currentPtr - WORK_RAM_BASE) + 0] = 3;
    s.workRam[(currentPtr - WORK_RAM_BASE) + 1] = 4;
    s.workRam[so + KIND_BYTE_OFF] = KIND_FROM; // 0x23

    const seq: string[] = [];
    let f15e24Args: { p: number; f: number } | null = null;
    let f15d10Calls = 0;
    stateValidateGrid15DB6(s, structPtr, {
      fun_15d10: () => {
        f15d10Calls++;
        seq.push("15d10");
      },
      fun_15e24: (p, f) => {
        seq.push("15e24");
        f15e24Args = { p, f };
      },
    });

    expect(seq).toEqual(["15e24"]);
    expect(f15e24Args).not.toBeNull();
    expect(f15e24Args!.p).toBe(structPtr);
    expect(f15e24Args!.f).toBe(1);
    expect(f15d10Calls).toBe(0);
    expect(s.workRam[so + KIND_BYTE_OFF]).toBe(KIND_TO); // 0x20
  });

  it("mismatch X + kind != 0x23 → fun_15e24(ptr, 0); fun_15d10 NOT called", () => {
    const s = emptyGameState();
    const structPtr = 0x00400700;
    const currentPtr = 0x00401200;
    const so = structPtr - WORK_RAM_BASE;

    writeLong(s, structPtr + FIELD_X_OFF, (10 << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + FIELD_Y_OFF, (20 << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + CURRENT_PTR_OFF, currentPtr);
    s.workRam[(currentPtr - WORK_RAM_BASE) + 0] = 99; // mismatch (99 != 10)
    s.workRam[(currentPtr - WORK_RAM_BASE) + 1] = 20;
    s.workRam[so + KIND_BYTE_OFF] = 0x05;

    const calls: { fn: string; args: number[] }[] = [];
    stateValidateGrid15DB6(s, structPtr, {
      fun_15d10: (p) => calls.push({ fn: "15d10", args: [p] }),
      fun_15e24: (p, f) => calls.push({ fn: "15e24", args: [p, f] }),
    });

    expect(calls).toEqual([{ fn: "15e24", args: [structPtr, 0] }]);
    expect(s.workRam[so + KIND_BYTE_OFF]).toBe(0x05); // unchanged
  });

  it("mismatch + kind 0x23 → fun_15d10(ptr); kind unchanged (no mutation)", () => {
    const s = emptyGameState();
    const structPtr = 0x00400800;
    const currentPtr = 0x00401300;
    const so = structPtr - WORK_RAM_BASE;

    writeLong(s, structPtr + FIELD_X_OFF, (1 << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + FIELD_Y_OFF, (2 << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + CURRENT_PTR_OFF, currentPtr);
    s.workRam[(currentPtr - WORK_RAM_BASE) + 0] = 0; // mismatch
    s.workRam[(currentPtr - WORK_RAM_BASE) + 1] = 0;
    s.workRam[so + KIND_BYTE_OFF] = KIND_FROM; // 0x23

    const calls: { fn: string; args: number[] }[] = [];
    stateValidateGrid15DB6(s, structPtr, {
      fun_15d10: (p) => calls.push({ fn: "15d10", args: [p] }),
      fun_15e24: (p, f) => calls.push({ fn: "15e24", args: [p, f] }),
    });

    expect(calls).toEqual([{ fn: "15d10", args: [structPtr] }]);
    expect(s.workRam[so + KIND_BYTE_OFF]).toBe(KIND_FROM); // 0x23 unchanged
  });

  it("match X but mismatch Y → global mismatch → fun_15e24(ptr, 0)", () => {
    const s = emptyGameState();
    const structPtr = 0x00400900;
    const currentPtr = 0x00401400;
    const so = structPtr - WORK_RAM_BASE;

    writeLong(s, structPtr + FIELD_X_OFF, (5 << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + FIELD_Y_OFF, (6 << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + CURRENT_PTR_OFF, currentPtr);
    s.workRam[(currentPtr - WORK_RAM_BASE) + 0] = 5; // match
    s.workRam[(currentPtr - WORK_RAM_BASE) + 1] = 99; // mismatch
    s.workRam[so + KIND_BYTE_OFF] = 0x42;

    const calls: { fn: string; args: number[] }[] = [];
    stateValidateGrid15DB6(s, structPtr, {
      fun_15d10: (p) => calls.push({ fn: "15d10", args: [p] }),
      fun_15e24: (p, f) => calls.push({ fn: "15e24", args: [p, f] }),
    });

    expect(calls).toEqual([{ fn: "15e24", args: [structPtr, 0] }]);
  });

  it("match with negative field_x (signed asr) and signed byte", () => {
    const s = emptyGameState();
    const structPtr = 0x00400a00;
    const currentPtr = 0x00401500;
    const so = structPtr - WORK_RAM_BASE;

    // field_x = -3 << 19 (signed); asr.l 19 = -3 long -> byte sign-ext must be -3 (0xFD).
    const fx = (-3 << ASR_COUNT) | 0;
    const fy = (-1 << ASR_COUNT) | 0;
    writeLong(s, structPtr + FIELD_X_OFF, fx >>> 0);
    writeLong(s, structPtr + FIELD_Y_OFF, fy >>> 0);
    writeLong(s, structPtr + CURRENT_PTR_OFF, currentPtr);
    // currentPtr[0] = 0xFD (signExt_l = -3); currentPtr[1] = 0xFF (signExt_l = -1)
    s.workRam[(currentPtr - WORK_RAM_BASE) + 0] = 0xfd;
    s.workRam[(currentPtr - WORK_RAM_BASE) + 1] = 0xff;
    s.workRam[so + KIND_BYTE_OFF] = 0x00;

    let f15e24Args: { p: number; f: number } | null = null;
    stateValidateGrid15DB6(s, structPtr, {
      fun_15e24: (p, f) => {
        f15e24Args = { p, f };
      },
    });

    expect(f15e24Args).not.toBeNull();
    expect(f15e24Args!.p).toBe(structPtr);
    expect(f15e24Args!.f).toBe(1);

    // Sanity check: our asr values match.
    expect(asrL(fx, ASR_COUNT)).toBe(-3);
    expect(asrL(fy, ASR_COUNT)).toBe(-1);
  });

  it("subs undefined → non-throw", () => {
    const s = emptyGameState();
    const structPtr = 0x00400b00;
    const currentPtr = 0x00401600;

    writeLong(s, structPtr + CURRENT_PTR_OFF, currentPtr);
    s.workRam[(structPtr - WORK_RAM_BASE) + KIND_BYTE_OFF] = KIND_FROM;
    expect(() => stateValidateGrid15DB6(s, structPtr)).not.toThrow();
  });

  it("byte signed-ext: cmp.l fails with high-bit byte vs positive asr.l (parametric)", () => {
    // currentPtr[0] = 0x80 → signExt_l = -128; asr.l(field_x, 19) = +128
    // (= 0x80 << 19) → cmp.l(-128, 128) ≠ → mismatch
    const s = emptyGameState();
    const structPtr = 0x00400c00;
    const currentPtr = 0x00401700;

    writeLong(s, structPtr + FIELD_X_OFF, (128 << ASR_COUNT) >>> 0);
    writeLong(s, structPtr + FIELD_Y_OFF, 0);
    writeLong(s, structPtr + CURRENT_PTR_OFF, currentPtr);
    s.workRam[(currentPtr - WORK_RAM_BASE) + 0] = 0x80; // signExt = -128
    s.workRam[(currentPtr - WORK_RAM_BASE) + 1] = 0x00;
    s.workRam[(structPtr - WORK_RAM_BASE) + KIND_BYTE_OFF] = 0x07;

    const calls: { fn: string; args: number[] }[] = [];
    stateValidateGrid15DB6(s, structPtr, {
      fun_15d10: () => calls.push({ fn: "15d10", args: [] }),
      fun_15e24: (p, f) => calls.push({ fn: "15e24", args: [p, f] }),
    });

    // Expectation: mismatch (cmp.l(-128, +128) fails) → fun_15e24(ptr, 0)
    expect(calls).toEqual([{ fn: "15e24", args: [structPtr, 0] }]);
  });
});
