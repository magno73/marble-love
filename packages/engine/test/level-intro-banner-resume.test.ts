import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { bootInit } from "../src/boot-init.js";
import { emptyRomImage } from "../src/bus.js";
import { loadRomBlob } from "../src/m68k/apply-slapstic-bank.js";
import { tick } from "../src/index.js";
import { emptyGameState } from "../src/state.js";

interface PlayableSeed {
  slapsticBank?: number;
  mainLoopBodyTicks?: number;
  workRam: string;
  playfieldRam: string;
  spriteRam: string;
  alphaRam: string;
  colorRam: string;
}

const ALPHA_COLS = 64;

function hexToBytes(hex: string, expectedLength: number): Uint8Array {
  expect(hex.length).toBe(expectedLength * 2);
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function readWordBE(bytes: Uint8Array, off: number): number {
  return (((bytes[off] ?? 0) << 8) | (bytes[off + 1] ?? 0)) & 0xffff;
}

function writeWordBE(bytes: Uint8Array, off: number, value: number): void {
  const v = value & 0xffff;
  bytes[off] = (v >>> 8) & 0xff;
  bytes[off + 1] = v & 0xff;
}

function readAlphaWordBE(state: ReturnType<typeof emptyGameState>, row: number, col: number): number {
  const off = (row * ALPHA_COLS + col) * 2;
  return (((state.alphaRam[off] ?? 0) << 8) | (state.alphaRam[off + 1] ?? 0)) & 0xffff;
}

function bannerTimerWords(state: ReturnType<typeof emptyGameState>): number[] {
  const out: number[] = [];
  for (const row of [9, 10]) {
    for (const col of [29, 30, 31, 32]) {
      out.push(readAlphaWordBE(state, row, col));
    }
  }
  return out;
}

function activeDrawListEntries(state: ReturnType<typeof emptyGameState>): Array<[number, number]> {
  const entries: Array<[number, number]> = [];
  for (let i = 0; i < 0x20; i++) {
    const idx = state.workRam[0x3bc + i] ?? 0xff;
    if (idx === 0xff) break;
    const off = 0x1dc + idx * 0x0e;
    entries.push([state.workRam[off] ?? 0, state.workRam[off + 1] ?? 0]);
  }
  return entries;
}

function alphaText(state: ReturnType<typeof emptyGameState>): string {
  let text = "";
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < ALPHA_COLS; col++) {
      const off = (row * ALPHA_COLS + col) * 2;
      const tile = state.alphaRam[off + 1] ?? 0;
      text += tile >= 0x20 && tile <= 0x7e ? String.fromCharCode(tile) : " ";
    }
    text += " ";
  }
  return text.replace(/\s+/g, " ").toUpperCase();
}

function hasIntroBanner(state: ReturnType<typeof emptyGameState>): boolean {
  const text = alphaText(state);
  return (
    (text.includes("TIME TO FINISH") || text.includes("EXTRA TIME FOR")) &&
    (
      text.includes("PRACTICE RACE") ||
      text.includes("BEGINNER RACE") ||
      text.includes("INTERMEDIATE RACE") ||
      text.includes("AERIAL RACE") ||
      text.includes("SILLY RACE") ||
      text.includes("ULTIMATE RACE")
    )
  );
}

function loadSeed(name: string): PlayableSeed {
  return JSON.parse(
    readFileSync(resolve(`packages/web/public/scenarios/playable/${name}.seed.json`), "utf-8"),
  ) as PlayableSeed;
}

function bootSeed(name: string): { state: ReturnType<typeof emptyGameState>; rom: ReturnType<typeof emptyRomImage> } {
  const seed = loadSeed(name);
  const rom = emptyRomImage();
  loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

  const state = emptyGameState();
  bootInit(state, rom, {
    warmState: {
      workRam: hexToBytes(seed.workRam, 0x2000),
      playfieldRam: hexToBytes(seed.playfieldRam, 0x2000),
      spriteRam: hexToBytes(seed.spriteRam, 0x1000),
      alphaRam: hexToBytes(seed.alphaRam, 0x1000),
      colorRam: hexToBytes(seed.colorRam, 0x800),
      slapsticBank: seed.slapsticBank ?? 1,
    },
  });
  state.clock.mainLoopBodyTicks = (seed.mainLoopBodyTicks ?? 1) >>> 0;
  return { state, rom };
}

