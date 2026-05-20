/**
 * Smoke tests for Task A main-loop init chain modules.
 */

import { describe, expect, it } from "vitest";
import { bootInit } from "../src/boot-init.js";
import { emptyRomImage } from "../src/bus.js";
import { mainLoopInit10504 } from "../src/main-loop-init-10504.js";
import { mainLoopInit1101E } from "../src/main-loop-init-1101e.js";
import { mainLoopInit11452 } from "../src/main-loop-init-11452.js";
import { mainLoopInit117B2, mainLoop117B2LoopBody } from "../src/main-loop-init-117b2.js";
import { mainTick } from "../src/main-tick.js";
import { advanceMode0Init11452Async } from "../src/mode2-init-11452-async.js";
import { emptyGameState } from "../src/state.js";

function w(s: ReturnType<typeof emptyGameState>, off: number): number {
  return ((s.workRam[off] << 8) | s.workRam[off + 1]) & 0xffff;
}

function setW(s: ReturnType<typeof emptyGameState>, off: number, value: number): void {
  s.workRam[off] = (value >>> 8) & 0xff;
  s.workRam[off + 1] = value & 0xff;
}

function setL(s: ReturnType<typeof emptyGameState>, off: number, value: number): void {
  s.workRam[off] = (value >>> 24) & 0xff;
  s.workRam[off + 1] = (value >>> 16) & 0xff;
  s.workRam[off + 2] = (value >>> 8) & 0xff;
  s.workRam[off + 3] = value & 0xff;
}

function writeRomDefaultHighScore(
  rom: ReturnType<typeof emptyRomImage>,
  row: number,
  score: number,
  initials: string,
): void {
  const off = 0x1eea0 + row * 8;
  rom.program[off] = (score >>> 24) & 0xff;
  rom.program[off + 1] = (score >>> 16) & 0xff;
  rom.program[off + 2] = (score >>> 8) & 0xff;
  rom.program[off + 3] = score & 0xff;
  rom.program[off + 4] = initials.charCodeAt(0) & 0xff;
  rom.program[off + 5] = initials.charCodeAt(1) & 0xff;
  rom.program[off + 6] = initials.charCodeAt(2) & 0xff;
  rom.program[off + 7] = 0;
}

function writeMarbleDefaultHighScores(rom: ReturnType<typeof emptyRomImage>): void {
  const defaults: ReadonlyArray<readonly [number, string]> = [
    [0x0038a4, "C R"],
    [0x0036b0, "UFO"],
    [0x0034bc, "GJL"],
    [0x0032c8, "SKP"],
    [0x0030d4, "PCT"],
    [0x002ee0, "PTR"],
    [0x002cec, "JDH"],
    [0x002af8, "DAT"],
    [0x002904, "JFS"],
    [0x002710, "DAR"],
  ];
  defaults.forEach(([score, initials], row) => writeRomDefaultHighScore(rom, row, score, initials));
}

function highScoreRowHex(s: ReturnType<typeof emptyGameState>, row: number): string {
  const off = (0x00401e74 - 0x00400000) + 0x1e + row * 5;
  return Buffer.from(s.workRam.slice(off, off + 5)).toString("hex");
}

