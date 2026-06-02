/**
 * main-tick.test.ts — smoke test dell'orchestrator.
 *
 *  2. Incrementi `state.clock.frame` (counter canonico interno)
 *
 * **Nota**: workRam[0x14] e workRam[0x16] NON sono frame counter monotonic.
 * mailbox @ 0x16, sound-timer mirror @ 0x14). Vedi commit B6: il preambolo
 *
 */

import { afterEach, describe, it, expect } from "vitest";

import { ROM_AVAILABLE } from "./_rom-fixture.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mainTick } from "../src/main-tick.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import { loadRomBlob } from "../src/m68k/apply-slapstic-bank.js";
import { setGlobalSoundCmdHook } from "../src/sound-hook.js";

afterEach(() => {
  setGlobalSoundCmdHook(undefined);
});

function readU16BE(buf: Uint8Array, off: number): number {
  return ((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0);
}

function writeU16BE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

function nonzero(bytes: Uint8Array): number {
  let total = 0;
  for (const b of bytes) if (b !== 0) total++;
  return total;
}

function loadProgramRom(): ReturnType<typeof emptyRomImage> {
  const rom = emptyRomImage();
  loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));
  return rom;
}

describe("mainTick smoke", () => {
  it("non solleva eccezioni con state e ROM vuoti", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => mainTick(s, { rom })).not.toThrow();
  });

  it("incrementa state.clock.frame (counter canonico interno)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const start = s.clock.frame;
    mainTick(s, { rom });
    expect(s.clock.frame).toBe(start + 1);
    mainTick(s, { rom });
    expect(s.clock.frame).toBe(start + 2);
  });

  it("skipFrameCounter: non incrementa state.clock.frame", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const start = s.clock.frame;
    mainTick(s, { rom, skipFrameCounter: true });
    expect(s.clock.frame).toBe(start);
  });

  it("flag 0x39A set → esegue prefix scroll sync (latcha y, clear flag)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    s.workRam[0x39a] = 1;
    s.workRam[0x00] = 0xab; // y target high
    s.workRam[0x01] = 0xcd; // y target low
    mainTick(s, { rom });
    expect(s.workRam[0x39a]).toBe(0); // flag cleared
    expect(s.workRam[0x02]).toBe(0xab); // latched
    expect(s.workRam[0x03]).toBe(0xcd);
  });

  it("100 tick consecutivi senza eccezioni", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    for (let i = 0; i < 100; i++) {
      expect(() => mainTick(s, { rom })).not.toThrow();
    }
    // state.clock.frame ha registrato i 100 tick
    expect(s.clock.frame).toBe(100);
  });

  it("wires IRQ special-attract sound commands to the global sound hook", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const calls: number[] = [];
    setGlobalSoundCmdHook((cmd) => calls.push(cmd));

    // FUN_28788 (0x28866..0x288ca) gates FUN_288F8 behind: 0x3EA != -1,
    // eepromCommit() > (0x3EA), and 0x390 == 1. Empty-state eepromCommit() = 0,
    // so set 0x3EA negative (≠ -1) and 0x390 = 1 to let the gate reach
    // special-attract, which emits 0x61 for the 0..0xB progress band. (Without
    // this gating the prior port emitted 0x61 every frame — the level-5 music
    // flood; an empty state now correctly stays silent.)
    writeU16BE(s.workRam, 0x3ea, 0xfffe); // -2
    writeU16BE(s.workRam, 0x390, 1);

    mainTick(s, { rom });

    expect(calls).toContain(0x61);
  });

  it.skipIf(!ROM_AVAILABLE)("wires main-loop init music commands during live gameplay body ticks", () => {
    const s = emptyGameState();
    const rom = loadProgramRom();
    const calls: number[] = [];
    setGlobalSoundCmdHook((cmd) => calls.push(cmd));
    writeU16BE(s.workRam, 0x390, 5);
    s.clock.mainLoopBodyTicks = 1 as typeof s.clock.mainLoopBodyTicks;

    mainTick(s, { rom, runMainLoopBody: true });

    expect(calls).toContain(0x02);
    expect(calls).toContain(0x00);
    expect(calls).toContain(0x63);
  });

  it("inputMmio default 0xFC → gameMainGate skip Block C (no spin)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => mainTick(s, { rom, inputMmio: 0xfc })).not.toThrow();
  });

  it("trackball deltas si propagano a gameTickTimers + trackball state", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    mainTick(s, { rom });
    const stableState = Array.from(s.workRam.slice(0x1c00, 0x1c20));
    expect(() => mainTick(s, { rom, p1X: 8, p1Y: -4 })).not.toThrow();
    expect(s.clock.frame).toBe(2);
    void stableState;
  });

  it("defers live PF scroll update in playable segment 4", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    s.workRam[0x08] = 1;
    s.workRam[0x0a] = 2;
    s.workRam[0x14] = 1;
    s.workRam[0x3e4] = 4;
    writeU16BE(s.workRam, 0x02, 0x00bb);
    writeU16BE(s.spriteRam, 0x180, 0);

    mainTick(s, { rom, runMainLoopBody: true, p1X: 0xfe, p1Y: 0xff });

    expect(readU16BE(s.workRam, 0x02)).toBe(0x00bb);
    expect(s.clock.pendingPfScrollUpdate).toBe(1);

    s.workRam[0x14] = 0;
    s.workRam[0x39a] = 0;
    mainTick(s, { rom, runMainLoopBody: true, p1X: 0xff, p1Y: 0xff });

    expect(readU16BE(s.workRam, 0x02)).toBe(0x00bc);
    expect(s.clock.pendingPfScrollUpdate).toBeUndefined();
  });

  it("keeps live PF scroll update immediate outside deferred playable segments", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    s.workRam[0x08] = 1;
    s.workRam[0x0a] = 2;
    s.workRam[0x14] = 1;
    s.workRam[0x3e4] = 0;
    writeU16BE(s.workRam, 0x02, 0x00bb);
    writeU16BE(s.spriteRam, 0x180, 0);

    mainTick(s, { rom, runMainLoopBody: true, p1X: 0xfe, p1Y: 0xff });

    expect(readU16BE(s.workRam, 0x02)).toBe(0x00bc);
    expect(s.clock.pendingPfScrollUpdate).toBeUndefined();
  });

  it("advances staged mode2 reset and clears stale post-game-over playfield", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();

    writeU16BE(s.workRam, 0x390, 1);
    writeU16BE(s.workRam, 0x392, 2);
    writeU16BE(s.workRam, 0x75a, 0x0096);
    s.playfieldRam.fill(0xaa);
    s.clock.mode2Init11452Stage = 0 as typeof s.clock.mode2Init11452Stage;

    mainTick(s, { rom, runMainLoopBody: true });

    expect(readU16BE(s.workRam, 0x390)).toBe(1);
    expect(readU16BE(s.workRam, 0x392)).toBe(2);
    expect(s.clock.mode2Init11452Stage).toBe(1);
    expect(nonzero(s.playfieldRam)).toBe(0x2000);

    mainTick(s, { rom, runMainLoopBody: true });

    expect(readU16BE(s.workRam, 0x390)).toBe(1);
    expect(readU16BE(s.workRam, 0x392)).toBe(2);
    expect(s.clock.mode2Init11452Stage).toBe(2);
    expect(nonzero(s.playfieldRam)).toBe(0);
  });

  it.skipIf(!ROM_AVAILABLE)("does not let stale object timers preempt pending new-game init", () => {
    const s = emptyGameState();
    const rom = loadProgramRom();

    writeU16BE(s.workRam, 0x390, 5);
    writeU16BE(s.workRam, 0x396, 1);
    s.workRam[0x18 + 0x18] = 1;
    s.workRam[0x18 + 0x1a] = 0;
    writeU16BE(s.workRam, 0x18 + 0x6a, 0);
    s.clock.mainLoopBodyTicks = 0 as typeof s.clock.mainLoopBodyTicks;

    mainTick(s, { rom, runMainLoopBody: true, inputMmio: 0x6f });

    expect(readU16BE(s.workRam, 0x390)).toBe(5);
    expect(s.workRam[0x18 + 0x18]).toBe(1);

    mainTick(s, { rom, runMainLoopBody: true, inputMmio: 0x6f });

    expect(readU16BE(s.workRam, 0x390)).toBe(0);
    expect(s.clock.levelIntroScrollResumeTick).toBe(1);
    expect(s.clock.levelIntroBannerResumeTick).toBeUndefined();
    expect(readU16BE(s.workRam, 0x82)).toBe(0);
  });
});
