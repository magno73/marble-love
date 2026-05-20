/**
 * boot-init.test.ts — smoke + integration test della sequenza di boot.
 *
 * Verifica:
 *  - colorRam ha il pattern decrescente del RESET handler
 *  - palette base inizializzata via paletteRamInitFull
 *  - workRam globals di state machine inizializzati (0x1F42 rotation flag)
 *  - dopo `bootInit + tick + tick` lo state evolve senza eccezioni
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { bootInit } from "../src/boot-init.js";
import { tick } from "../src/index.js";
import { emptyGameState } from "../src/state.js";
import { emptyRomImage } from "../src/bus.js";
import { loadRomBlob } from "../src/m68k/apply-slapstic-bank.js";
import {
  DEFAULT_HIGH_SCORE_STRUCT_ADDR,
  DEFAULT_HIGH_SCORE_TABLE_ADDR,
} from "../src/high-score-defaults.js";
import { keyRankLookup4686 } from "../src/key-rank-lookup-4686.js";

function readLongBE(bytes: Uint8Array, off: number): number {
  return (
    (((bytes[off] ?? 0) << 24) |
      ((bytes[off + 1] ?? 0) << 16) |
      ((bytes[off + 2] ?? 0) << 8) |
      (bytes[off + 3] ?? 0)) >>> 0
  );
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

function highScoreTableHex(state: ReturnType<typeof emptyGameState>): string {
  return Buffer.from(
    state.workRam.slice(
      DEFAULT_HIGH_SCORE_TABLE_ADDR - 0x400000,
      DEFAULT_HIGH_SCORE_TABLE_ADDR - 0x400000 + 50,
    ),
  ).toString("hex");
}

describe("bootInit", () => {
  it("non solleva eccezioni con state vuoto + ROM vuota", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    expect(() => bootInit(s, rom)).not.toThrow();
  });

  it("color RAM hardware init: pattern decrescente -0x1000+4*i", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    bootInit(s, rom);
    // Dopo bootInit ROM-vuota:
    //   0x000..0x01F: paletteRamInitFull loop2 (zero con ROM vuota)
    //   0x020..0x1FE: hw pattern intatto (paletteRamInitFull loop1 parte da 0x200)
    //   0x200..0x7FE: paletteRamInitFull loop1 (zero con ROM vuota)
    // Verifica a 0x100 (centro fascia hw): iter = 0x100/2 + 1 = 0x81 →
    //   d0 = -0x1000 + 0x81*4 = -0xCFC = 0xF304
    const off = 0x100;
    const iter = (off / 2) + 1;
    const expected = (-0x1000 + iter * 4) & 0xffff;
    const got = ((s.colorRam[off] ?? 0) << 8) | (s.colorRam[off + 1] ?? 0);
    expect(got).toBe(expected);
  });

  it("palette region @ 0x200 inizializzata (paletteRamInitFull loop1)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // ROM vuota: paletteRamInitFull loop1 scrive 0 → ma dopo bootInit
    // l'indice 0x200 è stato comunque toccato (overwrite del pattern hw)
    // Verifica: prima bootInit l'area è 0, dopo bootInit ROM-vuota resta 0
    bootInit(s, rom);
    // Con ROM reale conterrebbe i color values; con ROM vuota = 0
    expect(s.colorRam[0x200]).toBe(0);
  });

  it("gameStateMachineInit: rotation flag = 0 con ROM vuota", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    bootInit(s, rom);
    // ROM[0x10000] = 0x00 0x00 (vuoto) → rotFlag = 0
    expect(s.workRam[0x1f42]).toBe(0);
    expect(s.workRam[0x1f43]).toBe(0);
  });

  it("gameStateMachineInit: rotation flag = 1 con ROM populata correttamente", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x10000] = 0x4e;
    rom.program[0x10001] = 0xf9;
    rom.program[0x10072] = 0x01;
    bootInit(s, rom);
    expect(s.workRam[0x1f42]).toBe(0);
    expect(s.workRam[0x1f43]).toBe(1);
  });

  it("initializes the cold-boot default high-score table", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    writeMarbleDefaultHighScores(rom);

    bootInit(s, rom);

    expect(readLongBE(s.workRam, 0x1ffc)).toBe(DEFAULT_HIGH_SCORE_STRUCT_ADDR);
    expect(s.workRam[DEFAULT_HIGH_SCORE_STRUCT_ADDR - 0x400000 + 0x0a]).toBe(0);
    expect(s.workRam[DEFAULT_HIGH_SCORE_STRUCT_ADDR - 0x400000 + 0x0b]).toBe(0xff);
    expect(highScoreTableHex(s)).toBe(
      "0038a412d20036b0843f0034bc2d5c0032c878880030d4648c002ee06732002cec3f28002af8193c0029043f83002710193a",
    );
    expect(keyRankLookup4686(s, 140)).toBe(10);
  });

  it("initializes the same high-score defaults from the real ROM blob", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    loadRomBlob(rom, readFileSync(resolve("ghidra_project/marble_program.bin")));

    bootInit(s, rom);

    expect(readLongBE(s.workRam, 0x1ffc)).toBe(DEFAULT_HIGH_SCORE_STRUCT_ADDR);
    expect(highScoreTableHex(s)).toBe(
      "0038a412d20036b0843f0034bc2d5c0032c878880030d4648c002ee06732002cec3f28002af8193c0029043f83002710193a",
    );
    expect(keyRankLookup4686(s, 140)).toBe(10);
  });

  it("alpha RAM clear (gameStateMachineInit clears 0xF00 byte)", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    // Pre-fill alpha RAM
    for (let i = 0; i < 0x1000; i++) s.alphaRam[i] = 0xCC;
    bootInit(s, rom);
    // 0..0xEFF cleared
    for (let i = 0; i < 0xF00; i++) {
      expect(s.alphaRam[i]).toBe(0);
    }
    // 0xF00..0xFFF NOT cleared (gameStateMachineInit ferma a 0xF00)
    expect(s.alphaRam[0xF00]).toBe(0xCC);
  });

  it("integrazione: bootInit + 5 tick → state evolve senza throw", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    bootInit(s, rom);
    for (let i = 0; i < 5; i++) {
      expect(() => tick(s, { rom })).not.toThrow();
    }
    // state.clock.frame avanza (counter canonico interno);
    // workRam[0x14] e [0x16] sono gestiti dalle sub IRQ4 + body — non sono
    // più semplici monotonic counter dopo il fix B6.
    expect(s.clock.frame).toBe(5);
  });

  it("warmState restore resetta anche clock e RNG transitori", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const warm = {
      workRam: new Uint8Array(0x2000),
      playfieldRam: new Uint8Array(0x2000),
      spriteRam: new Uint8Array(0x1000),
      alphaRam: new Uint8Array(0x1000),
      colorRam: new Uint8Array(0x800),
      videoScrollX: 11,
      videoScrollY: 22,
    };
    warm.workRam[0x3a6] = 0x12;
    warm.workRam[0x3a7] = 0x34;

    bootInit(s, rom, { warmState: warm });
    s.clock.frame = 5 as typeof s.clock.frame;
    s.clock.cpuTicks = 123 as typeof s.clock.cpuTicks;
    s.clock.mainLoopBodyTicks = 7 as typeof s.clock.mainLoopBodyTicks;
    s.clock.decoderCallCount = 9 as typeof s.clock.decoderCallCount;
    s.clock.slotArrayReplayTick = 3 as typeof s.clock.slotArrayReplayTick;
    s.clock.warmResidualReplayTick = 4 as typeof s.clock.warmResidualReplayTick;
    s.rng.callsThisFrame = 2 as typeof s.rng.callsThisFrame;

    bootInit(s, rom, { warmState: warm });
    expect(s.clock.frame).toBe(0);
    expect(s.clock.cpuTicks).toBe(0);
    expect(s.clock.mainLoopBodyTicks).toBe(0);
    expect(s.clock.decoderCallCount).toBe(0);
    expect(s.clock.slotArrayReplayTick).toBeUndefined();
    expect(s.clock.warmResidualReplayTick).toBeUndefined();
    expect(s.rng.seed).toBe(0x1234);
    expect(s.rng.callsThisFrame).toBe(0);
    expect(s.videoScrollX).toBe(11);
    expect(s.videoScrollY).toBe(22);
  });

  it("warmState restore arma il replay legacy solo per snapshot attract riconosciuti", () => {
    const s = emptyGameState();
    const rom = emptyRomImage();
    const warm = {
      workRam: new Uint8Array(0x2000),
      playfieldRam: new Uint8Array(0x2000),
      spriteRam: new Uint8Array(0x1000),
      alphaRam: new Uint8Array(0x1000),
      colorRam: new Uint8Array(0x800),
    };
    warm.workRam[0x3e4] = 1;
    warm.workRam[0x390] = 0x00;
    warm.workRam[0x391] = 0x01;
    warm.workRam[0x392] = 0x00;
    warm.workRam[0x393] = 0x00;
    warm.workRam[0x13f2] = 0xff;
    warm.workRam[0x13f3] = 0xa6;
    warm.workRam[0x6f5] = 0x32;

    bootInit(s, rom, { warmState: warm });

    expect(s.clock.slotArrayReplayTick).toBe(0);
    expect(s.clock.warmResidualReplayTick).toBe(0);
  });

  it("HUD strings: cold-boot DISATTIVATO per allinearsi con MAME", () => {
    // Vedi commento in boot-init.ts: in attract_mode l'oracle non popola
    // workRam[0x140-0x176] con le HUD strings. Il path cold-boot di
    // FUN_FA0 non viene eseguito. Quindi bootInit lascia la regione 0.
    const s = emptyGameState();
    const rom = emptyRomImage();
    rom.program[0x10074] = 0x00; rom.program[0x10075] = 0x01;
    rom.program[0x10076] = 0x20; rom.program[0x10077] = 0x00;
    rom.program[0x12000] = 0x48; rom.program[0x12001] = 0x00;
    bootInit(s, rom);
    expect(s.workRam[0x140]).toBe(0); // strcpy SKIPPED
  });
});