describe("Task A main-loop init modules", () => {
  it("FUN_117B2 bootstrap writes globals then invokes 11452 and loop body", () => {
    const s = emptyGameState();
    const calls: string[] = [];
    mainLoopInit117B2(s, undefined, {
      bootHelper1464A: () => calls.push("1464A"),
      init11452: () => calls.push("11452"),
      init1101E: () => calls.push("1101E"),
      randomMod13A98: () => {
        calls.push("13A98");
        return 0x5a;
      },
      lateLogic26F3E: () => calls.push("26F3E"),
      vblankAck: () => calls.push("28DEA"),
    });

    expect(s.workRam[0x3f4]).toBe(0);
    expect(s.workRam[0x3f2]).toBe(0);
    expect(w(s, 0x390)).toBe(1);
    expect(w(s, 0x394)).toBe(1);
    expect(w(s, 0x392)).toBe(0);
    expect(s.workRam[0x444]).toBe(0);
    expect(calls).toEqual(["1464A", "11452", "1101E", "13A98", "26F3E", "28DEA", "28DEA"]);
  });

  it("FUN_117B2 loop body mirrors watchdog counters", () => {
    const s = emptyGameState();
    s.workRam[0x3b2] = 1;
    setW(s, 0x3b8, 1);
    const calls: string[] = [];

    mainLoop117B2LoopBody(s, undefined, {
      init1101E: () => calls.push("1101E"),
      softReset100E0: () => calls.push("100E0"),
      vblankAck: () => calls.push("28DEA"),
    });

    expect(s.workRam[0x3b2]).toBe(0);
    expect(s.workRam[0x3b4]).toBe(1);
    expect(w(s, 0x3b8)).toBe(0);
    expect(calls).toEqual(["1101E", "100E0", "28DEA", "28DEA"]);
  });

  it("FUN_11452 state 0 toggles game mode and optionally chains 10504", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x1d368] = 0x12;
    rom.program[0x1d369] = 0x34;
    rom.program[0x1d36a] = 0x56;
    rom.program[0x1d36b] = 0x78;
    setW(s, 0x390, 1);
    setW(s, 0x392, 0);
    setW(s, 0x394, 0);
    const calls: string[] = [];

    mainLoopInit11452(s, rom, {
      memClear019C: () => calls.push("019C"),
      soundCmd: (_st, cmd) => calls.push(`158AC:${cmd}`),
      sceneInit11428: () => calls.push("11428"),
      gameModePrep10456: () => calls.push("10456"),
      helper16EC6: () => calls.push("16EC6"),
      init10504: () => calls.push("10504"),
      finalize11654: () => calls.push("11654"),
    });

    expect(w(s, 0x394)).toBe(1);
    expect(w(s, 0x396)).toBe(1);
    expect([...s.workRam.slice(0x446, 0x44a)]).toEqual([0x12, 0x34, 0x56, 0x78]);
    expect(calls).toEqual(["019C", "158AC:1", "11428", "10456", "16EC6", "10504", "11654"]);
  });

  it("FUN_11452 state 2 default wires FUN_18CD2 particle sprite entries", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setW(s, 0x392, 2);
    s.workRam.fill(0xff, 0x3bc, 0x3dc);

    mainLoopInit11452(s, rom, {
      sceneInit11428: () => undefined,
      gameStateBanner26B2A: () => undefined,
      helper26B66: () => undefined,
      vblankAck: () => undefined,
      helper11FF8: () => undefined,
      tilemapBlit17044: () => undefined,
      finalize11654: () => undefined,
    });

    expect(s.workRam[0x3e2]).toBe(3);
    expect([...s.workRam.slice(0x3bc, 0x3c0)]).toEqual([0, 1, 2, 0xff]);
    expect([...s.workRam.slice(0x1dc, 0x1dc + 2)]).toEqual([0x2c, 0]);
    expect([...s.workRam.slice(0x1dc + 0x0e, 0x1dc + 0x10)]).toEqual([0x2c, 1]);
    expect([...s.workRam.slice(0x1dc + 0x1c, 0x1dc + 0x1e)]).toEqual([0x2c, 2]);
  });

  it("FUN_11452 state 0 overflow initializes the mode 3 attract summary", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const calls: string[] = [];
    setW(s, 0x390, 1);
    setW(s, 0x392, 0);
    s.workRam[0x3e4] = 7;

    mainLoopInit11452(s, rom, {
      soundCmd: (_st, cmd) => calls.push(`158AC:${cmd}`),
      sceneInit11428: () => calls.push("11428"),
      gameStateBanner26B2A: (_st, mode) => calls.push(`26B2A:${mode}`),
      renderString0142: (_st, ptr, tile) => calls.push(`0142:${ptr.toString(16)}:${tile.toString(16)}`),
      finalize11654: () => calls.push("11654"),
    });

    expect(w(s, 0x392)).toBe(3);
    expect(s.workRam[0x3e4]).toBe(0);
    expect(w(s, 0x75a)).toBe(0x00c8);
    expect(calls).toEqual([
      "158AC:1",
      "11428",
      "26B2A:0",
      "0142:22d26:3000",
      "0142:22d32:3400",
      "11654",
    ]);
  });

  it("staged FUN_11452 state 0 overflow also arms the mode 3 timer", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    setW(s, 0x390, 1);
    setW(s, 0x392, 0);
    s.workRam[0x3e4] = 7;
    s.clock.mode0Init11452Stage = 5;

    advanceMode0Init11452Async(s, rom);

    expect(w(s, 0x392)).toBe(3);
    expect(s.workRam[0x3e4]).toBe(0);
    expect(w(s, 0x75a)).toBe(0x00c8);
    expect(s.clock.mode0Init11452Stage).toBeUndefined();
  });

  it("FUN_1101E state 3 performs level increment init path", () => {
    const s = emptyGameState();
    setW(s, 0x390, 3);
    setW(s, 0x394, 4);
    const calls: string[] = [];

    mainLoopInit1101E(s, undefined, {
      soundPair15884: () => calls.push("15884"),
      helper118D2: () => calls.push("118D2"),
      vblankAck: () => calls.push("28DEA"),
      clearPaletteRam: () => calls.push("121A6"),
      clearOther12186: () => calls.push("12186"),
      initFnPointers28580: () => calls.push("28580"),
      clearAlphaTiles28C7E: () => calls.push("28C7E"),
      sceneObjInit28CA6: () => calls.push("28CA6"),
      init10504: () => calls.push("10504"),
    });

    expect(w(s, 0x394)).toBe(5);
    expect(w(s, 0x390)).toBe(0);
    expect(s.workRam[0x39a]).toBe(1);
    expect(calls).toEqual(["15884", "118D2", "28DEA", "121A6", "12186", "28580", "28C7E", "28CA6", "10504"]);
  });

  it("FUN_1101E state 5 arms the new-game level intro before the live timer runs", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const calls: string[] = [];
    setW(s, 0x390, 5);
    setW(s, 0x396, 1);
    rom.program[0x1f1c8] = 0;

    mainLoopInit1101E(s, rom, {
      sceneInit11428: () => calls.push("11428"),
      soundCmd: (_st, cmd) => calls.push(`158AC:${cmd}`),
      gameModePrep10456: () => calls.push("10456"),
      helper16EC6: () => calls.push("16EC6"),
      init10504: (st) => {
        calls.push("10504");
        setW(st, 0x00, 0xff10);
        setW(st, 0x02, 0xff10);
        st.videoScrollX = 0x10;
        st.videoScrollY = 0x110;
        st.workRam[0x18 + 0x18] = 1;
        setW(st, 0x18 + 0x6a, 0);
        st.workRam[0x18 + 0x6c] = 9;
        st.workRam[0x18 + 0x6d] = 0;
        st.workRam[0x18 + 0x6e] = 5;
      },
    });

    expect(w(s, 0x390)).toBe(0);
    expect(w(s, 0x394)).toBe(0);
    expect(w(s, 0x00)).toBe(0);
    expect(w(s, 0x02)).toBe(0);
    expect(s.videoScrollX).toBe(0);
    expect(s.videoScrollY).toBe(0);
    expect(w(s, 0x18 + 0x6a)).toBe(0);
    expect(s.workRam[0x18 + 0x6e]).toBe(0xff);
    expect(s.clock.levelIntroBannerResumeTick).toBe(0);
    expect(s.clock.levelIntroBannerBaseTimer).toBe(0);
    expect(calls).toEqual(["158AC:2", "158AC:0", "11428", "158AC:98", "10456", "16EC6", "10504"]);
  });

  it("FUN_1101E state 2 starts staged mode2 reset after a non-qualifying cold-boot score", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeMarbleDefaultHighScores(rom);
    bootInit(s, rom);
    setW(s, 0x390, 2);
    setW(s, 0x394, 1);
    setW(s, 0x396, 1);
    setL(s, 0x18 + 0xbc, 140);
    s.workRam[0x18 + 0x18] = 2;
    s.playfieldRam.fill(0xaa);

    mainLoopInit1101E(s, rom, {
      sceneInit11428: () => undefined,
      gameStateBanner26B2A: () => undefined,
      helper288F8: () => undefined,
    });

    expect(w(s, 0x390)).toBe(1);
    expect(w(s, 0x392)).toBe(2);
    expect(w(s, 0x75a)).toBe(0x0096);
    expect(s.clock.mode2Init11452Stage).toBe(0);
  });

  it("FUN_1101E state 2 starts interactive high-score initials entry before reset", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeMarbleDefaultHighScores(rom);
    bootInit(s, rom);
    setW(s, 0x390, 2);
    setW(s, 0x394, 4);
    setW(s, 0x396, 1);
    setL(s, 0x18 + 0xbc, 0x004000);
    s.workRam[0x18 + 0xc0] = 0x41;
    s.workRam[0x18 + 0xc1] = 0x41;
    s.workRam[0x18 + 0xc2] = 0x41;
    s.workRam[0x18 + 0x18] = 2;
    s.playfieldRam.fill(0xaa);
    s.workRam.fill(0, 0x1f7a, 0x1f81);

    mainLoopInit1101E(s, rom, {
      sceneInit11428: () => undefined,
      gameStateBanner26B2A: () => undefined,
      helper288F8: () => undefined,
    });

    expect(w(s, 0x390)).toBe(1);
    expect(w(s, 0x392)).toBe(2);
    expect(w(s, 0x75a)).toBe(0x0096);
    expect(s.clock.mode2Init11452Stage).toBeUndefined();
    expect(s.clock.highScoreInitialsEntry).toMatchObject({
      objectAddr: 0x00400018,
      rank: 0,
      recordAddr: 0x00400018 + 0xbc,
      cursor: 0,
    });
    expect(s.playfieldRam.every((value) => value === 0)).toBe(true);
    expect(highScoreRowHex(s, 0)).toBe("0038a412d2");
    expect(Buffer.from(s.workRam.slice(0x1f7a, 0x1f81)).toString("hex")).not.toBe("00000000000000");
  });

  it("mainTick accepts interactive high-score initials and resumes mode2 reset", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeMarbleDefaultHighScores(rom);
    bootInit(s, rom);
    setW(s, 0x390, 2);
    setW(s, 0x394, 4);
    setW(s, 0x396, 1);
    setL(s, 0x18 + 0xbc, 0x004000);
    s.workRam[0x18 + 0xc0] = 0x41;
    s.workRam[0x18 + 0xc1] = 0x41;
    s.workRam[0x18 + 0xc2] = 0x41;
    s.workRam[0x18 + 0x18] = 2;

    mainLoopInit1101E(s, rom, {
      sceneInit11428: () => undefined,
      gameStateBanner26B2A: () => undefined,
      helper288F8: () => undefined,
    });
    expect(s.clock.highScoreInitialsEntry).not.toBeUndefined();

    s.input.buttons = 0x01 as typeof s.input.buttons;
    mainTick(s, {
      rom,
      inputMmio: 0x6e,
      p1X: 0xff,
      p1Y: 0xff,
      runMainLoopBody: true,
      skipFrameCounter: true,
    });

    expect(s.clock.highScoreInitialsEntry).toBeUndefined();
    expect(highScoreRowHex(s, 0)).toBe("0040000669");
    expect(s.clock.mode2Init11452Stage).not.toBeUndefined();
  });

  it("FUN_10504 deterministic init block and tail writes key globals", () => {
    const s = emptyGameState();
    setW(s, 0x394, 3);
    setW(s, 0x396, 2);
    s.workRam[0x18 + 0x18] = 1;
    const calls: string[] = [];

    mainLoopInit10504(s, {
      clearPaletteRam: () => calls.push("121A6"),
      hudFrameInit: () => calls.push("283C2"),
      slotArrayBulkInit: () => calls.push("10392"),
      randomMod: () => 0xab,
      soundCmd: (_st, cmd) => calls.push(`158AC:${cmd}`),
      vblankAck: () => calls.push("28DEA"),
    });

    expect(s.workRam[0x75c]).toBe(0);
    expect(s.workRam[0x75e]).toBe(1);
    expect(s.workRam[0x3f0]).toBe(1);
    expect(s.workRam[0x3e0]).toBe(1);
    expect(s.workRam[0x3a4]).toBe(0xff);
    expect(s.workRam[0x76c]).toBe(1);
    expect(s.workRam[0x444]).toBe(0xab);
    expect(calls.slice(0, 3)).toEqual(["121A6", "283C2", "10392"]);
    expect(calls).toContain("158AC:3");
  });
});