describe("level intro banner warm-state resume", () => {
  it.each([
    ["start_level1_intro_practice_f2479", 121, 60],
    ["start_level2_intro_beginner_f2436", 121, 60],
    ["start_level3_intro_intermediate_f2435", 96, 86],
    ["start_level4_intro_aerial_f2414", 91, 81],
    ["start_level5_intro_silly_f2472", 81, 70],
    ["start_level6_intro_ultimate_f2429", 81, 71],
  ])("%s advances the proven MAME intro timer and clears the banner", (seedName, clearTick, targetTimer) => {
    const { state, rom } = bootSeed(seedName);
    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    expect(hasIntroBanner(state)).toBe(true);
    for (let i = 1; i < clearTick; i++) {
      tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    }

    expect(hasIntroBanner(state)).toBe(true);
    tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });

    expect(readWordBE(state.workRam, 0x82)).toBe(targetTimer);
    expect(state.workRam[0x86]).toBe(5);
    expect(hasIntroBanner(state)).toBe(false);
  });

  it("hands off to the normal cascading player timer after the banner clear", () => {
    const { state, rom } = bootSeed("start_level1_intro_practice_f2479");
    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    for (let i = 0; i < 121; i++) {
      tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    }
    expect(state.workRam[0x86]).toBe(5);

    tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    expect(state.workRam[0x86]).toBe(4);
  });

  it("updates the visible center banner countdown while the internal timer counts up", () => {
    const { state, rom } = bootSeed("start_level1_intro_practice_f2479");
    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    expect(readWordBE(state.workRam, 0x82)).toBe(0);
    expect(bannerTimerWords(state)).toEqual([0x3518, 0x3519, 0x3500, 0x3501, 0x351a, 0x351b, 0x3502, 0x3503]);

    tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    expect(readWordBE(state.workRam, 0x82)).toBe(5);
    expect(bannerTimerWords(state)).toEqual([0x3514, 0x3515, 0x3514, 0x3515, 0x3516, 0x3517, 0x3516, 0x3517]);

    for (let i = 0; i < 10; i++) {
      tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    }
    expect(readWordBE(state.workRam, 0x82)).toBe(10);
    expect(bannerTimerWords(state)).toEqual([0x3514, 0x3515, 0x3500, 0x3501, 0x3516, 0x3517, 0x3502, 0x3503]);
  });

  it("counts down only the extra time when a later level starts with carryover seconds", () => {
    const { state, rom } = bootSeed("start_level3_intro_intermediate_f2435");
    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    expect(readWordBE(state.workRam, 0x82)).toBe(51);

    tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });

    expect(readWordBE(state.workRam, 0x82)).toBe(56);
    expect(bannerTimerWords(state)).toEqual([0x3508, 0x3509, 0x3500, 0x3501, 0x350a, 0x350b, 0x3502, 0x3503]);
  });

  it("arms the level-transition intro so L2 reloads time from a zero carryover", () => {
    const { state, rom } = bootSeed("start_level1_intro_practice_f2479");
    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    for (let i = 0; i < 121; i++) {
      tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    }
    expect(readWordBE(state.workRam, 0x394)).toBe(0);
    expect(readWordBE(state.workRam, 0x82)).toBe(60);

    writeWordBE(state.workRam, 0x82, 0);
    writeWordBE(state.workRam, 0x390, 3);
    state.clock.mainLoopBodyTicks = 1 as typeof state.clock.mainLoopBodyTicks;

    tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });

    expect(readWordBE(state.workRam, 0x394)).toBe(1);
    expect(readWordBE(state.workRam, 0x390)).toBe(0);
    expect(readWordBE(state.workRam, 0x82)).toBe(5);
    expect(state.workRam[0x86]).toBe(0xff);
    expect(state.clock.levelIntroBannerResumeTick).toBe(1);

    for (let i = 1; i < 121; i++) {
      tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    }

    expect(readWordBE(state.workRam, 0x82)).toBe(60);
    expect(state.workRam[0x86]).toBe(5);
    expect(state.clock.levelIntroBannerResumeTick).toBeUndefined();
  });

  it("preserves carryover seconds and adds the L2 intro bonus during level transition", () => {
    const { state, rom } = bootSeed("start_level1_intro_practice_f2479");
    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    for (let i = 0; i < 121; i++) {
      tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    }

    writeWordBE(state.workRam, 0x82, 31);
    writeWordBE(state.workRam, 0x390, 3);
    state.clock.mainLoopBodyTicks = 1 as typeof state.clock.mainLoopBodyTicks;

    tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });

    expect(readWordBE(state.workRam, 0x394)).toBe(1);
    expect(readWordBE(state.workRam, 0x82)).toBe(36);
    expect(state.workRam[0x86]).toBe(0xff);

    for (let i = 1; i < 121; i++) {
      tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    }

    expect(readWordBE(state.workRam, 0x82)).toBe(91);
    expect(state.workRam[0x86]).toBe(5);
  });

  it("preserves carryover seconds and adds the L3 intro bonus during level transition", () => {
    const { state, rom } = bootSeed("start_level2_intro_beginner_f2436");
    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    for (let i = 0; i < 121; i++) {
      tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    }

    writeWordBE(state.workRam, 0x82, 42);
    writeWordBE(state.workRam, 0x390, 3);
    state.clock.mainLoopBodyTicks = 1 as typeof state.clock.mainLoopBodyTicks;

    tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });

    expect(readWordBE(state.workRam, 0x394)).toBe(2);
    expect(readWordBE(state.workRam, 0x82)).toBe(47);
    expect(state.workRam[0x86]).toBe(0xff);

    for (let i = 1; i < 96; i++) {
      tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    }

    expect(readWordBE(state.workRam, 0x82)).toBe(77);
    expect(state.workRam[0x86]).toBe(5);
  });

  it("rebuilds the L2 black enemy draw-list entry during a runtime L1 to L2 transition", () => {
    const { state, rom } = bootSeed("start_level1_intro_practice_f2479");
    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    for (let i = 0; i < 121; i++) {
      tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });
    }

    writeWordBE(state.workRam, 0x82, 31);
    state.workRam[0x18 + 0x18] = 3;
    writeWordBE(state.workRam, 0x390, 3);
    state.clock.mainLoopBodyTicks = 1 as typeof state.clock.mainLoopBodyTicks;

    tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });

    expect(readWordBE(state.workRam, 0x394)).toBe(1);
    expect(activeDrawListEntries(state)).toContainEqual([0x02, 0x01]);
    expect(activeDrawListEntries(state)).toContainEqual([0x01, 0x00]);
    expect(activeDrawListEntries(state)).not.toContainEqual([0x01, 0x02]);
  });

  it("does not arm from a similar level-start shape after the warm boot window", () => {
    const { state, rom } = bootSeed("start_level1_intro_practice_f2479");
    const p1X = state.workRam[0x18 + 0xc9] ?? 0xff;
    const p1Y = state.workRam[0x18 + 0xc8] ?? 0xff;

    state.clock.frame = 2 as typeof state.clock.frame;
    tick(state, { rom, runMainLoopBody: true, inputMmio: 0x6f, p1X, p1Y, p2X: 0xff, p2Y: 0xff });

    expect(readWordBE(state.workRam, 0x82)).toBe(0);
    expect(state.clock.levelIntroBannerResumeTick).toBeUndefined();
    expect(hasIntroBanner(state)).toBe(true);
  });
});
