/**
 * sound-cmd-send.test.ts — corner cases of soundCmdSend (FUN_158AC).
 *
 */

import { describe, it, expect } from "vitest";
import { soundCmdSend } from "../src/sound-cmd-send.js";
import { emptyGameState } from "../src/state.js";

describe("soundCmdSend (FUN_158AC)", () => {
  it("skip flag (workRam[0x3B8..9] word != 0) → returns 0", () => {
    const s = emptyGameState();
    s.workRam[0x3b8] = 0x01;
    s.workRam[0x3b9] = 0x2c;
    const r = soundCmdSend(s, 0x42);
    expect(r).toBe(0);
  });

  it("skip flag = 0, chip ready → returns 1", () => {
    const s = emptyGameState();
    // workRam[0x3B8..9] = 0 (default emptyGameState)
    const r = soundCmdSend(s, 0x42);
    expect(r).toBe(1);
  });

  it("skip flag with ONLY low byte != 0 → still 0 (tst.w word)", () => {
    const s = emptyGameState();
    s.workRam[0x3b8] = 0x00;
    s.workRam[0x3b9] = 0x01; // word = 0x0001
    const r = soundCmdSend(s, 0x42);
    expect(r).toBe(0);
  });

  it("skip flag with ONLY high byte != 0 → returns 0", () => {
    const s = emptyGameState();
    s.workRam[0x3b8] = 0x80;
    s.workRam[0x3b9] = 0x00; // word = 0x8000
    const r = soundCmdSend(s, 0x42);
    expect(r).toBe(0);
  });

  it("chipPending=true (chip never ready) → returns 0 even with skip=0", () => {
    const s = emptyGameState();
    const r = soundCmdSend(s, 0x42, true);
    expect(r).toBe(0);
  });

  it("byteArg does not influence the return value (it is only the data sent)", () => {
    const s = emptyGameState();
    expect(soundCmdSend(s, 0x00)).toBe(1);
    expect(soundCmdSend(s, 0x7f)).toBe(1);
    expect(soundCmdSend(s, 0x80)).toBe(1); // negative if sign-extended
    expect(soundCmdSend(s, 0xff)).toBe(1);
  });

  it("no side effect on workRam (neither in skip path nor in send path)", () => {
    const s = emptyGameState();
    s.workRam[0x3b8] = 0x12;
    s.workRam[0x3b9] = 0x34;
    const before = new Uint8Array(s.workRam);
    soundCmdSend(s, 0xab);
    expect(s.workRam).toEqual(before);

    const s2 = emptyGameState();
    const before2 = new Uint8Array(s2.workRam);
    soundCmdSend(s2, 0xab);
    expect(s2.workRam).toEqual(before2);
  });

  it("default chipPending=false: chip ready", () => {
    const s = emptyGameState();
    expect(soundCmdSend(s, 0x10)).toBe(1);
  });
});
