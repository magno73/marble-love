/**
 * sound-cmd-gate.test.ts — corner cases of soundCmdGate (FUN_4420).
 *
 * Bit-perfect parity verified vs binary in `test-sound-cmd-gate-parity.ts`.
 */

import { describe, it, expect } from "vitest";
import { soundCmdGate, CLAMP_THRESHOLD } from "../src/sound-cmd-gate.js";

describe("soundCmdGate (FUN_4420)", () => {
  it("cmdIndex < 0x0B → data forced to 0 before the dispatch", () => {
    const seen: Array<{ idx: number; data: number }> = [];
    const inner = (idx: number, data: number): number => {
      seen.push({ idx, data });
      return 0xdeadbeef;
    };
    const out = soundCmdGate(0x05, 0x12345678, inner);
    expect(out).toBe(0xdeadbeef);
    expect(seen).toEqual([{ idx: 0x05, data: 0x00000000 }]);
  });

  it("cmdIndex == 0x0B → data preserved (boundary, no clear)", () => {
    const seen: Array<{ idx: number; data: number }> = [];
    const inner = (idx: number, data: number): number => {
      seen.push({ idx, data });
      return 1;
    };
    const out = soundCmdGate(0x0b, 0xcafebabe, inner);
    expect(out).toBe(1);
    expect(seen).toEqual([{ idx: 0x0b, data: 0xcafebabe }]);
  });

  it("cmdIndex == 0x0A → data clamped (lower boundary)", () => {
    const seen: Array<{ idx: number; data: number }> = [];
    const inner = (idx: number, data: number): number => {
      seen.push({ idx, data });
      return 0;
    };
    soundCmdGate(0x0a, 0xffffffff, inner);
    expect(seen).toEqual([{ idx: 0x0a, data: 0 }]);
  });

  it("cmdIndex == 0 → data clamped (minimal case)", () => {
    let receivedData = -1;
    const inner = (_idx: number, data: number): number => {
      receivedData = data;
      return 0;
    };
    soundCmdGate(0, 0xabcd_1234, inner);
    expect(receivedData).toBe(0);
  });

  it("cmdIndex very large (0xFFFFFFFF) → no clamp (unsigned compare)", () => {
    let receivedData = -1;
    const inner = (_idx: number, data: number): number => {
      receivedData = data;
      return 0;
    };
    soundCmdGate(0xffffffff, 0x1234_5678, inner);
    // 0xFFFFFFFF >= 0x0B unsigned → no clear
    expect(receivedData).toBe(0x1234_5678);
  });

  it("default inner = () => 0: returns 0 without side effects", () => {
    expect(soundCmdGate(0x0c, 0x42)).toBe(0);
    expect(soundCmdGate(0x05, 0x42)).toBe(0);
  });

  it("D0 pass-through: returns EXACTLY the inner's return", () => {
    const inner = (): number => 0x12345678;
    expect(soundCmdGate(0x10, 0x99, inner)).toBe(0x12345678);
  });

  it("inner receives cmdIndex as unsigned long (negative input normalized)", () => {
    let receivedIdx = -1;
    const inner = (idx: number, _data: number): number => {
      receivedIdx = idx;
      return 0;
    };
    // -1 (signed) → 0xFFFFFFFF (unsigned). >= 0x0B → no clear.
    soundCmdGate(-1, 0x77, inner);
    expect(receivedIdx).toBe(0xffffffff);
  });

  it("CLAMP_THRESHOLD exposed constant = 0x0B", () => {
    expect(CLAMP_THRESHOLD).toBe(0x0b);
  });
});
