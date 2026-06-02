/**
 * sound-cmd-send-158ac.test.ts — unit test of soundCmdSend158AC (FUN_158AC).
 *
 * Parity bit-perfect verificata separatamente in
 * `packages/cli/src/test-sound-cmd-send-158ac-parity.ts` (500 cases vs musashi).
 */

import { describe, it, expect } from "vitest";
import {
  soundCmdSend158AC,
  SOUND_CMD_SEND_158AC_ADDR,
} from "../src/sound-cmd-send-158ac.js";
import { emptyGameState } from "../src/state.js";

describe("soundCmdSend158AC (FUN_158AC)", () => {
  it("address constant is correct", () => {
    expect(SOUND_CMD_SEND_158AC_ADDR).toBe(0x000158ac);
  });

  it("skip flag (workRam[0x3B8..9] word != 0) → returns 0", () => {
    const s = emptyGameState();
    s.workRam[0x3b8] = 0x01;
    s.workRam[0x3b9] = 0x2c; // word = 0x012C
    expect(soundCmdSend158AC(s, 0x42)).toBe(0);
  });

  it("skip flag = 0, chip ready → returns 1", () => {
    const s = emptyGameState();
    // workRam[0x3B8..9] = 0 (default emptyGameState)
    expect(soundCmdSend158AC(s, 0x42)).toBe(1);
  });

  it("tst.w reads full word: low byte only != 0 → skip (returns 0)", () => {
    const s = emptyGameState();
    s.workRam[0x3b8] = 0x00;
    s.workRam[0x3b9] = 0x01; // word = 0x0001
    expect(soundCmdSend158AC(s, 0x42)).toBe(0);
  });

  it("tst.w reads full word: high byte only != 0 → skip (returns 0)", () => {
    const s = emptyGameState();
    s.workRam[0x3b8] = 0x80;
    s.workRam[0x3b9] = 0x00; // word = 0x8000
    expect(soundCmdSend158AC(s, 0x42)).toBe(0);
  });

  it("chipPending=true → returns 0 even when skip=0", () => {
    const s = emptyGameState();
    expect(soundCmdSend158AC(s, 0x42, true)).toBe(0);
  });

  it("cmd byte value does not affect return (only affects payload to chip)", () => {
    const s = emptyGameState();
    expect(soundCmdSend158AC(s, 0x00)).toBe(1);
    expect(soundCmdSend158AC(s, 0x7f)).toBe(1);
    expect(soundCmdSend158AC(s, 0x80)).toBe(1); // would be negative if sign-extended
    expect(soundCmdSend158AC(s, 0xff)).toBe(1);
  });

  it("no side effects on workRam (skip path)", () => {
    const s = emptyGameState();
    s.workRam[0x3b8] = 0x12;
    s.workRam[0x3b9] = 0x34;
    const before = new Uint8Array(s.workRam);
    soundCmdSend158AC(s, 0xab);
    expect(s.workRam).toEqual(before);
  });

  it("no side effects on workRam (send path)", () => {
    const s = emptyGameState();
    const before = new Uint8Array(s.workRam);
    soundCmdSend158AC(s, 0xab);
    expect(s.workRam).toEqual(before);
  });

  it("default chipPending=false: chip ready → returns 1", () => {
    const s = emptyGameState();
    expect(soundCmdSend158AC(s, 0x10)).toBe(1);
  });

  it("both skip bytes set → returns 0", () => {
    const s = emptyGameState();
    s.workRam[0x3b8] = 0xff;
    s.workRam[0x3b9] = 0xff; // word = 0xFFFF
    expect(soundCmdSend158AC(s, 0x00)).toBe(0);
  });
});
